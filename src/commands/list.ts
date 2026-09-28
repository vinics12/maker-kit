import { resolve } from "node:path";
import pc from "picocolors";
import { listAddonCatalog, type AddonCatalogEntry } from "../addons/loader.js";
import { addonStateFile } from "../state/paths.js";
import { inspectState, type StateSnapshot } from "../state/store.js";

export interface ListOptions {
  target?: string;
}

type AddonStatus = "available" | "applied" | "degraded";

interface ListedAddon {
  id: string;
  catalog: AddonCatalogEntry | null;
  status: AddonStatus;
  issue?: string;
}

/** Só leitura: `inspectState` nunca escreve. Erros de estado (coexistência, lockfile ilegível) propagam. */
export async function runList(opts: ListOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const catalog = await listAddonCatalog();
  const snapshot = await inspectState(targetDir);
  if (snapshot.error) throw snapshot.error;
  const listed = classifyAddons(catalog, snapshot);

  if (!listed.length) {
    console.log(pc.dim("nenhum add-on disponível"));
    return;
  }

  console.log(pc.bold("Add-ons disponíveis:"));
  for (const addon of listed) printAddon(addon);
}

function classifyAddons(catalog: AddonCatalogEntry[], snapshot: StateSnapshot): ListedAddon[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const problemsById = new Map(snapshot.addonProblems.map((problem) => [problem.id, problem]));
  const orphanSet = new Set(snapshot.orphanAddonStateFiles);
  // Em pack, o estado vem só da seção [addons] do lockfile — o diretório legado é ignorado.
  const ids = [...new Set([...byId.keys(), ...snapshot.addons.keys(), ...problemsById.keys(), ...orphanSet])].sort();

  return ids.map((id): ListedAddon => {
    const entry = byId.get(id) ?? null;
    if (snapshot.inUse === "files" && snapshot.addonsDirIssue &&
        (snapshot.addonsDir === "not-directory" || snapshot.addonsDir === "unreadable")) {
      return { id, catalog: entry, status: "degraded", issue: snapshot.addonsDirIssue };
    }
    if (!entry?.manifest) {
      return {
        id, catalog: entry, status: "degraded",
        issue: entry?.issue ?? "state existe, mas o add-on não está disponível no catálogo",
      };
    }
    const problem = problemsById.get(id);
    if (problem) {
      return { id, catalog: entry, status: "degraded", issue: `state inválido: ${problem.detail}` };
    }
    if (orphanSet.has(id)) {
      return { id, catalog: entry, status: "degraded", issue: `estado de add-on sem install do maker (${addonStateFile(id)})` };
    }
    const record = snapshot.addons.get(id);
    if (!record) return { id, catalog: entry, status: "available" };
    if (record.id !== id) {
      return { id, catalog: entry, status: "degraded", issue: `state declara id "${record.id}"` };
    }
    if (record.version !== entry.manifest.version) {
      return {
        id, catalog: entry, status: "degraded",
        issue: `state v${record.version} difere do catálogo v${entry.manifest.version}`,
      };
    }
    return { id, catalog: entry, status: "applied" };
  });
}

function printAddon(addon: ListedAddon): void {
  const manifest = addon.catalog?.manifest;
  const label = addon.status === "applied"
    ? pc.green(addon.status)
    : addon.status === "degraded"
      ? pc.red(addon.status)
      : pc.dim(addon.status);
  const name = manifest ? `${manifest.name} · v${manifest.version}` : "manifest indisponível";
  console.log(`\n${pc.bold(addon.id)} · ${name} · ${label}`);
  if (manifest?.description) console.log(`  ${manifest.description}`);
  console.log(`  knobs: ${manifest?.knobs.length ? manifest.knobs.map((knob) => knob.name).join(", ") : "nenhum"}`);
  if (addon.issue) console.log(pc.red(`  problema: ${addon.issue}`));
  const next = addon.status === "available" ? `maker add ${addon.id}` : "maker doctor";
  console.log(pc.dim(`  próximo: ${next}`));
}
