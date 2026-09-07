import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Estado por-install de um add-on aplicado, para permitir remoção reversível. */
export interface AddonState {
  id: string;
  version: string;
  appliedAt: string;
  knobs: Record<string, string>;
  /** Arquivos novos criados pelo add-on (deletáveis na remoção). */
  createdFiles: { path: string; hash: string }[];
  /** Arquivos do motor onde o add-on injetou um bloco (por marcador). */
  injectedTargets: string[];
}

export function addonStatePath(targetDir: string, id: string): string {
  return join(targetDir, ".maker", "addons", `${id}.json`);
}

export function isAddonApplied(targetDir: string, id: string): boolean {
  return existsSync(addonStatePath(targetDir, id));
}

export async function readAddonState(
  targetDir: string,
  id: string,
): Promise<AddonState | null> {
  const p = addonStatePath(targetDir, id);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf-8")) as AddonState;
}

export async function writeAddonState(targetDir: string, state: AddonState): Promise<void> {
  const p = addonStatePath(targetDir, state.id);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export async function deleteAddonState(targetDir: string, id: string): Promise<void> {
  const p = addonStatePath(targetDir, id);
  if (existsSync(p)) await rm(p);
}
