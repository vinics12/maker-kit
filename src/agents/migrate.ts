import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddonState, AddonStateRecord } from "../state/addon-state.js";
import { startMarker, endMarker, stripBlock, upsertBlock } from "../addons/inject.js";
import { inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import type { RenderContext } from "../render/engine.js";
import { sha256, type Manifest, type ManifestEntry } from "../render/manifest.js";
import { legacySharedAgent, sharedAgentText } from "../util/engine-scaffold.js";
import type { AppliedFile } from "../util/scaffold.js";
import { adapterInstruction, sharedRoleReference } from "./reference.js";

type Inspected = Awaited<ReturnType<typeof inspectTarget>>;
interface LegacyAgent { frontmatter: string; body: string }

/**
 * Resultado por agente legado: `migrated` (corpo levado ao papel compartilhado), `adapter` (papel
 * já correto; só o adapter foi regenerado), `pending` (migração possível, mas não aplicada por
 * --no-merge) ou `degraded` (preservado; `action` diz como destravar).
 */
export interface LegacyAgentReport {
  path: string;
  sharedPath: string;
  status: "migrated" | "adapter" | "pending" | "degraded";
  reason: string;
  action?: string;
}

const MANUAL_ACTION = "mova as customizações do corpo legado para o papel compartilhado, remova-as do agente legado e execute maker update --dry-run; não reaplique o add-on sobre conteúdo personalizado";

export async function planLegacyAddonAgents(
  targetDir: string,
  staging: string,
  expected: AppliedFile[],
  manifest: Manifest,
  options: {
    ctx: RenderContext; migrate?: boolean; configKnown?: boolean; configDependent?: Set<string>;
    addons: ReadonlyMap<string, AddonStateRecord>;
  },
): Promise<{
  changes: PlannedChange[]; handled: Set<string>; reports: LegacyAgentReport[]; bases: Map<string, Buffer>;
  addons: Map<string, AddonStateRecord>;
}> {
  const changes: PlannedChange[] = [];
  const handled = new Set<string>();
  const reports: LegacyAgentReport[] = [];
  const bases = new Map<string, Buffer>();
  const states = new Map<string, AddonStateRecord | string>();
  const changedIds = new Set<string>();
  const outputs = new Set(expected.map((file) => file.rel));

  for (const file of expected) {
    const role = file.rel.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
    const entry = manifest.files[file.rel];
    if (!role || !entry) continue;
    const current = await inspectTarget(targetDir, file.rel);
    if (current.kind !== "file" || sharedRoleReference(current.content!.toString("utf-8"))) continue;
    if (entry.source.startsWith("engine")) {
      await planEngineLegacyAgent(file, role, entry, current);
      continue;
    }
    if (!entry.source.startsWith("addon:")) continue;

    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const id = entry.source.slice("addon:".length);
    const report = (status: LegacyAgentReport["status"], reason: string, action?: string) =>
      reports.push({ path: file.rel, sharedPath, status, reason, action });
    const preserve = (reason: string, action = MANUAL_ACTION) => {
      report("degraded", reason, action);
      handled.add(file.rel);
      changes.push({ path: file.rel, action: "preserve", source: entry.source, reason,
        expectedKind: current.kind, expectedHash: current.hash });
    };

    // Sem config, o papel renderizado com os padrões não serve de destino nem de base (just → npm etc.).
    if (options.configKnown === false && (options.configDependent?.has(sharedPath) || options.configDependent?.has(file.rel))) {
      preserve("depende de config não recuperada", "crie maker.config.json com os valores usados no init e execute maker update --dry-run");
      continue;
    }
    const upstream = outputs.has(sharedPath) ? await readFile(join(staging, sharedPath)) : undefined;
    const agent = upstream ? parseLegacyAgent(current.content!, role) : undefined;
    if (!agent || !upstream) { preserve("formato do agente legado não reconhecido"); continue; }
    const loaded = loadState(id, options.addons, states);
    if (typeof loaded === "string") { preserve(loaded); continue; }
    if (!hasSingleAddonBlock(agent.body, id)) { preserve("blocos de add-on incompletos, duplicados ou de múltiplas origens"); continue; }
    if (!allowsRead(agent.frontmatter)) {
      preserve("o frontmatter restringe tools sem Read; o adapter não conseguiria ler o papel compartilhado",
        `inclua Read em tools: de ${file.rel} e execute maker update --dry-run`);
      continue;
    }

    const shared = await inspectTarget(targetDir, sharedPath);
    const sharedEntry = manifest.files[sharedPath];
    const legacyTemplate = await legacySharedAgent(options.ctx, role);
    const block = blockContent(agent.body, id)!;
    // Sem customização quando o corpo sem o bloco é um template conhecido: o atual, o da 0.2.x ou
    // o papel stock intacto que uma 0.4.x já instalou.
    const templates = [upstream.toString("utf-8"), legacyTemplate];
    if (shared.kind === "file" && sharedEntry?.source.startsWith("engine") && isUnedited(shared, sharedEntry)) {
      templates.push(shared.content!.toString("utf-8"));
    }
    const pristine = templates.includes(sharedAgentText(stripBlock(agent.body, id)));
    const adapter = `${agent.frontmatter.replace(/\r\n/g, "\n")}\n${adapterInstruction(sharedPath)}`;
    const adapterUpstream = await readFile(join(staging, file.rel));

    if (confirmsInjectionTarget(loaded, id, file.rel)) {
      const content = pristine ? upsertBlock(upstream.toString("utf-8"), id, block) : sharedAgentText(agent.body);
      if (!sharedIsReplaceable(shared, sharedEntry, entry.source, content, upstream)) {
        preserve(`papel compartilhado ${sharedPath} já possui conteúdo local ou não gerenciado`);
        continue;
      }
      // Base do próximo merge: o template de onde o corpo personalizado derivou.
      const base = pristine ? upstream : Buffer.from(legacyTemplate ?? upstream.toString("utf-8"));
      const reason = pristine
        ? "corpo sem customização; papel recebe o template atual com o bloco do add-on"
        : "corpo personalizado; copiado como está; updates do template chegam por merge a partir do template 0.2.x";
      if (options.migrate === false) {
        report("pending", reason);
        handled.add(file.rel);
        changes.push({ path: file.rel, action: "preserve", source: entry.source, reason: "migração pendente; merge desabilitado",
          expectedKind: current.kind, expectedHash: current.hash });
        continue;
      }
      changes.push({ ...await planWrite({ targetDir, path: sharedPath, content, source: entry.source,
        reason: `migrar agente legado: ${reason}`, force: true }),
        expectedHash: shared.hash, expectedKind: shared.kind });
      changes.push(await planAdapter(targetDir, file, current, adapter, adapterUpstream, manifest, bases));
      recordBase(bases, base);
      manifest.files[sharedPath] = { hash: sha256(content), source: entry.source, baseHash: sha256(base) };
      moveInjectedBlock(loaded, file.rel, sharedPath);
      loaded.injectedTargets = loaded.injectedTargets.map((path) => path === file.rel ? sharedPath : path)
        .filter((path, index, paths) => path !== sharedPath || paths.indexOf(path) === index);
      changedIds.add(id);
      handled.add(file.rel);
      handled.add(sharedPath);
      report("migrated", reason);
      continue;
    }

    // Add-on reaplicado depois de um update sem migração: o state e o papel compartilhado já estão
    // corretos e o agente legado só carrega uma cópia antiga do bloco.
    if (!reappliedOnShared(loaded, id, file.rel, sharedPath) || sharedEntry?.source !== entry.source ||
        shared.kind !== "file" || !hasSingleAddonBlock(shared.content!.toString("utf-8"), id)) {
      preserve("state do add-on não confirma o alvo de injeção legado");
      continue;
    }
    if (!pristine) {
      preserve(`o corpo legado tem customizações ausentes de ${sharedPath}`,
        `mova as customizações de ${file.rel} para ${sharedPath}, remova-as do agente legado e execute maker update --dry-run`);
      continue;
    }
    if (block !== blockContent(shared.content!.toString("utf-8"), id)) {
      preserve(`o bloco do add-on no agente legado difere do bloco em ${sharedPath}`,
        `leve as edições do bloco de ${file.rel} para ${sharedPath}, iguale os dois blocos e execute maker update --dry-run`);
      continue;
    }
    const reason = "add-on já reaplicado no papel compartilhado; agente legado sem customização";
    if (options.migrate === false) {
      report("pending", reason);
      handled.add(file.rel);
      changes.push({ path: file.rel, action: "preserve", source: entry.source, reason: "migração pendente; merge desabilitado",
        expectedKind: current.kind, expectedHash: current.hash });
      continue;
    }
    changes.push(await planAdapter(targetDir, file, current, adapter, adapterUpstream, manifest, bases));
    handled.add(file.rel);
    report("adapter", reason);
  }

  /**
   * Agente Claude 0.2.x do engine (sem add-on) com customização: o update o preservaria sem referência
   * ao papel. Com o template 0.2.x como base exata, o corpo vai para o papel compartilhado — igual ao
   * template atual quando não há customização — e o adapter é regenerado com o frontmatter do dono.
   * Sem destino seguro, fica degradado e vai para mediação junto com o papel.
   */
  async function planEngineLegacyAgent(file: AppliedFile, role: string, entry: ManifestEntry, current: Inspected): Promise<void> {
    // Intacto desde que o maker o gravou: o update comum o troca pelo adapter.
    if (!entry.edited && current.hash === (entry.baseHash ?? entry.hash)) return;
    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const report = (status: LegacyAgentReport["status"], reason: string, action?: string) =>
      reports.push({ path: file.rel, sharedPath, status, reason, action });
    const preserve = (reason: string, action: string) => {
      report("degraded", reason, action);
      handled.add(file.rel);
      changes.push({ path: file.rel, action: "preserve", source: entry.source, reason,
        expectedKind: current.kind, expectedHash: current.hash });
    };
    if (options.configKnown === false) return;
    const upstream = outputs.has(sharedPath) ? await readFile(join(staging, sharedPath)) : undefined;
    const legacyShared = await legacySharedAgent(options.ctx, role);
    const agent = upstream && legacyShared ? parseLegacyAgent(current.content!, role) : undefined;
    if (!agent || !upstream || !legacyShared) return;
    if (!allowsRead(agent.frontmatter)) {
      preserve("o frontmatter restringe tools sem Read; o adapter não conseguiria ler o papel compartilhado",
        `inclua Read em tools: de ${file.rel} e execute maker update --dry-run`);
      return;
    }
    const shared = await inspectTarget(targetDir, sharedPath);
    const sharedEntry = manifest.files[sharedPath];
    const body = sharedAgentText(agent.body);
    const pristine = body === upstream.toString("utf-8") || body === legacyShared;
    const content = pristine ? upstream.toString("utf-8") : body;
    if (!sharedIsReplaceable(shared, sharedEntry, "", content, upstream)) {
      preserve(`papel compartilhado ${sharedPath} já possui conteúdo local`,
        "use maker update --export ou a skill maker-update para levar as customizações do agente legado ao papel");
      return;
    }
    const reason = pristine
      ? "agente do engine sem customização no corpo; papel recebe o template atual"
      : "agente do engine com corpo personalizado; copiado como está; updates do template chegam por merge a partir do template 0.2.x";
    if (options.migrate === false) {
      report("pending", reason);
      handled.add(file.rel);
      changes.push({ path: file.rel, action: "preserve", source: entry.source, reason: "migração pendente; merge desabilitado",
        expectedKind: current.kind, expectedHash: current.hash });
      return;
    }
    const base = pristine ? upstream : Buffer.from(legacyShared);
    const sharedSource = sharedEntry?.source ?? "engine:common";
    changes.push({ ...await planWrite({ targetDir, path: sharedPath, content, source: sharedSource,
      reason: `migrar agente legado: ${reason}`, force: true }),
      expectedHash: shared.hash, expectedKind: shared.kind });
    const adapter = `${agent.frontmatter.replace(/\r\n/g, "\n")}\n${adapterInstruction(sharedPath)}`;
    changes.push(await planAdapter(targetDir, file, current, adapter, await readFile(join(staging, file.rel)), manifest, bases));
    recordBase(bases, base);
    manifest.files[sharedPath] = { hash: sha256(content), source: sharedSource, baseHash: sha256(base) };
    handled.add(file.rel);
    handled.add(sharedPath);
    report("migrated", reason);
  }

  const nextAddons = new Map(options.addons);
  for (const [id, loaded] of states) {
    if (typeof loaded === "string" || !changedIds.has(id)) continue;
    nextAddons.set(id, loaded);
  }
  return { changes, handled, reports, bases, addons: nextAddons };
}

/** Regenera o adapter e o devolve ao engine no manifest. */
async function planAdapter(targetDir: string, file: AppliedFile, current: Inspected, adapter: string,
  upstream: Buffer, manifest: Manifest, bases: Map<string, Buffer>): Promise<PlannedChange> {
  manifest.files[file.rel] = { hash: sha256(adapter), source: file.entry.source, baseHash: sha256(upstream) };
  recordBase(bases, upstream);
  return { ...await planWrite({ targetDir, path: file.rel, content: adapter, source: file.entry.source,
    reason: "converter agente legado em adapter do papel compartilhado", force: true }),
    expectedHash: current.hash, expectedKind: current.kind };
}

/** Acumula a base num `Map` (hash → conteúdo), devolvido ao chamador em vez de planejar a escrita aqui:
 *  `planUpdate` decide o formato de armazenamento (`planStateWrite`). */
function recordBase(bases: Map<string, Buffer>, content: Buffer): void {
  bases.set(sha256(content), content);
}

function parseLegacyAgent(raw: Buffer, role: string): LegacyAgent | undefined {
  const content = raw.toString("utf-8");
  if (!raw.equals(Buffer.from(content)) || content.includes("\0")) return undefined;
  const [, frontmatter, body] = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]+)$/) ?? [];
  if (!frontmatter || !body?.trim()) return undefined;
  const name = frontmatter.match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
  if (name !== role || !/^description:\s*\S/m.test(frontmatter)) return undefined;
  return { frontmatter, body };
}

/** `tools:` ausente libera todas as ferramentas; uma lista explícita precisa incluir Read. */
function allowsRead(frontmatter: string): boolean {
  const match = frontmatter.match(/^tools:[ \t]*(.*)\r?\n((?:[ \t]+-.*\r?\n)*)/m);
  if (!match) return true;
  const inline = match[1]!.trim().replace(/^\[|\]$/g, "");
  const items = (inline ? inline.split(",") : match[2]!.split("\n").map((line) => line.replace(/^\s*-/, "")))
    .map((item) => item.trim().replace(/^["']|["']$/g, ""));
  return items.some((item) => item === "Read" || item === "*");
}

/** Lê o state do mapa de add-ons já carregado pela camada de estado (clone: mutações locais não vazam
 * para o mapa de entrada); retorna o motivo em caso de falha. */
function loadState(id: string, addons: ReadonlyMap<string, AddonStateRecord>, cache: Map<string, AddonStateRecord | string>): AddonStateRecord | string {
  const cached = cache.get(id);
  if (cached) return cached;
  const record = /^[a-z0-9-]+$/.test(id) ? addons.get(id) : undefined;
  const result: AddonStateRecord | string = record ? structuredClone(record) : "state do add-on ausente ou inválido";
  cache.set(id, result);
  return result;
}

function confirmsInjectionTarget(state: AddonState, id: string, path: string): boolean {
  return state.id === id && state.injectedTargets.includes(path) &&
    !state.createdFiles.some((item) => item.path === path);
}

function reappliedOnShared(state: AddonState, id: string, path: string, sharedPath: string): boolean {
  return state.id === id && state.injectedTargets.includes(sharedPath) && !state.injectedTargets.includes(path) &&
    !state.createdFiles.some((item) => item.path === path || item.path === sharedPath);
}

function hasSingleAddonBlock(body: string, id: string): boolean {
  const markers = [...body.matchAll(/<!-- maker:addon:([^\s:]+):(start|end) -->/g)];
  return markers.length === 2 &&
    markers[0]![1] === id && markers[0]![2] === "start" &&
    markers[1]![1] === id && markers[1]![2] === "end" &&
    body.includes(startMarker(id)) && body.includes(endMarker(id));
}

/** Conteúdo entre os marcadores, no formato que `upsertBlock` recebe. */
function blockContent(content: string, id: string): string | undefined {
  const start = content.indexOf(startMarker(id));
  const end = content.indexOf(endMarker(id));
  if (start < 0 || end < start) return undefined;
  return content.slice(start + startMarker(id).length, end).replace(/\r\n/g, "\n").trim();
}

/**
 * Mesma regra do update: com base registrada, o hash gravado pode ser de um conteúdo mesclado com
 * customizações; só a base upstream prova que não há edição local.
 */
function isUnedited(current: Inspected, entry: ManifestEntry): boolean {
  return current.hash === (entry.baseHash ?? entry.hash);
}

/**
 * O destino pode receber o papel migrado quando está ausente, já contém exatamente esse conteúdo
 * sob a mesma origem de add-on, ou é um papel do engine sem edição local (igual ao upstream atual ou
 * ao conteúdo/base registrado no manifest — o template instalado pode ser de uma versão anterior).
 */
function sharedIsReplaceable(shared: Inspected, entry: ManifestEntry | undefined, addonSource: string, content: string, upstream: Buffer): boolean {
  if (shared.kind === "absent") return true;
  if (shared.kind !== "file" || !entry) return false;
  if (entry.source === addonSource) return shared.content!.equals(Buffer.from(content));
  if (!entry.source.startsWith("engine")) return false;
  return shared.content!.equals(upstream) || isUnedited(shared, entry);
}

/** O registro do bloco acompanha o alvo de injeção quando ele muda de arquivo (o conteúdo do bloco é o mesmo). */
export function moveInjectedBlock(state: AddonState, from: string, to: string): void {
  const recorded = state.injectedBlocks?.[from];
  if (!recorded) return;
  state.injectedBlocks![to] = recorded;
  delete state.injectedBlocks![from];
}
