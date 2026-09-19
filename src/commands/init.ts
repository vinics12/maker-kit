import { resolve, join } from "node:path";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pc from "picocolors";
import { loadConfig } from "../config/load.js";
import { buildContext } from "../render/engine.js";
import { writeManifest, type Manifest } from "../render/manifest.js";
import { makerVersion } from "../util/version.js";
import { applyEngine } from "../util/engine-scaffold.js";
import { readManifest, enabledAgents } from "../render/manifest.js";
import { parseConfig, type AgentProvider } from "../config/schema.js";

export interface InitOptions {
  target?: string;
  config?: string;
  yes?: boolean;
  name?: string;
  agent?: AgentProvider;
  force?: boolean;
}

interface InitCollision {
  path: string;
  reason: string;
  removeBeforeApply: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const priorManifest = await readManifest(targetDir);
  const loadedConfig = await loadConfig({
    targetDir,
    configPath: opts.config,
    yes: opts.yes,
    name: opts.name,
    agent: opts.agent,
    fallback: priorManifest?.config,
  });
  const agents = priorManifest ? enabledAgents(priorManifest) : [loadedConfig.agent];
  if (priorManifest && opts.agent && !agents.includes(opts.agent)) {
    throw new Error(
      `A integração ${opts.agent} ainda não está habilitada — use 'maker agent add ${opts.agent}'.`,
    );
  }
  const config = parseConfig({
    ...loadedConfig,
    agent: opts.agent ?? priorManifest?.config?.agent ?? agents[0],
  });
  const ctx = buildContext(config);

  const collisions = await findInitCollisions(targetDir, ctx, agents);
  if (collisions.length && !opts.force) {
    throw new Error(
      "A instalação não foi iniciada porque estes caminhos possuem conteúdo diferente ou " +
      `estrutura incompatível:\n${formatCollisions(collisions)}\n` +
      "Revise os arquivos ou execute novamente com --force para substituí-los; " +
      "nenhuma alteração foi feita.",
    );
  }
  if (collisions.length) {
    console.log(pc.yellow("\n⚠ --force substituirá estes caminhos:"));
    for (const collision of collisions) {
      console.log(pc.yellow(`  ${collision.path} (${collision.reason})`));
    }
    for (const collision of collisions) {
      if (collision.removeBeforeApply) {
        await rm(join(targetDir, collision.path), { recursive: true, force: true });
      }
    }
  }

  const applied = await applyEngine(targetDir, ctx, agents);

  const manifest: Manifest = {
    schemaVersion: 2,
    makerVersion: makerVersion(),
    project: { name: config.project.name, slug: config.project.slug! },
    config,
    agents,
    installedAt: priorManifest?.installedAt ?? new Date().toISOString(),
    files: Object.fromEntries(applied.map((a) => [a.rel, a.entry])),
  };
  await writeManifest(targetDir, manifest);

  console.log(pc.green(`\n✓ Motor instalado em ${targetDir}`));
  console.log(pc.dim(`  ${applied.length} arquivos · projeto "${config.project.name}"`));

  // O workflow gerado (scripts SpecKit .sh + comandos POSIX dos agentes) espera um shell
  // tipo-Unix. No Windows nativo, oriente o uso do WSL2 (Linux real).
  if (process.platform === "win32") {
    console.log(
      pc.yellow(
        "\n⚠ Windows detectado. O workflow gerado usa scripts bash e comandos POSIX (grep/git).",
      ),
    );
    console.log(
      pc.yellow(
        "  Rode o motor dentro do WSL2 (Ubuntu) para o comportamento idêntico ao Linux —",
      ),
    );
    console.log(pc.yellow("  veja a seção 'Windows' no README do maker."));
  }

  console.log("\nPróximos passos:");
  console.log(
    `  1. Preencha ${pc.cyan(".specify/memory/project-rules.md")} (bases técnicas + regras de negócio)`,
  );
  console.log(`  2. Revise ${pc.cyan(".specify/memory/constitution.md")} (seções do projeto)`);
  const invocation = config.agent === "codex" ? "$" : "/";
  console.log(
    `  3. Abra o ${config.agent === "codex" ? "Codex" : "Claude Code"} e rode ${pc.cyan(`${invocation}run-brainstorm`)} ou ${pc.cyan(`${invocation}run-spec`)}`,
  );
}

async function findInitCollisions(
  targetDir: string,
  ctx: ReturnType<typeof buildContext>,
  agents: AgentProvider[],
): Promise<InitCollision[]> {
  const staging = await mkdtemp(join(tmpdir(), "maker-init-preflight-"));
  try {
    const expected = await applyEngine(staging, ctx, agents);
    const collisions = new Map<string, InitCollision>();

    for (const file of expected) {
      const parts = file.rel.split("/");
      let blockedByAncestor = false;
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join("/");
        const metadata = await lstatIfPresent(join(targetDir, ancestor));
        if (metadata && !metadata.isDirectory()) {
          collisions.set(ancestor, {
            path: ancestor,
            reason: "deveria ser um diretório",
            removeBeforeApply: true,
          });
          blockedByAncestor = true;
          break;
        }
      }
      if (blockedByAncestor) continue;

      const destination = join(targetDir, file.rel);
      const metadata = await lstatIfPresent(destination);
      if (!metadata) continue;
      if (!metadata.isFile()) {
        collisions.set(file.rel, {
          path: file.rel,
          reason: "deveria ser um arquivo regular",
          removeBeforeApply: true,
        });
        continue;
      }
      const [current, rendered] = await Promise.all([
        readFile(destination),
        readFile(join(staging, file.rel)),
      ]);
      if (!current.equals(rendered)) {
        collisions.set(file.rel, {
          path: file.rel,
          reason: "conteúdo diferente",
          removeBeforeApply: false,
        });
      }
    }

    return [...collisions.values()].sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function formatCollisions(collisions: InitCollision[]): string {
  return collisions.map((collision) => `  - ${collision.path}: ${collision.reason}`).join("\n");
}
