import { resolve, join } from "node:path";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pc from "picocolors";
import { loadConfig } from "../config/load.js";
import { buildContext } from "../render/engine.js";
import { type Manifest } from "../render/manifest.js";
import { makerVersion } from "../util/version.js";
import { applyEngine } from "../util/engine-scaffold.js";
import { readManifest, enabledAgents } from "../render/manifest.js";
import { parseConfig, type AgentProvider } from "../config/schema.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan, assertNoPendingTransactions } from "../changes/transaction.js";

export interface InitOptions {
  target?: string;
  config?: string;
  yes?: boolean;
  name?: string;
  agent?: AgentProvider;
  force?: boolean;
  dryRun?: boolean;
}

interface InitCollision {
  path: string;
  reason: string;
  removeBeforeApply: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  if (opts.dryRun) await assertNoPendingTransactions(targetDir);
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
  if (collisions.length && !opts.force && !opts.dryRun) {
    throw new Error(
      "A instalação não foi iniciada porque estes caminhos possuem conteúdo diferente ou " +
      `estrutura incompatível:\n${formatCollisions(collisions)}\n` +
      "Revise os arquivos ou execute novamente com --force para substituí-los; " +
      "nenhuma alteração foi feita.",
    );
  }
  if (collisions.length && opts.force && !opts.dryRun) {
    console.log(pc.yellow("\n⚠ --force substituirá estes caminhos:"));
    for (const collision of collisions) {
      console.log(pc.yellow(`  ${collision.path} (${collision.reason})`));
    }
  }

  const staging = await mkdtemp(join(tmpdir(), "maker-init-plan-"));
  const changes: PlannedChange[] = [];
  const renderedByPath = new Map<string, Buffer>();
  let applied: Awaited<ReturnType<typeof applyEngine>>;
  try {
    applied = await applyEngine(staging, ctx, agents);
    const blocked = new Set(collisions.map((collision) => collision.path));
    if (!opts.force) {
      for (const collision of collisions) {
        const current = await inspectTarget(targetDir, collision.path);
        changes.push({
          path: collision.path,
          action: "conflict",
          source: "engine",
          reason: collision.reason,
          expectedHash: current.hash,
          expectedKind: current.kind,
        });
      }
    }
    if (opts.force) {
      for (const collision of collisions.filter((item) => item.removeBeforeApply)) {
        if (applied.some((file) => file.rel === collision.path)) continue;
        const current = await inspectTarget(targetDir, collision.path);
        changes.push({
          path: collision.path,
          action: "remove",
          source: "engine",
          reason: collision.reason,
          expectedHash: current.hash,
          expectedKind: current.kind,
        });
      }
    }
    for (const file of applied) {
      const blockedBy = [...blocked].find(
        (path) => file.rel === path || file.rel.startsWith(`${path}/`),
      );
      if (blockedBy && !opts.force) continue;
      const rendered = await readFile(join(staging, file.rel));
      renderedByPath.set(file.rel, rendered);
      changes.push(await planWrite({
        targetDir,
        path: file.rel,
        content: rendered,
        source: file.entry.source,
        reason: "conteúdo renderizado pelo maker",
        force: !!opts.force,
      }));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  const manifest: Manifest = {
    schemaVersion: 3,
    makerVersion: makerVersion(),
    project: { name: config.project.name, slug: config.project.slug! },
    config,
    agents,
    installedAt: priorManifest?.installedAt ?? new Date().toISOString(),
    files: Object.fromEntries(applied.map((a) => [a.rel, { ...a.entry, baseHash: a.entry.hash }])),
  };
  const bases = new Map<string, Buffer>();
  for (const file of applied) bases.set(file.entry.hash, renderedByPath.get(file.rel)!);
  for (const [hash, content] of bases) {
    changes.push(await planWrite({
      targetDir,
      path: `.maker/bases/${hash}`,
      content,
      source: "metadata",
      reason: "base upstream inicial",
    }));
  }
  changes.push(await planWrite({
    targetDir,
    path: ".maker/manifest.json",
    content: JSON.stringify(manifest, null, 2) + "\n",
    source: "metadata",
    reason: "publicar manifest da instalação",
    force: true,
  }));
  const plan = createPlan(targetDir, changes);
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    if (plan.changes.some((change) => change.action === "conflict")) process.exitCode = 1;
    return;
  }
  await applyChangePlan(plan);

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
