import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pc from "picocolors";
import { agentProviderSchema, parseConfig, type AgentProvider, type MakerConfig } from "../config/schema.js";
import { buildContext } from "../render/engine.js";
import { enabledAgents, readManifest, writeManifest } from "../render/manifest.js";
import { applyAgentProvider } from "../util/engine-scaffold.js";
import { validateAgentIntegration } from "../agents/validate.js";

export interface AgentAddOptions {
  target?: string;
  config?: string;
}

export async function runAgentAdd(providerInput: string, opts: AgentAddOptions): Promise<void> {
  const provider = agentProviderSchema.parse(providerInput);
  const targetDir = resolve(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir} — rode 'maker init' antes.`);

  const agents = enabledAgents(manifest);
  if (agents.includes(provider)) {
    console.log(pc.dim(`Integração ${provider} já está habilitada.`));
    return;
  }

  const config = await resolveRenderConfig(targetDir, manifest.config, opts.config);
  await assertNoUnmanagedProviderFiles(
    targetDir,
    provider,
    manifest.files,
    buildContext(config),
  );
  const applied = await applyAgentProvider(targetDir, buildContext(config), provider);
  for (const file of applied) manifest.files[file.rel] = file.entry;
  manifest.schemaVersion = 3;
  manifest.config = config;
  manifest.agents = [...agents, provider];
  await writeManifest(targetDir, manifest);

  const sigil = provider === "codex" ? "$" : "/";
  console.log(pc.green(`✓ Integração ${provider} adicionada (${applied.length} arquivos).`));
  console.log(`  Use ${pc.cyan(`${sigil}run-brainstorm`)} ou ${pc.cyan(`${sigil}run-spec`)}.`);
}

export async function runAgentList(opts: { target?: string }): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const enabled = new Set(enabledAgents(manifest));

  console.log(pc.dim(`Projeto "${manifest.project.name}"`));
  for (const provider of agentProviderSchema.options) {
    if (!enabled.has(provider)) {
      console.log(`  ${provider}: ${pc.dim("não habilitada")}`);
      continue;
    }
    const validation = await validateAgentIntegration(targetDir, provider);
    const status = validation.issues.length ? pc.red("degradada") : pc.green("íntegra");
    console.log(`  ${provider}: ${status} · ${validation.skills} skills · ${validation.agents} agentes`);
    for (const issue of validation.issues) console.log(pc.red(`    ${issue}`));
  }
}

async function resolveRenderConfig(
  targetDir: string,
  stored: MakerConfig | undefined,
  explicitPath: string | undefined,
): Promise<MakerConfig> {
  if (stored) return parseConfig(stored);
  const path = explicitPath ? resolve(explicitPath) : join(targetDir, "maker.config.json");
  if (!existsSync(path)) {
    throw new Error(
      "Este install usa um manifest legado sem a configuração de renderização. " +
      "Forneça --config <maker.config.json> para adicionar outra integração com segurança.",
    );
  }
  return parseConfig(JSON.parse(await readFile(path, "utf-8")));
}

async function assertNoUnmanagedProviderFiles(
  targetDir: string,
  provider: AgentProvider,
  managed: Record<string, unknown>,
  ctx: ReturnType<typeof buildContext>,
): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), "maker-agent-preflight-"));
  let expected: string[];
  try {
    expected = (await applyAgentProvider(staging, ctx, provider)).map((file) => file.rel);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const collisions = expected.filter(
    (rel) => existsSync(join(targetDir, rel)) && !(rel in managed),
  );
  if (collisions.length) {
    throw new Error(
      `A integração ${provider} não foi adicionada porque estes arquivos já existem e não ` +
      `pertencem ao manifest do maker:\n  - ${collisions.join("\n  - ")}\n` +
      "Mova ou renomeie esses arquivos e execute o comando novamente; nenhuma alteração foi feita.",
    );
  }
}
