import { existsSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import pc from "picocolors";
import { listAddonCatalog, type AddonCatalogEntry } from "../addons/loader.js";
import { addonStatePath, readAddonState } from "../addons/state.js";

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

export async function runList(opts: ListOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const catalog = await listAddonCatalog();
  const listed = await classifyAddons(targetDir, catalog);

  if (!listed.length) {
    console.log(pc.dim("nenhum add-on disponível"));
    return;
  }

  console.log(pc.bold("Add-ons disponíveis:"));
  for (const addon of listed) printAddon(addon);
}

async function classifyAddons(
  targetDir: string,
  catalog: AddonCatalogEntry[],
): Promise<ListedAddon[]> {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const stateIndex = await listStateIds(targetDir);
  const ids = [...new Set([...byId.keys(), ...stateIndex.ids])].sort();

  return Promise.all(
    ids.map(async (id): Promise<ListedAddon> => {
      const entry = byId.get(id) ?? null;
      if (stateIndex.issue) {
        return { id, catalog: entry, status: "degraded", issue: stateIndex.issue };
      }
      if (!entry?.manifest) {
        return {
          id,
          catalog: entry,
          status: "degraded",
          issue: entry?.issue ?? "state existe, mas o add-on não está disponível no catálogo",
        };
      }

      const statePath = addonStatePath(targetDir, id);
      if (!existsSync(statePath)) return { id, catalog: entry, status: "available" };
      try {
        const state = (await readAddonState(targetDir, id))!;
        if (state.id !== id) {
          return { id, catalog: entry, status: "degraded", issue: `state declara id "${state.id}"` };
        }
        if (state.version !== entry.manifest.version) {
          return {
            id,
            catalog: entry,
            status: "degraded",
            issue: `state v${state.version} difere do catálogo v${entry.manifest.version}`,
          };
        }
        return { id, catalog: entry, status: "applied" };
      } catch (error) {
        return {
          id,
          catalog: entry,
          status: "degraded",
          issue: `state inválido: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
}

async function listStateIds(
  targetDir: string,
): Promise<{ ids: string[]; issue?: string }> {
  const dir = join(targetDir, ".maker", "addons");
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ids: [] };
    return {
      ids: [],
      issue: `não foi possível inspecionar .maker/addons: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!metadata.isDirectory()) {
    return { ids: [], issue: ".maker/addons deveria ser um diretório" };
  }
  try {
    const ids = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => basename(entry.name, ".json"))
      .sort();
    return { ids };
  } catch (error) {
    return {
      ids: [],
      issue: `não foi possível ler .maker/addons: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
