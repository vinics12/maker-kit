import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";
import { parseConfig, type MakerConfig } from "../config/schema.js";
import { buildContext } from "../render/engine.js";
import { enabledAgents, readManifest, sha256, writeManifest } from "../render/manifest.js";
import { applyEngine } from "../util/engine-scaffold.js";
import { makerVersion } from "../util/version.js";

export interface UpdateOptions {
  target?: string;
}

/** Refresh conservador do núcleo e apenas das integrações registradas no manifest. */
export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);

  const { config, recovered } = await resolveConfig(targetDir, manifest.config, manifest.project);
  const agents = enabledAgents(manifest);
  const staging = await mkdtemp(join(tmpdir(), "maker-update-"));
  const updated: string[] = [];
  const skipped: string[] = [];

  try {
    const expected = await applyEngine(staging, buildContext(config), agents);
    for (const file of expected) {
      const staged = join(staging, file.rel);
      const destination = join(targetDir, file.rel);
      const newContent = await readFile(staged);
      const newHash = sha256(newContent);

      if (existsSync(destination)) {
        const currentHash = sha256(await readFile(destination));
        const recordedEntry = manifest.files[file.rel];
        const recorded = recordedEntry?.hash;
        if (recordedEntry?.source.startsWith("addon:") && currentHash === recorded) {
          skipped.push(file.rel);
          continue;
        }
        if (recorded && currentHash !== recorded) {
          skipped.push(file.rel);
          continue;
        }
        if (currentHash === newHash) {
          manifest.files[file.rel] = file.entry;
          continue;
        }
      }

      await mkdir(dirname(destination), { recursive: true });
      await copyFile(staged, destination);
      manifest.files[file.rel] = file.entry;
      updated.push(file.rel);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  manifest.schemaVersion = 2;
  manifest.agents = agents;
  if (manifest.config || recovered) manifest.config = config;
  manifest.makerVersion = makerVersion();
  await writeManifest(targetDir, manifest);

  console.log(pc.green(`✓ ${updated.length} arquivo(s) atualizado(s).`));
  if (skipped.length) {
    console.log(pc.yellow(`${skipped.length} preservado(s) por edição local:`));
    for (const path of skipped) console.log(pc.dim(`  ${path}`));
  }
}

async function resolveConfig(
  targetDir: string,
  stored: MakerConfig | undefined,
  project: { name: string; slug: string },
): Promise<{ config: MakerConfig; recovered: boolean }> {
  if (stored) return { config: parseConfig(stored), recovered: true };
  const configPath = join(targetDir, "maker.config.json");
  if (existsSync(configPath)) {
    return {
      config: parseConfig(JSON.parse(await readFile(configPath, "utf-8"))),
      recovered: true,
    };
  }
  return { config: parseConfig({ project }), recovered: false };
}
