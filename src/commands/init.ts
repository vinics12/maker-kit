import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import pc from "picocolors";
import { loadConfig } from "../config/load.js";
import { buildContext } from "../render/engine.js";
import { applyTree, templatesDir } from "../util/scaffold.js";
import { writeManifest, type Manifest } from "../render/manifest.js";
import { makerVersion } from "../util/version.js";

export interface InitOptions {
  target?: string;
  config?: string;
  yes?: boolean;
  name?: string;
  force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());

  // Preflight: não sobrescreve um install existente sem --force.
  if (existsSync(join(targetDir, ".specify")) && !opts.force) {
    throw new Error(
      `${targetDir} já contém .specify/ — use --force para reinstalar por cima.`,
    );
  }

  const config = await loadConfig({
    targetDir,
    configPath: opts.config,
    yes: opts.yes,
    name: opts.name,
  });
  const ctx = buildContext(config);

  const applied = await applyTree(templatesDir("engine"), targetDir, ctx, "engine");

  const manifest: Manifest = {
    makerVersion: makerVersion(),
    project: { name: config.project.name, slug: config.project.slug! },
    installedAt: new Date().toISOString(),
    files: Object.fromEntries(applied.map((a) => [a.rel, a.entry])),
  };
  await writeManifest(targetDir, manifest);

  console.log(pc.green(`\n✓ Motor instalado em ${targetDir}`));
  console.log(pc.dim(`  ${applied.length} arquivos · projeto "${config.project.name}"`));
  console.log("\nPróximos passos:");
  console.log(
    `  1. Preencha ${pc.cyan(".specify/memory/project-rules.md")} (bases técnicas + regras de negócio)`,
  );
  console.log(`  2. Revise ${pc.cyan(".specify/memory/constitution.md")} (seções do projeto)`);
  console.log(`  3. Abra o Claude Code e rode ${pc.cyan("/run-brainstorm")} ou ${pc.cyan("/run-spec")}`);
}
