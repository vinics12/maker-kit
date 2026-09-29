import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { AgentProvider, MakerConfig } from "../config/schema.js";

export type BasesFormat = "files" | "pack";

export interface ManifestEntry {
  /** sha256 do conteúdo no momento do install. */
  hash: string;
  /** origem lógica: "engine" (Fase 1) ou o id de um add-on (Fase 2). */
  source: string;
  /** Conteúdo upstream exato usado como ancestral do próximo 3-way merge. */
  baseHash?: string;
  /**
   * Conteúdo divergente do upstream sem base exata para mesclar (ex.: remoção de um add-on aplicado
   * antes das bases): o update preserva o arquivo e o encaminha para mediação em vez de sobrescrevê-lo.
   */
  edited?: boolean;
}

export interface Manifest {
  schemaVersion?: number;
  makerVersion: string;
  project: { name: string; slug: string };
  /** Config normalizada usada para renderizar novos adaptadores. Ausente em manifests v1. */
  config?: MakerConfig;
  /** Integrações instaladas. Manifests v1 sem o campo equivalem a ["claude"]. */
  agents?: AgentProvider[];
  installedAt: string;
  /** Formato registrado do armazenamento de bases. Só init/update gravam/alteram; demais preservam como encontraram. */
  basesFormat?: BasesFormat;
  files: Record<string, ManifestEntry>;
}

export function enabledAgents(manifest: Manifest): AgentProvider[] {
  return manifest.agents?.length ? manifest.agents : ["claude"];
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
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
