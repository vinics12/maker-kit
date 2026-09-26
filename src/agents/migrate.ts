import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addonStateSchema, type AddonState } from "../addons/state.js";
import { startMarker, endMarker } from "../addons/inject.js";
import { inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { sha256, type Manifest, type ManifestEntry } from "../render/manifest.js";
import type { AppliedFile } from "../util/scaffold.js";
import { adapterInstruction, sharedRoleReference } from "./reference.js";

type Inspected = Awaited<ReturnType<typeof inspectTarget>>;
interface LegacyAgent { frontmatter: string; body: string }
interface LoadedState { state: AddonState; hash: string; changed: boolean }

export async function planLegacyAddonAgents(
  targetDir: string,
  staging: string,
  expected: AppliedFile[],
  manifest: Manifest,
): Promise<{ changes: PlannedChange[]; handled: Set<string>; messages: string[] }> {
  const changes: PlannedChange[] = [];
  const handled = new Set<string>();
  const messages: string[] = [];
  const states = new Map<string, LoadedState | string>();
  const outputs = new Set(expected.map((file) => file.rel));

  for (const file of expected) {
    const role = file.rel.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
    const entry = manifest.files[file.rel];
    if (!role || !entry?.source.startsWith("addon:")) continue;
    const current = await inspectTarget(targetDir, file.rel);
    if (current.kind !== "file" || sharedRoleReference(current.content!.toString("utf-8"))) continue;

    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const id = entry.source.slice("addon:".length);
    const upstream = outputs.has(sharedPath) ? await readFile(join(staging, sharedPath)) : undefined;
    const agent = upstream ? parseLegacyAgent(current.content!, role) : undefined;
    let loaded: LoadedState | undefined;
    let reason: string | undefined;
    if (!agent) {
      reason = "formato do agente legado não reconhecido";
    } else {
      const result = await loadState(targetDir, id, states);
      if (typeof result === "string") reason = result;
      else if (!confirmsInjectionTarget(result.state, id, file.rel)) reason = "state do add-on não confirma o alvo de injeção legado";
      else if (!hasSingleAddonBlock(agent.body, id)) reason = "blocos de add-on incompletos, duplicados ou de múltiplas origens";
      else loaded = result;
    }
    const shared = await inspectTarget(targetDir, sharedPath);
    if (!reason && !sharedIsReplaceable(shared, manifest.files[sharedPath], entry.source, agent!.body, upstream!)) {
      reason = `papel compartilhado ${sharedPath} já possui conteúdo local ou não gerenciado`;
    }

    if (reason || !agent || !loaded || !upstream) {
      reason ??= "migração não confirmada";
      messages.push(`${file.rel} [${entry.source}]: preservado; integração continuará degradada: ${reason}. ` +
        `Revise a migração do corpo e dos blocos para ${sharedPath} e os injectedTargets do state; não reaplique o add-on sobre conteúdo personalizado.`);
      handled.add(file.rel);
      changes.push({ path: file.rel, action: "preserve", source: entry.source, reason,
        expectedKind: current.kind, expectedHash: current.hash });
      continue;
    }

    const adapter = `${agent.frontmatter.replace(/\r\n/g, "\n")}\n${adapterInstruction(sharedPath)}`;
    const adapterUpstream = await readFile(join(staging, file.rel));
    changes.push({ ...await planWrite({ targetDir, path: sharedPath, content: agent.body, source: entry.source,
      reason: "migrar corpo e blocos personalizados do agente legado", force: true }),
      expectedHash: shared.hash, expectedKind: shared.kind });
    changes.push({ ...await planWrite({ targetDir, path: file.rel, content: adapter, source: file.entry.source,
      reason: "converter agente legado em adapter do papel compartilhado", force: true }),
      expectedHash: current.hash, expectedKind: current.kind });
    for (const base of [upstream, adapterUpstream]) {
      changes.push(await planWrite({ targetDir, path: `.maker/bases/${sha256(base)}`, content: base,
        source: "metadata", reason: "base upstream do agente migrado" }));
    }
    manifest.files[sharedPath] = { hash: sha256(agent.body), source: entry.source, baseHash: sha256(upstream) };
    manifest.files[file.rel] = { hash: sha256(adapter), source: file.entry.source, baseHash: sha256(adapterUpstream) };
    loaded.state.injectedTargets = loaded.state.injectedTargets.map((path) => path === file.rel ? sharedPath : path)
      .filter((path, index, paths) => path !== sharedPath || paths.indexOf(path) === index);
    loaded.changed = true;
    handled.add(file.rel);
    handled.add(sharedPath);
    messages.push(`${file.rel} [${entry.source}]: migrar conteúdo preservado para ${sharedPath} e regenerar adapter.`);
  }

  for (const [id, loaded] of states) {
    if (typeof loaded === "string" || !loaded.changed) continue;
    changes.push({ ...await planWrite({ targetDir, path: `.maker/addons/${id}.json`,
      content: JSON.stringify(loaded.state, null, 2) + "\n", source: "metadata",
      reason: "atualizar somente os alvos de injeção dos agentes migrados", force: true }),
      expectedHash: loaded.hash, expectedKind: "file" });
  }
  return { changes, handled, messages };
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

/** Lê o state bruto (preservando campos extras) uma vez por add-on; retorna o motivo em caso de falha. */
async function loadState(targetDir: string, id: string, cache: Map<string, LoadedState | string>): Promise<LoadedState | string> {
  const cached = cache.get(id);
  if (cached) return cached;
  let result: LoadedState | string;
  try {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("id inválido");
    const metadata = await inspectTarget(targetDir, `.maker/addons/${id}.json`);
    if (metadata.kind !== "file") throw new Error("state não é arquivo regular");
    const raw: unknown = JSON.parse(metadata.content!.toString("utf-8"));
    addonStateSchema.parse(raw);
    result = { state: raw as AddonState, hash: metadata.hash!, changed: false };
  } catch {
    result = "state do add-on ausente ou inválido";
  }
  cache.set(id, result);
  return result;
}

function confirmsInjectionTarget(state: AddonState, id: string, path: string): boolean {
  return state.id === id && state.injectedTargets.includes(path) &&
    !state.createdFiles.some((item) => item.path === path);
}

function hasSingleAddonBlock(body: string, id: string): boolean {
  const markers = [...body.matchAll(/<!-- maker:addon:([^\s:]+):(start|end) -->/g)];
  return markers.length === 2 &&
    markers[0]![1] === id && markers[0]![2] === "start" &&
    markers[1]![1] === id && markers[1]![2] === "end" &&
    body.includes(startMarker(id)) && body.includes(endMarker(id));
}

/**
 * O destino pode receber o corpo legado quando está ausente, já contém exatamente esse corpo sob a
 * mesma origem de add-on, ou é um papel do engine sem edição local (igual ao upstream atual ou ao
 * conteúdo/base registrado no manifest — o template instalado pode ser de uma versão anterior).
 */
function sharedIsReplaceable(shared: Inspected, entry: ManifestEntry | undefined, addonSource: string, body: string, upstream: Buffer): boolean {
  if (shared.kind === "absent") return true;
  if (shared.kind !== "file" || !entry) return false;
  if (entry.source === addonSource) return shared.content!.equals(Buffer.from(body));
  if (!entry.source.startsWith("engine")) return false;
  return shared.content!.equals(upstream) || shared.hash === entry.hash || shared.hash === entry.baseHash;
}
