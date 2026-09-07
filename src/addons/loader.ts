import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../util/scaffold.js";
import { addonManifestSchema, type AddonManifest } from "./schema.js";

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
