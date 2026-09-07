import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/** Nome do arquivo de manifest gravado na raiz do install. */
export const MANIFEST_FILE = ".maker/manifest.json";

export interface ManifestEntry {
  /** sha256 do conteúdo no momento do install. */
  hash: string;
  /** origem lógica: "engine" (Fase 1) ou o id de um add-on (Fase 2). */
  source: string;
}

export interface Manifest {
  makerVersion: string;
  project: { name: string; slug: string };
  installedAt: string;
  files: Record<string, ManifestEntry>;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeManifest(
  targetDir: string,
  manifest: Manifest,
): Promise<void> {
  const path = join(targetDir, MANIFEST_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export async function readManifest(
  targetDir: string,
): Promise<Manifest | null> {
  const path = join(targetDir, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8")) as Manifest;
}

export interface DoctorResult {
  ok: boolean;
  missing: string[];
  modified: string[];
  checked: number;
}

/**
 * Verifica a integridade de um install contra seu manifest: arquivos ausentes
 * ou modificados pelo usuário desde a instalação.
 */
export async function verifyManifest(
  targetDir: string,
  manifest: Manifest,
): Promise<DoctorResult> {
  const missing: string[] = [];
  const modified: string[] = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const abs = join(targetDir, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const current = sha256(await readFile(abs));
    if (current !== entry.hash) modified.push(rel);
  }
  return {
    ok: missing.length === 0 && modified.length === 0,
    missing,
    modified,
    checked: Object.keys(manifest.files).length,
  };
}

/** Caminho relativo POSIX (chave estável do manifest, cross-OS). */
export function manifestKey(targetDir: string, absPath: string): string {
  return relative(targetDir, absPath).split("\\").join("/");
}
