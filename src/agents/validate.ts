import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { AgentProvider } from "../config/schema.js";
import { readManifest } from "../render/manifest.js";

export interface AgentValidation {
  provider: AgentProvider;
  skills: number;
  agents: number;
  issues: string[];
}

const codexAgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  developer_instructions: z.string().min(1),
});

export async function validateAgentIntegration(
  targetDir: string,
  provider: AgentProvider,
): Promise<AgentValidation> {
  const skillRoot = join(targetDir, provider === "claude" ? ".claude/skills" : ".agents/skills");
  const agentRoot = join(targetDir, provider === "claude" ? ".claude/agents" : ".codex/agents");
  const skillFiles = existsSync(skillRoot)
    ? await fg("**/SKILL.md", { cwd: skillRoot, onlyFiles: true })
    : [];
  const agentFiles = existsSync(agentRoot)
    ? await fg(provider === "claude" ? "*.md" : "*.toml", { cwd: agentRoot, onlyFiles: true })
    : [];
  const issues: string[] = [];
  const manifest = await readManifest(targetDir);
  const adapterRoot = relativeRoot(provider, "agents");
  for (const path of Object.keys(manifest?.files ?? {}).sort()) {
    if (path.startsWith(`${adapterRoot}/`) && !existsSync(join(targetDir, path))) {
      issues.push(`${path}: arquivo de adapter ausente; execute maker update --dry-run para revisar a restauração`);
    }
  }

  if (!existsSync(join(targetDir, "AGENTS.md"))) issues.push("AGENTS.md ausente");
  if (skillFiles.length === 0) issues.push(`${relativeRoot(provider, "skills")} sem skills`);
  if (agentFiles.length === 0) issues.push(`${relativeRoot(provider, "agents")} sem agentes`);

  for (const rel of skillFiles) {
    const path = join(skillRoot, rel);
    const content = await readFile(path, "utf-8");
    if (!/^---\n[\s\S]*?^name:\s*.+$[\s\S]*?^description:\s*.+$[\s\S]*?^---$/m.test(content)) {
      issues.push(`${relativeRoot(provider, "skills")}/${rel}: frontmatter name/description inválido`);
    }
    if (provider === "codex" && /\/(?:run-spec|run-brainstorm|speckit-[a-z0-9-]+)\b/.test(content)) {
      issues.push(`${relativeRoot(provider, "skills")}/${rel}: referência slash incompatível com Codex`);
    }
  }

  for (const rel of agentFiles) {
    const path = join(agentRoot, rel);
    const content = await readFile(path, "utf-8");
    if (provider === "codex") {
      try {
        codexAgentSchema.parse(parseToml(content));
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
        issues.push(`.codex/agents/${rel}: TOML inválido (${message})`);
        continue;
      }
    } else if (!/^---\n[\s\S]*?^name:\s*.+$[\s\S]*?^description:\s*[|"']?.+$[\s\S]*?^---$/m.test(content)) {
      issues.push(`.claude/agents/${rel}: frontmatter inválido`);
    }

    const shared = content.match(/\.maker\/workflow\/agents\/[a-z0-9-]+\.md/)?.[0];
    const adapterPath = `${adapterRoot}/${rel}`;
    if (!shared) {
      const expected = `.maker/workflow/agents/${rel.replace(/\.(md|toml)$/, "")}.md`;
      const source = manifest?.files[adapterPath]?.source;
      issues.push(`${adapterPath}: referência ao papel compartilhado ausente; esperado ${expected}` +
        (source ? `; origem ${source}` : "") +
        "; o update preserva conteúdo local/add-on sem migração segura. Execute maker update --dry-run para revisar o reparo; preserve as customizações e não reaplique o add-on apenas para corrigir o adapter");
    } else if (!existsSync(join(targetDir, shared))) {
      issues.push(`${adapterPath}: arquivo do papel compartilhado ausente: ${shared}; execute maker update --dry-run para revisar a restauração`);
    }
  }

  if (provider === "claude" && !existsSync(join(targetDir, "CLAUDE.md"))) {
    issues.push("CLAUDE.md ausente");
  }

  return { provider, skills: skillFiles.length, agents: agentFiles.length, issues };
}

function relativeRoot(provider: AgentProvider, kind: "skills" | "agents"): string {
  if (provider === "claude") return kind === "skills" ? ".claude/skills" : ".claude/agents";
  return kind === "skills" ? ".agents/skills" : ".codex/agents";
}
