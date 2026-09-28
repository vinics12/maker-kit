import { z } from "zod";

/** Estado por-install de um add-on aplicado, para permitir remoção reversível (idêntico à 1.0.0). */
export const addonStateSchema = z.object({
  id: z.string(),
  version: z.string(),
  appliedAt: z.string(),
  knobs: z.record(z.string(), z.string()),
  /** Arquivos novos criados pelo add-on (deletáveis na remoção). */
  createdFiles: z.array(z.object({ path: z.string(), hash: z.string() })),
  /** Arquivos do motor onde o add-on injetou um bloco (por marcador). */
  injectedTargets: z.array(z.string()),
  /**
   * sha256 do conteúdo de cada bloco injetado, por alvo, como o maker o gravou. Na reaplicação, um
   * bloco só é substituído se ainda for esse: comparar com o fragmento renderizado não serve, porque
   * uma versão nova do add-on muda o fragmento e o bloco intacto pareceria editado.
   */
  injectedBlocks: z.record(z.string(), z.string()).optional(),
});

export type AddonState = z.infer<typeof addonStateSchema>;
export type AddonStateRecord = AddonState & Record<string, unknown>;

export const ADDON_STATE_FIELDS = [
  "id", "version", "appliedAt", "knobs", "createdFiles", "injectedTargets", "injectedBlocks",
] as const;

const LOCKFILE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

export function isAddonId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

export function parseAddonStateRecord(raw: unknown): AddonStateRecord {
  return addonStateSchema.passthrough().parse(raw) as AddonStateRecord;
}

/** null = cabe numa unidade do lockfile; senão o motivo (chave de topo fora de `[A-Za-z][A-Za-z0-9]*`). */
export function isLockfileSerializable(record: AddonStateRecord): string | null {
  for (const key of Object.keys(record)) {
    if (key === "id") continue;
    if (!LOCKFILE_KEY.test(key)) return `campo "${key}" fora da gramática do lockfile`;
  }
  return null;
}

/** JSON como o maker grava hoje: ordem de topo ADDON_STATE_FIELDS + extras; createdFiles {path, hash}; 2 espaços + "\n". */
export function addonStateJson(record: AddonStateRecord): string {
  const ordered: Record<string, unknown> = {};
  for (const field of ADDON_STATE_FIELDS) {
    if (field === "id") { ordered.id = record.id; continue; }
    if (field === "injectedBlocks") {
      if (record.injectedBlocks !== undefined) ordered.injectedBlocks = record.injectedBlocks;
      continue;
    }
    if (field === "createdFiles") {
      ordered.createdFiles = record.createdFiles.map((item) => ({ path: item.path, hash: item.hash }));
      continue;
    }
    ordered[field] = (record as Record<string, unknown>)[field];
  }
  for (const key of Object.keys(record)) {
    if ((ADDON_STATE_FIELDS as readonly string[]).includes(key)) continue;
    ordered[key] = record[key];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
