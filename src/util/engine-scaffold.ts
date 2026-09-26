import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import fg from "fast-glob";
import { render, type RenderContext } from "../render/engine.js";
import { manifestKey, sha256, type ManifestEntry } from "../render/manifest.js";
import type { AgentProvider } from "../config/schema.js";
import { applyTree, templatesDir, type AppliedFile } from "./scaffold.js";
import { adapterInstruction } from "../agents/reference.js";

const HBS_EXT = ".hbs";

export async function applyEngine(
  targetDir: string,
  ctx: RenderContext,
  agents: AgentProvider[],
): Promise<AppliedFile[]> {
  const applied = await applyTree(templatesDir("engine/common"), targetDir, ctx, "engine:common");
  applied.push(...(await applySharedAgents(targetDir, ctx)));
  for (const agent of agents) applied.push(...(await applyProviderAdapter(targetDir, ctx, agent)));
  return applied;
}

export async function applyAgentProvider(
  targetDir: string,
  ctx: RenderContext,
  provider: AgentProvider,
): Promise<AppliedFile[]> {
  const sharedRoot = join(targetDir, ".maker/workflow/agents");
  return [
    ...(existsSync(sharedRoot) ? [] : await applySharedAgents(targetDir, ctx)),
    ...(await applyProviderAdapter(targetDir, ctx, provider)),
  ];
}

async function applyProviderAdapter(
  targetDir: string,
  ctx: RenderContext,
  provider: AgentProvider,
): Promise<AppliedFile[]> {
  const staticTree = templatesDir(`engine/providers/${provider}`);
  const applied = existsSync(staticTree)
    ? await applyTree(staticTree, targetDir, ctx, `engine:${provider}`)
    : [];
  applied.push(...(await applySkills(targetDir, ctx, provider)));
  applied.push(...(await applyAgents(targetDir, ctx, provider)));
  return applied;
}

async function applySkills(
  targetDir: string,
  ctx: RenderContext,
  provider: AgentProvider,
): Promise<AppliedFile[]> {
  const root = templatesDir("engine/workflow/skills");
  const files = await fg("**/*", { cwd: root, dot: true, onlyFiles: true });
  const outputRoot = provider === "claude" ? ".claude/skills" : ".agents/skills";
  const applied: AppliedFile[] = [];

  for (const relSrc of files) {
    const isTemplate = relSrc.endsWith(HBS_EXT);
    const rel = isTemplate ? relSrc.slice(0, -HBS_EXT.length) : relSrc;
    const absSrc = join(root, relSrc);
    const absOut = join(targetDir, outputRoot, rel);
    await mkdir(dirname(absOut), { recursive: true });

    if (!isTemplate && !rel.endsWith(".md")) {
      await copyFile(absSrc, absOut);
    } else {
      const raw = await readFile(absSrc, "utf-8");
      const rendered = isTemplate ? render(raw, ctx) : raw;
      const content = provider === "codex" && rel.endsWith("SKILL.md")
        ? codexSkill(rendered)
        : provider === "codex"
          ? adaptCodexText(rendered)
          : rendered;
      await writeFile(absOut, content, "utf-8");
    }
    applied.push(await appliedEntry(targetDir, absOut, `engine:${provider}`));
  }
  return applied;
}

async function applyAgents(
  targetDir: string,
  ctx: RenderContext,
  provider: AgentProvider,
): Promise<AppliedFile[]> {
  const root = templatesDir("engine/workflow/agents");
  const files = await fg("*.md{,.hbs}", { cwd: root, onlyFiles: true });
  const applied: AppliedFile[] = [];

  for (const relSrc of files) {
    const raw = await readFile(join(root, relSrc), "utf-8");
    const rendered = relSrc.endsWith(HBS_EXT) ? render(raw, ctx) : raw;
    const parsed = parseFrontmatter(rendered);
    const fileName = relSrc.replace(/\.md(?:\.hbs)?$/, provider === "claude" ? ".md" : ".toml");
    const absOut = join(
      targetDir,
      provider === "claude" ? ".claude/agents" : ".codex/agents",
      fileName,
    );
    await mkdir(dirname(absOut), { recursive: true });
    const sharedPath = `.maker/workflow/agents/${parsed.name}.md`;
    const content = provider === "claude"
      ? `---\n${parsed.frontmatter}\n---\n\n${adapterInstruction(sharedPath)}`
      : [
          `name = ${JSON.stringify(parsed.name)}`,
          `description = ${JSON.stringify(adaptCodexText(parsed.description))}`,
          `developer_instructions = ${JSON.stringify(adapterInstruction(sharedPath).replace(/`/g, ""))}`,
          "",
        ].join("\n");
    await writeFile(absOut, content, "utf-8");
    applied.push(await appliedEntry(targetDir, absOut, `engine:${provider}`));
  }
  return applied;
}

async function applySharedAgents(targetDir: string, ctx: RenderContext): Promise<AppliedFile[]> {
  const root = templatesDir("engine/workflow/agents");
  const files = await fg("*.md{,.hbs}", { cwd: root, onlyFiles: true });
  const applied: AppliedFile[] = [];
  for (const relSrc of files) {
    const raw = await readFile(join(root, relSrc), "utf-8");
    const rendered = relSrc.endsWith(HBS_EXT) ? render(raw, ctx) : raw;
    const parsed = parseFrontmatter(rendered);
    const absOut = join(targetDir, ".maker/workflow/agents", `${parsed.name}.md`);
    await mkdir(dirname(absOut), { recursive: true });
    await writeFile(absOut, `${adaptSharedAgentText(parsed.body.trim())}\n`, "utf-8");
    applied.push(await appliedEntry(targetDir, absOut, "engine:common"));
  }
  return applied;
}

function parseFrontmatter(input: string): {
  name: string;
  description: string;
  frontmatter: string;
  body: string;
} {
  const match = input.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("Template de agente sem frontmatter YAML.");
  const frontmatter = match[1]!;
  const name = frontmatter.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  if (!name) throw new Error("Template de agente sem name.");
  const block = frontmatter.match(/^description:\s*\|\n((?:[ \t]+.*\n?)*)/m)?.[1];
  const inline = frontmatter.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m)?.[1];
  const description = (block ? block.replace(/^\s+/gm, " ") : inline ?? name)
    .replace(/\s+/g, " ")
    .trim();
  return { name, description, frontmatter, body: match[2]! };
}

function codexSkill(input: string): string {
  const parsed = parseFrontmatter(input);
  const body = adaptCodexText(parsed.body).replace(
    /\$ARGUMENTS/g,
    `o texto da mensagem do usuário que acompanha \`$${parsed.name}\``,
  );
  return `---\nname: ${parsed.name}\ndescription: ${adaptCodexText(parsed.description)}\n---\n${body}`;
}

function adaptCodexText(input: string): string {
  return input
    .replace(/\.claude\/skills/g, ".agents/skills")
    .replace(
      /\/(run-spec|run-brainstorm|speckit-[a-z0-9-]+|fix-on-validation)\b/g,
      (_match, name: string) => `$${name}`,
    )
    .replace(/Generated with \[Claude Code\]\([^)]*\)/g, "Generated with maker on Codex")
    .replace(/CLAUDE\.md\/Auto Memory/g, "AGENTS.md/memória do projeto")
    .replace(/Claude Preview/g, "automação de browser disponível")
    .replace(/Chrome MCP/g, "automação de browser disponível")
    .replace(/Claude Code/g, "Codex")
    .replace(/\(Skill tool\)/g, "(skill disponível)")
    .replace(/subagent_type:/g, "agent:");
}

function adaptSharedAgentText(input: string): string {
  return input
    .replace(/Claude Preview/g, "automação de browser disponível")
    .replace(/Chrome MCP/g, "automação de browser disponível")
    .replace(/mcp__Claude_Preview__[a-z0-9_]+/gi, "uma ferramenta de browser disponível")
    .replace(/mcp__claude-in-chrome__[a-z0-9_]+/gi, "uma ferramenta de browser disponível")
    .replace(/\.claude\/launch\.json/g, "a configuração de execução do agente")
    .replace(/Claude Code/g, "a CLI agêntica");
}

async function appliedEntry(targetDir: string, absOut: string, source: string): Promise<AppliedFile> {
  const entry: ManifestEntry = { hash: sha256(await readFile(absOut)), source };
  return { rel: manifestKey(targetDir, absOut), entry };
}
