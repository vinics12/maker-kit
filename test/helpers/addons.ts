import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addonManifestSchema, type AddonManifest } from "../../src/addons/schema.js";

export const SYNTHETIC_ADDONS_ROOT = join(__dirname, "..", "..", "fixtures", "addons-synthetic");

const SYNTHETIC_IDS = new Set(["alpha", "zeta"]);

async function loadSynthetic(id: string): Promise<AddonManifest> {
  const dir = join(SYNTHETIC_ADDONS_ROOT, id);
  const raw = JSON.parse(await readFile(join(dir, "addon.json"), "utf-8"));
  const parsed = addonManifestSchema.parse(raw);
  if (parsed.id !== id) throw new Error(`Add-on id divergente: pasta "${id}" vs manifest "${parsed.id}".`);
  return parsed;
}

/**
 * Para `vi.mock("../../src/addons/loader.js", mockLoaderWithSynthetic)`: `addonDir`/`loadAddon`
 * enxergam também `alpha`/`zeta` em `fixtures/addons-synthetic/`, e `listAddonCatalog` inclui os dois
 * junto do catálogo real — sem tocar `src/addons/loader.ts` nem o catálogo real.
 */
export async function mockLoaderWithSynthetic(
  importOriginal: () => Promise<typeof import("../../src/addons/loader.js")>,
): Promise<typeof import("../../src/addons/loader.js")> {
  const actual = await importOriginal();
  return {
    ...actual,
    addonDir(id: string): string {
      return SYNTHETIC_IDS.has(id) ? join(SYNTHETIC_ADDONS_ROOT, id) : actual.addonDir(id);
    },
    async loadAddon(id: string) {
      return SYNTHETIC_IDS.has(id) ? loadSynthetic(id) : actual.loadAddon(id);
    },
    async listAddonCatalog(root?: string) {
      const real = await actual.listAddonCatalog(root);
      const synthetic = await Promise.all([...SYNTHETIC_IDS].sort().map(async (id) => ({ id, manifest: await loadSynthetic(id) })));
      return [...real, ...synthetic].sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}
