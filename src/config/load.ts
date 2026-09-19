import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, type MakerConfig } from "./schema.js";
import { promptConfig } from "./prompts.js";

export const CONFIG_FILE = "maker.config.json";

/**
 * Resolve a config na ordem: --config explícito → maker.config.json no target →
 * config anterior (em reinstalação) → prompts interativos. Em modo --yes sem
 * config anterior, usa defaults exigindo só o name — caso contrário falha.
 */
export async function loadConfig(opts: {
  targetDir: string;
  configPath?: string;
  yes?: boolean;
  name?: string;
  agent?: string;
  fallback?: MakerConfig;
}): Promise<MakerConfig> {
  if (opts.configPath) {
    const raw = JSON.parse(await readFile(opts.configPath, "utf-8"));
    return parseConfig(opts.agent ? { ...raw, agent: opts.agent } : raw);
  }
  const inTarget = join(opts.targetDir, CONFIG_FILE);
  if (existsSync(inTarget)) {
    const raw = JSON.parse(await readFile(inTarget, "utf-8"));
    return parseConfig(opts.agent ? { ...raw, agent: opts.agent } : raw);
  }
  if (!opts.name && opts.fallback) {
    return parseConfig(opts.agent ? { ...opts.fallback, agent: opts.agent } : opts.fallback);
  }
  if (opts.yes) {
    if (!opts.name) {
      throw new Error(
        `Sem ${CONFIG_FILE} e sem --name: em modo --yes forneça --config <arquivo> ou --name <nome>.`,
      );
    }
    return parseConfig({ agent: opts.agent, project: { name: opts.name } });
  }
  const prompted = await promptConfig();
  return opts.agent ? parseConfig({ ...prompted, agent: opts.agent }) : prompted;
}
