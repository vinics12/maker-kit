import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { BasesFormat } from "../render/manifest.js";
import type { InstallState } from "./store.js";
import type { BaseProblem } from "./lockfile.js";

const CONFIG_FILE = "maker.config.json";

/** Dica de opt-out do formato pack, mostrada pelo update (ao migrar) e pelo doctor (antes de migrar). */
export const FORMAT_OPT_OUT_SNIPPET = '"state": { "bases": "files" }';

export type ConfiguredFormat =
  | { kind: "unset" }
  | { kind: "set"; format: BasesFormat }
  | { kind: "invalid"; message: string }
  | { kind: "unreadable"; message: string };

const stateOnlySchema = z
  .object({
    state: z
      .object({
        bases: z.enum(["files", "pack"], { error: 'state.bases deve ser "files" ou "pack"' }).optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * init: passa a config carregada; update/doctor: lê maker.config.json do alvo e valida só `state`.
 * - arquivo ausente ou sem `state.bases` → { kind: "unset" }
 * - `state.bases` válido → { kind: "set", format }
 * - JSON válido com `state.bases` fora do enum → lança o ZodError de validação — comandos mutantes
 *   abortam antes de escrever; o doctor usa `inspect: true` e recebe { kind: "invalid", message } em
 *   vez de lançar, para poder reportar o achado e seguir verificando o resto do install
 * - JSON malformado → { kind: "unreadable", message } (nunca lança): o chamador resolve sem migrar
 */
export async function configuredBasesFormat(
  targetDir: string,
  opts?: { loaded?: { state?: { bases?: BasesFormat } }; inspect?: boolean },
): Promise<ConfiguredFormat> {
  const loaded = opts?.loaded;
  if (loaded !== undefined) {
    return loaded.state?.bases ? { kind: "set", format: loaded.state.bases } : { kind: "unset" };
  }

  let raw: string;
  try {
    raw = await readFile(join(targetDir, CONFIG_FILE), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "unset" };
    return { kind: "unreadable", message: `${CONFIG_FILE} ilegível: ${(error as Error).message}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { kind: "unreadable", message: `${CONFIG_FILE} ilegível: ${(error as Error).message}` };
  }

  const parsed = stateOnlySchema.safeParse(json);
  if (!parsed.success) {
    const message = `${CONFIG_FILE}: ${parsed.error.issues[0]?.message ?? "state.bases inválido"}`;
    if (opts?.inspect) return { kind: "invalid", message };
    throw parsed.error;
  }
  const bases = parsed.data.state?.bases;
  return bases ? { kind: "set", format: bases } : { kind: "unset" };
}

/** unreadable → recorded ?? inUse com reason "unreadable-config" (nunca migra por default). */
export function effectiveBasesFormat(
  configured: ConfiguredFormat,
  recorded: BasesFormat | undefined,
  inUse: BasesFormat | undefined,
): { format: BasesFormat; reason: "config" | "manifest" | "default" | "unreadable-config" } {
  if (configured.kind === "set") return { format: configured.format, reason: "config" };
  if (configured.kind === "unreadable") return { format: recorded ?? inUse ?? "pack", reason: "unreadable-config" };
  if (recorded) return { format: recorded, reason: "manifest" };
  return { format: "pack", reason: "default" };
}

export interface FormatTransition {
  from: BasesFormat;
  to: BasesFormat;
  reason: "config" | "manifest" | "default" | "unreadable-config";
  migrated: number;
  discarded: BaseProblem[];
  affected: Record<string, string[]>;
  consolidatesLoose: boolean;
}

/** null quando inUse === effective e não há bases soltas a consolidar. */
export function planFormatTransition(
  state: InstallState,
  effective: { format: BasesFormat; reason: "config" | "manifest" | "default" | "unreadable-config" },
  referenced?: ReadonlySet<string>,
): FormatTransition | null {
  const consolidatesLoose = state.inUse === "pack" && state.looseFileBases.length > 0;
  if (effective.format === state.inUse && !consolidatesLoose) return null;

  const wanted = referenced ?? new Set(Object.values(state.manifest.files).flatMap((entry) => (entry.baseHash ? [entry.baseHash] : [])));
  const migrated = [...wanted].filter((hash) => state.hasBase(hash)).length;
  const discarded = state.problems.filter((problem) => !problem.recovered);
  const affected: Record<string, string[]> = {};
  for (const problem of discarded) {
    if (!problem.hash) continue;
    const files = Object.entries(state.manifest.files)
      .filter(([, entry]) => entry.baseHash === problem.hash)
      .map(([path]) => path);
    if (files.length) affected[problem.hash] = files;
  }

  return { from: state.inUse, to: effective.format, reason: effective.reason, migrated, discarded, affected, consolidatesLoose };
}

/** files em uso, nada registrado, nada configurado → o próximo update migra para o default sem aviso prévio; o doctor usa isso para avisar com antecedência. */
export function pendingDefaultMigration(
  state: Pick<InstallState, "inUse" | "recorded">,
  configured: ConfiguredFormat,
): boolean {
  return state.inUse === "files" && !state.recorded && configured.kind === "unset";
}
