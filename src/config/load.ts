import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, type MakerConfig } from "./schema.js";
import { promptConfig } from "./prompts.js";

export const CONFIG_FILE = "maker.config.json";

/**
 * Resolve a config na ordem: --config explícito → maker.config.json no target →
 * prompts interativos. Em modo --yes sem config, usa defaults exigindo só o name
 * (que também deve vir por flag) — caso contrário falha pedindo config.
 */
export async function loadConfig(opts: {
  targetDir: string;
  configPath?: string;
  yes?: boolean;
  name?: string;
  agent?: string;
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
