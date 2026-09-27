import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, type MakerConfig } from "../config/schema.js";
import { buildContext } from "../render/engine.js";
import { enabledAgents, type Manifest } from "../render/manifest.js";
import { applyEngine } from "./engine-scaffold.js";

/** Config do install: a registrada no manifest ou, em installs 0.2.x que não a persistiam, maker.config.json. */
export async function resolveConfig(targetDir: string, stored: MakerConfig | undefined, project: { name: string; slug: string }): Promise<{ config: MakerConfig; recovered: boolean }> {
  if (stored) return { config: parseConfig(stored), recovered: true };
  const configPath = join(targetDir, "maker.config.json");
  if (existsSync(configPath)) return { config: parseConfig(JSON.parse(await readFile(configPath, "utf-8"))), recovered: true };
  return { config: parseConfig({ project }), recovered: false };
}

/** Arquivos que o engine gera hoje para o install, ou null quando a config não é recuperável. */
export async function renderUpstream(targetDir: string, manifest: Manifest): Promise<{ files: Map<string, Buffer>; config: MakerConfig } | null> {
  const { config, recovered } = await resolveConfig(targetDir, manifest.config, manifest.project);
  if (!recovered) return null;
  const staging = await mkdtemp(join(tmpdir(), "maker-upstream-"));
  try {
    const expected = await applyEngine(staging, buildContext(config), enabledAgents(manifest));
    const files = new Map<string, Buffer>();
    for (const file of expected) files.set(file.rel, await readFile(join(staging, file.rel)));
    return { files, config };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
