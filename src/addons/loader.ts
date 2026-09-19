import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../util/scaffold.js";
import { addonManifestSchema, type AddonManifest } from "./schema.js";

export interface AddonCatalogEntry {
  id: string;
  manifest: AddonManifest | null;
  issue?: string;
}

/** Diretório de um add-on dentro do pacote maker. */
export function addonDir(id: string): string {
  return join(packageRoot(), "addons", id);
}

/** Carrega e valida o manifest de um add-on por id. Lança se ausente/inválido. */
export async function loadAddon(id: string): Promise<AddonManifest> {
  const dir = addonDir(id);
  const manifestPath = join(dir, "addon.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Add-on "${id}" não encontrado (esperado em addons/${id}/addon.json).`);
  }
  const raw = JSON.parse(await readFile(manifestPath, "utf-8"));
  const parsed = addonManifestSchema.parse(raw);
  if (parsed.id !== id) {
    throw new Error(`Add-on id divergente: pasta "${id}" vs manifest "${parsed.id}".`);
  }
  return parsed;
}

/** Descobre, valida e ordena os add-ons empacotados no catálogo local. */
export async function listAddonCatalog(
  root = join(packageRoot(), "addons"),
): Promise<AddonCatalogEntry[]> {
  if (!existsSync(root)) return [];
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    dirs.map(async (id): Promise<AddonCatalogEntry> => {
      try {
        const raw = JSON.parse(await readFile(join(root, id, "addon.json"), "utf-8"));
        const manifest = addonManifestSchema.parse(raw);
        if (manifest.id !== id) {
          return { id, manifest: null, issue: `id do manifest é "${manifest.id}"` };
        }
        return { id, manifest };
      } catch (error) {
        return {
          id,
          manifest: null,
          issue: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}
