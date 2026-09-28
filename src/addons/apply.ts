import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderRaw } from "../render/engine.js";
import {
  sha256,
  manifestKey,
  type Manifest,
  type ManifestEntry,
} from "../render/manifest.js";
import { openState, planStateWrite } from "../state/store.js";
import { addonDir } from "./loader.js";
import type { AddonManifest } from "./schema.js";
import { upsertBlock, stripBlock, addonBlocks, sameText } from "./inject.js";
import { renderUpstream } from "../util/upstream.js";
import { legacyAgent } from "../util/engine-scaffold.js";
import { buildContext } from "../render/engine.js";
import {
  readAddonState,
  addonStatePath,
  type AddonState,
} from "./state.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type ChangePlan, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan } from "../changes/transaction.js";

const CONSTITUTION = ".specify/memory/constitution.md";
const PLACEHOLDER = "_(nenhum princípio de projeto definido ainda)_";

/** Injeta o bloco de um add-on no mesmo ponto que o apply usa para o caminho. */
export function injectBlock(path: string, content: string, id: string, block: string): string {
  return path === CONSTITUTION
    ? upsertBlock(content, id, block, { replacePlaceholder: PLACEHOLDER, beforeHeading: "## Governance" })
    : upsertBlock(content, id, block);
}

/** O conteúdo que um arquivo teria se fosse `template` com os blocos de add-on de `local` reinjetados. */
export function reinjectBlocks(path: string, template: string, local: string): string {
  let result = template;
  for (const [id, block] of addonBlocks(local)) result = injectBlock(path, result, id, block);
  return result;
}

/** Como o `remove` deixa um template que recebeu um bloco: sem o placeholder e com o espaçamento de stripBlock. */
export function afterBlockRemoval(path: string, template: string): string {
  const probe = "maker-probe";
  return stripBlock(injectBlock(path, template, probe, probe), probe);
}

function addonContext(manifest: Manifest, knobs: Record<string, string>) {
  return {
    project: manifest.project,
    addon: knobs,
    generatedAt: new Date().toISOString().slice(0, 10),
  };
}

async function renderFrom(dir: string, rel: string, ctx: object): Promise<string> {
  const raw = await readFile(join(dir, rel), "utf-8");
  return rel.endsWith(".hbs") ? renderRaw(raw, ctx) : raw;
}

/** Alvo de injeção: mantém a base upstream para que o remove devolva o arquivo ao merge 3-way. */
function injectedEntry(prior: ManifestEntry | undefined, content: string, id: string): ManifestEntry {
  return { hash: sha256(content), source: `addon:${id}`, ...(prior?.baseHash ? { baseHash: prior.baseHash } : {}) };
}

/**
 * Entrada do engine após remover o bloco. Com base upstream, o update seguinte faz merge 3-way. Sem
 * ela (add-on aplicado antes das bases), o arquivo só volta a ser tratado como intacto quando era um
 * template conhecido com o bloco; senão fica marcado como editado, e o update o preserva e o
 * encaminha para mediação em vez de sobrescrevê-lo.
 */
function restoredEntry(rel: string, prior: ManifestEntry | undefined, content: string, pristine: boolean): ManifestEntry {
  const source = rel.startsWith(".claude/") ? "engine:claude"
    : rel.startsWith(".codex/") || rel.startsWith(".agents/") ? "engine:codex"
      : "engine:common";
  if (prior?.baseHash) return { hash: sha256(content), source, baseHash: prior.baseHash };
  return pristine ? { hash: sha256(content), source } : { hash: sha256(content), source, edited: true };
}

/** Templates conhecidos de um alvo de injeção: o upstream atual e, para agentes Claude, o formato 0.2.x. */
async function knownTemplates(rel: string, upstream: Awaited<ReturnType<typeof renderUpstream>>): Promise<string[]> {
  if (!upstream) return [];
  const templates = upstream.files.has(rel) ? [upstream.files.get(rel)!.toString("utf-8")] : [];
  const role = rel.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
  const legacy = role ? await legacyAgent(buildContext(upstream.config, upstream.installedAt), role) : undefined;
  if (legacy) templates.push(legacy);
  return templates;
}

export async function applyAddon(
  targetDir: string,
  addon: AddonManifest,
  knobs: Record<string, string>,
  options: { dryRun?: boolean } = {},
): Promise<{ injectedTargets: string[]; createdFiles: string[]; plan: ChangePlan }> {
  const installState = await openState(targetDir, { mode: options.dryRun ? "dry-run" : "mutate" });
  if (!installState) {
    throw new Error(`Nenhum install do maker em ${targetDir} — rode 'maker init' antes de add-ons.`);
  }
  const manifest: Manifest = structuredClone(installState.manifest);
  const dir = addonDir(addon.id);
  const ctx = addonContext(manifest, knobs);
  const injectedTargets: string[] = [];
  const createdFiles: { path: string; hash: string }[] = [];
  const changes: PlannedChange[] = [];

  // Reaplicação: arquivos criados por este add-on só podem ser substituídos se ainda estiverem intactos.
  const prior = await readAddonState(targetDir, addon.id);
  const owned = new Map((prior?.createdFiles ?? []).map((f) => [f.path, f]));
  const previousCtx = prior ? addonContext(manifest, prior.knobs) : undefined;
  const injectedBlocks: Record<string, string> = {};
  /** Bloco instalado que o dono editou: difere do registrado no state (ou, em states antigos, do render anterior). */
  const blockEdited = (path: string, installed: string | undefined, previousBlock: string | undefined): boolean => {
    if (installed === undefined) return false;
    const recorded = prior?.injectedBlocks?.[path];
    if (recorded) return sha256(Buffer.from(installed)) !== recorded;
    return installed !== previousBlock;
  };
  const recordBlock = (path: string, content: string) => {
    const installed = addonBlocks(content).get(addon.id);
    if (installed !== undefined) injectedBlocks[path] = sha256(Buffer.from(installed));
  };

  // 1. Princípios → injetados na seção "Princípios do Projeto" da constitution.
  if (addon.principles.length) {
    const absConst = join(targetDir, CONSTITUTION);
    if (!existsSync(absConst)) throw new Error(`${CONSTITUTION} ausente no install.`);
    const rendered: string[] = [];
    for (const p of addon.principles) rendered.push((await renderFrom(dir, p, ctx)).trim());
    const block = rendered.join("\n\n");
    const current = await readFile(absConst, "utf-8");
    const previousBlock = previousCtx
      ? (await Promise.all(addon.principles.map(async (p) => (await renderFrom(dir, p, previousCtx)).trim()))).join("\n\n")
      : undefined;
    const installedBlock = addonBlocks(current).get(addon.id);
    if (blockEdited(CONSTITUTION, installedBlock, previousBlock)) {
      console.warn(`  aviso: bloco do add-on ${addon.id} em ${CONSTITUTION} foi editado — não sobrescrito.`);
      injectedTargets.push(CONSTITUTION);
      const recorded = prior?.injectedBlocks?.[CONSTITUTION];
      if (recorded) injectedBlocks[CONSTITUTION] = recorded;
    } else {
      const next = injectBlock(CONSTITUTION, current, addon.id, block);
      recordBlock(CONSTITUTION, next);
      changes.push(await planWrite({ targetDir, path: CONSTITUTION, content: next, source: `addon:${addon.id}`, reason: "injetar princípios do add-on", force: true }));
      manifest.files[CONSTITUTION] = injectedEntry(manifest.files[CONSTITUTION], next, addon.id);
      injectedTargets.push(CONSTITUTION);
    }
  }

  // 2. Fragmentos de agente → papel canônico compartilhado por Claude e Codex.
  for (const frag of addon.agentFragments) {
    const rel = `.maker/workflow/agents/${frag.agent}.md`;
    const abs = join(targetDir, rel);
    if (!existsSync(abs)) {
      console.warn(`  aviso: agente ${frag.agent} ausente — fragmento pulado.`);
      continue;
    }
    const block = (await renderFrom(dir, frag.file, ctx)).trim();
    const current = await readFile(abs, "utf-8");
    const previousBlock = previousCtx ? (await renderFrom(dir, frag.file, previousCtx)).trim() : undefined;
    const installedBlock = addonBlocks(current).get(addon.id);
    if (blockEdited(rel, installedBlock, previousBlock)) {
      console.warn(`  aviso: bloco do add-on ${addon.id} em ${rel} foi editado — não sobrescrito.`);
      injectedTargets.push(rel);
      const recorded = prior?.injectedBlocks?.[rel];
      if (recorded) injectedBlocks[rel] = recorded;
      continue;
    }
    const next = injectBlock(rel, current, addon.id, block);
    recordBlock(rel, next);
    changes.push(await planWrite({ targetDir, path: rel, content: next, source: `addon:${addon.id}`, reason: "injetar fragmento do add-on", force: true }));
    manifest.files[rel] = injectedEntry(manifest.files[rel], next, addon.id);
    injectedTargets.push(rel);
  }

  // 3. Arquivos novos (memória de referência, skills).
  for (const f of addon.files) {
    const abs = join(targetDir, f.to);
    if (existsSync(abs)) {
      const previous = owned.get(f.to);
      if (!previous) {
        console.warn(`  aviso: ${f.to} já existe (não é deste add-on) — não sobrescrito.`);
        continue;
      }
      if (sha256(await readFile(abs)) !== previous.hash) {
        console.warn(`  aviso: ${f.to} foi editado desde a aplicação do add-on — não sobrescrito.`);
        createdFiles.push(previous);
        continue;
      }
    }
    const content = await renderFrom(dir, f.from, ctx);
    const hash = sha256(Buffer.from(content, "utf-8"));
    manifest.files[manifestKey(targetDir, abs)] = { hash, source: `addon:${addon.id}` };
    createdFiles.push({ path: f.to, hash });
    changes.push(await planWrite({ targetDir, path: f.to, content, source: `addon:${addon.id}`, reason: "arquivo criado pelo add-on", force: owned.has(f.to) }));
  }

  const state: AddonState = {
    id: addon.id,
    version: addon.version,
    appliedAt: new Date().toISOString(),
    knobs,
    createdFiles,
    injectedTargets,
    injectedBlocks,
  };
  changes.push(...await planStateWrite(installState, targetDir, { manifest, format: installState.inUse, bases: new Map(), prune: false }));
  const stateRel = manifestKey(targetDir, addonStatePath(targetDir, addon.id));
  changes.push(await planWrite({ targetDir, path: stateRel, content: JSON.stringify(state, null, 2) + "\n", source: "metadata", reason: "publicar state do add-on", force: true }));
  const plan = createPlan(targetDir, changes);
  if (options.dryRun) console.log(formatPlan(plan));
  else await applyChangePlan(plan);
  return { injectedTargets, createdFiles: createdFiles.map((c) => c.path), plan };
}

export async function removeAddon(
  targetDir: string,
  id: string,
  options: { dryRun?: boolean } = {},
): Promise<{ strippedTargets: string[]; deletedFiles: string[]; keptFiles: string[]; plan: ChangePlan }> {
  // `.maker/addons/<id>.json` também é metadado de estado (isStateMetadata): recupera uma transação
  // pendente antes de ler qualquer coisa, senão um crash no meio de um `add` deixaria o `remove`
  // planejar em cima de um state que a recuperação desfaz logo em seguida.
  const installState = await openState(targetDir, { mode: options.dryRun ? "dry-run" : "mutate" });
  const state = await readAddonState(targetDir, id);
  if (!state) throw new Error(`Add-on "${id}" não está aplicado em ${targetDir}.`);
  const manifest = installState?.manifest;

  const strippedTargets: string[] = [];
  const deletedFiles: string[] = [];
  const keptFiles: string[] = [];
  const changes: PlannedChange[] = [];

  // 1. Remove os blocos injetados dos arquivos do motor.
  const legacyTargets = state.injectedTargets.some((rel) => manifest && !manifest.files[rel]?.baseHash);
  const upstream = legacyTargets && manifest ? await renderUpstream(targetDir, manifest) : null;
  for (const rel of state.injectedTargets) {
    const abs = join(targetDir, rel);
    if (!existsSync(abs)) continue;
    const current = await readFile(abs, "utf-8");
    const next = stripBlock(current, id);
    changes.push(await planWrite({ targetDir, path: rel, content: next, source: "engine", reason: "remover bloco do add-on", force: true }));
    // Blocos de outros add-ons continuam no arquivo: sobrescrevê-lo com o template os perderia.
    const pristine = addonBlocks(current).size === 1 &&
      (await knownTemplates(rel, upstream)).some((template) => sameText(reinjectBlocks(rel, template, current), current));
    if (manifest) manifest.files[rel] = restoredEntry(rel, manifest.files[rel], next, pristine);
    strippedTargets.push(rel);
  }

  // 2. Deleta arquivos criados — só se intocados desde a aplicação (hash bate).
  for (const f of state.createdFiles) {
    const abs = join(targetDir, f.path);
    if (!existsSync(abs)) continue;
    const current = sha256(await readFile(abs));
    if (current === f.hash) {
      if (manifest) delete manifest.files[manifestKey(targetDir, abs)];
      deletedFiles.push(f.path);
      const inspected = await inspectTarget(targetDir, f.path);
      changes.push({ path: f.path, action: "remove", source: `addon:${id}`, reason: "arquivo intacto criado pelo add-on", expectedHash: inspected.hash, expectedKind: inspected.kind });
    } else {
      keptFiles.push(f.path); // editado localmente — preserva
    }
  }

  if (manifest && installState) changes.push(...await planStateWrite(installState, targetDir, { manifest, format: installState.inUse, bases: new Map(), prune: false }));
  const stateRel = manifestKey(targetDir, addonStatePath(targetDir, id));
  const stateTarget = await inspectTarget(targetDir, stateRel);
  changes.push({ path: stateRel, action: "remove", source: "metadata", reason: "remover state do add-on", expectedHash: stateTarget.hash, expectedKind: stateTarget.kind });
  const plan = createPlan(targetDir, changes);
  if (options.dryRun) console.log(formatPlan(plan));
  else await applyChangePlan(plan);
  return { strippedTargets, deletedFiles, keptFiles, plan };
}
