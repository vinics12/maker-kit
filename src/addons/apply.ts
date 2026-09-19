import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderRaw } from "../render/engine.js";
import {
  readManifest,
  sha256,
  manifestKey,
  type Manifest,
} from "../render/manifest.js";
import { addonDir } from "./loader.js";
import type { AddonManifest } from "./schema.js";
import { upsertBlock, stripBlock } from "./inject.js";
import {
  readAddonState,
  addonStatePath,
  type AddonState,
} from "./state.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type ChangePlan, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan, assertNoPendingTransactions } from "../changes/transaction.js";

const CONSTITUTION = ".specify/memory/constitution.md";
const PLACEHOLDER = "_(nenhum princípio de projeto definido ainda)_";

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

export async function applyAddon(
  targetDir: string,
  addon: AddonManifest,
  knobs: Record<string, string>,
  options: { dryRun?: boolean } = {},
): Promise<{ injectedTargets: string[]; createdFiles: string[]; plan: ChangePlan }> {
  if (options.dryRun) await assertNoPendingTransactions(targetDir);
  const currentManifest = await readManifest(targetDir);
  if (!currentManifest) {
    throw new Error(`Nenhum install do maker em ${targetDir} — rode 'maker init' antes de add-ons.`);
  }
  const manifest: Manifest = structuredClone(currentManifest);
  const dir = addonDir(addon.id);
  const ctx = addonContext(manifest, knobs);
  const injectedTargets: string[] = [];
  const createdFiles: { path: string; hash: string }[] = [];
  const changes: PlannedChange[] = [];

  // Reaplicação: arquivos que ESTE add-on já criou são "nossos" e podem ser sobrescritos;
  // arquivos alheios de mesmo nome são preservados.
  const prior = await readAddonState(targetDir, addon.id);
  const owned = new Set((prior?.createdFiles ?? []).map((f) => f.path));

  // 1. Princípios → injetados na seção "Princípios do Projeto" da constitution.
  if (addon.principles.length) {
    const absConst = join(targetDir, CONSTITUTION);
    if (!existsSync(absConst)) throw new Error(`${CONSTITUTION} ausente no install.`);
    const rendered: string[] = [];
    for (const p of addon.principles) rendered.push((await renderFrom(dir, p, ctx)).trim());
    const block = rendered.join("\n\n");
    const current = await readFile(absConst, "utf-8");
    const next = upsertBlock(current, addon.id, block, {
      replacePlaceholder: PLACEHOLDER,
      beforeHeading: "## Governance",
    });
    changes.push(await planWrite({ targetDir, path: CONSTITUTION, content: next, source: `addon:${addon.id}`, reason: "injetar princípios do add-on", force: true }));
    manifest.files[CONSTITUTION] = { hash: sha256(next), source: `addon:${addon.id}` };
    injectedTargets.push(CONSTITUTION);
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
    const next = upsertBlock(await readFile(abs, "utf-8"), addon.id, block);
    changes.push(await planWrite({ targetDir, path: rel, content: next, source: `addon:${addon.id}`, reason: "injetar fragmento do add-on", force: true }));
    manifest.files[rel] = { hash: sha256(next), source: `addon:${addon.id}` };
    injectedTargets.push(rel);
  }

  // 3. Arquivos novos (memória de referência, skills).
  for (const f of addon.files) {
    const abs = join(targetDir, f.to);
    if (existsSync(abs) && !owned.has(f.to)) {
      console.warn(`  aviso: ${f.to} já existe (não é deste add-on) — não sobrescrito.`);
      continue;
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
  };
  changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(manifest, null, 2) + "\n", source: "metadata", reason: "publicar manifest do add-on", force: true }));
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
  if (options.dryRun) await assertNoPendingTransactions(targetDir);
  const state = await readAddonState(targetDir, id);
  if (!state) throw new Error(`Add-on "${id}" não está aplicado em ${targetDir}.`);
  const manifest = await readManifest(targetDir);

  const strippedTargets: string[] = [];
  const deletedFiles: string[] = [];
  const keptFiles: string[] = [];
  const changes: PlannedChange[] = [];

  // 1. Remove os blocos injetados dos arquivos do motor.
  for (const rel of state.injectedTargets) {
    const abs = join(targetDir, rel);
    if (!existsSync(abs)) continue;
    const next = stripBlock(await readFile(abs, "utf-8"), id);
    changes.push(await planWrite({ targetDir, path: rel, content: next, source: "engine", reason: "remover bloco do add-on", force: true }));
    if (manifest) manifest.files[rel] = { hash: sha256(next), source: "engine" };
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

  if (manifest) changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(manifest, null, 2) + "\n", source: "metadata", reason: "publicar manifest sem o add-on", force: true }));
  const stateRel = manifestKey(targetDir, addonStatePath(targetDir, id));
  const stateTarget = await inspectTarget(targetDir, stateRel);
  changes.push({ path: stateRel, action: "remove", source: "metadata", reason: "remover state do add-on", expectedHash: stateTarget.hash, expectedKind: stateTarget.kind });
  const plan = createPlan(targetDir, changes);
  if (options.dryRun) console.log(formatPlan(plan));
  else await applyChangePlan(plan);
  return { strippedTargets, deletedFiles, keptFiles, plan };
}
