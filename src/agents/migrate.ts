import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addonStateSchema, type AddonState } from "../addons/state.js";
import { startMarker, endMarker } from "../addons/inject.js";
import { inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { sha256, type Manifest } from "../render/manifest.js";
import type { AppliedFile } from "../util/scaffold.js";

export async function planLegacyAddonAgents(
  targetDir: string,
  staging: string,
  expected: AppliedFile[],
  manifest: Manifest,
): Promise<{ changes: PlannedChange[]; handled: Set<string>; messages: string[] }> {
  const changes: PlannedChange[] = [];
  const handled = new Set<string>();
  const messages: string[] = [];
  const states = new Map<string, AddonState>();
  const stateHashes = new Map<string, string>();
  const outputs = new Map(expected.map((file) => [file.rel, file]));

  for (const file of expected) {
    const role = file.rel.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
    const entry = manifest.files[file.rel];
    if (!role || !entry?.source.startsWith("addon:")) continue;
    const current = await inspectTarget(targetDir, file.rel);
    if (current.kind !== "file") continue;
    const content = current.content!.toString("utf-8");
    if (/\.maker\/workflow\/agents\/[a-z0-9-]+\.md/.test(content)) continue;

    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const sharedFile = outputs.get(sharedPath);
    const id = entry.source.slice("addon:".length);
    let reason: string | undefined;
    const parsed = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]+)$/);
    const name = parsed?.[1]?.match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
    if (!current.content!.equals(Buffer.from(content)) || content.includes("\0") || !parsed || name !== role ||
        !/^description:\s*\S/m.test(parsed[1]!) || !parsed[2]!.trim() || !sharedFile) {
      reason = "formato do agente legado não reconhecido";
    }
    let state = states.get(id);
    if (!reason) {
      try {
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error("id inválido");
        if (!state) {
          const metadata = await inspectTarget(targetDir, `.maker/addons/${id}.json`);
          if (metadata.kind !== "file") throw new Error("state não é arquivo regular");
          const raw: unknown = JSON.parse(metadata.content!.toString("utf-8"));
          addonStateSchema.parse(raw);
          state = raw as AddonState;
          stateHashes.set(id, metadata.hash!);
        }
        if (!state || state.id !== id || !state.injectedTargets.includes(file.rel) ||
            state.createdFiles.some((item) => item.path === file.rel)) {
          reason = "state do add-on não confirma o alvo de injeção legado";
        }
      } catch {
        reason = "state do add-on ausente ou inválido";
      }
    }
    const body = parsed?.[2] ?? "";
    const markers = [...body.matchAll(/<!-- maker:addon:([^\s:]+):(start|end) -->/g)];
    if (!reason && (markers.length !== 2 || markers[0]?.[1] !== id || markers[0]?.[2] !== "start" ||
        markers[1]?.[1] !== id || markers[1]?.[2] !== "end" ||
        !body.includes(startMarker(id)) || !body.includes(endMarker(id)))) {
      reason = "blocos de add-on incompletos, duplicados ou de múltiplas origens";
    }

    const shared = await inspectTarget(targetDir, sharedPath);
    const upstream = sharedFile ? await readFile(join(staging, sharedPath)) : undefined;
    const sharedEntry = manifest.files[sharedPath];
    if (!reason && shared.kind !== "absent" &&
        !(shared.kind === "file" && sharedEntry &&
          ((sharedEntry.source === entry.source && shared.content!.equals(Buffer.from(body))) ||
            (sharedEntry.source.startsWith("engine") && shared.content!.equals(upstream!))))) {
      reason = `papel compartilhado ${sharedPath} já possui conteúdo local ou não gerenciado`;
    }

    if (reason) {
      messages.push(`${file.rel} [${entry.source}]: preservado; integração continuará degradada: ${reason}. ` +
        `Revise a migração do corpo e dos blocos para ${sharedPath} e os injectedTargets do state; não reaplique o add-on sobre conteúdo personalizado.`);
      handled.add(file.rel);
      changes.push({ path: file.rel, action: "preserve", source: entry.source, reason,
        expectedKind: current.kind, expectedHash: current.hash });
      continue;
    }

    const adapter = `${parsed![1]!.replace(/\r\n/g, "\n")}\nRead \`${sharedPath}\` completely before acting and follow it as your role instructions.\n`;
    changes.push({ ...await planWrite({ targetDir, path: sharedPath, content: body, source: entry.source,
      reason: "migrar corpo e blocos personalizados do agente legado", force: true }),
      expectedHash: shared.hash, expectedKind: shared.kind });
    changes.push({ ...await planWrite({ targetDir, path: file.rel, content: adapter, source: file.entry.source,
      reason: "converter agente legado em adapter do papel compartilhado", force: true }),
      expectedHash: current.hash, expectedKind: current.kind });
    const adapterUpstream = await readFile(join(staging, file.rel));
    for (const base of [upstream!, adapterUpstream]) {
      changes.push(await planWrite({ targetDir, path: `.maker/bases/${sha256(base)}`, content: base,
        source: "metadata", reason: "base upstream do agente migrado" }));
    }
    manifest.files[sharedPath] = { hash: sha256(body), source: entry.source, baseHash: sha256(upstream!) };
    manifest.files[file.rel] = { hash: sha256(adapter), source: file.entry.source, baseHash: sha256(adapterUpstream) };
    state!.injectedTargets = state!.injectedTargets.map((path) => path === file.rel ? sharedPath : path)
      .filter((path, index, paths) => path !== sharedPath || paths.indexOf(path) === index);
    states.set(id, state!);
    handled.add(file.rel);
    handled.add(sharedPath);
    messages.push(`${file.rel} [${entry.source}]: migrar conteúdo preservado para ${sharedPath} e regenerar adapter.`);
  }

  for (const [id, state] of states) {
    changes.push({ ...await planWrite({ targetDir, path: `.maker/addons/${id}.json`,
      content: JSON.stringify(state, null, 2) + "\n", source: "metadata",
      reason: "atualizar somente os alvos de injeção dos agentes migrados", force: true }),
      expectedHash: stateHashes.get(id)!, expectedKind: "file" });
  }
  return { changes, handled, messages };
}
