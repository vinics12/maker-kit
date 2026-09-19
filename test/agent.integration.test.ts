import { describe, expect, it } from "vitest";
import { appendFile, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runInit } from "../src/commands/init.js";
import { runAgentAdd, runAgentList } from "../src/commands/agent.js";
import { readManifest, verifyManifest } from "../src/render/manifest.js";
import { runUpdate } from "../src/commands/update.js";
import { loadAddon } from "../src/addons/loader.js";
import { applyAddon } from "../src/addons/apply.js";
import { validateAgentIntegration } from "../src/agents/validate.js";

const FIXTURE = join(__dirname, "..", "fixtures", "example.config.json");

async function filesUnder(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    if ((await stat(path)).isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

describe("integrações de agentes", () => {
  it("instala Codex com skills, agentes TOML e AGENTS.md", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-codex-"));
    await runInit({ target, config: FIXTURE, agent: "codex", yes: true });

    expect(existsSync(join(target, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(target, ".agents/skills/run-spec/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".codex/agents/architect.toml"))).toBe(true);
    expect(existsSync(join(target, ".maker/workflow/agents/architect.md"))).toBe(true);
    expect(existsSync(join(target, ".claude"))).toBe(false);
    expect(existsSync(join(target, "CLAUDE.md"))).toBe(false);

    const skill = await readFile(join(target, ".agents/skills/run-spec/SKILL.md"), "utf-8");
    expect(skill).toContain("$run-brainstorm");
    expect(skill).not.toContain("/run-brainstorm");
    expect(skill).not.toContain("Claude Code");

    const agent = await readFile(join(target, ".codex/agents/architect.toml"), "utf-8");
    expect(agent).toMatch(/^name = "architect"/);
    expect(agent).toContain("developer_instructions = ");
    expect(agent).toContain(".maker/workflow/agents/architect.md");

    const codexFiles = [
      ...(await filesUnder(join(target, ".agents"))),
      ...(await filesUnder(join(target, ".codex"))),
    ];
    const leaks: string[] = [];
    for (const path of codexFiles) {
      const content = await readFile(path, "utf-8");
      if (
        /\.claude\b|Claude Code|Claude Preview|Chrome MCP/.test(content) ||
        /\/(?:run-spec|run-brainstorm|speckit-[a-z0-9-]+|fix-on-validation)\b/.test(content)
      ) leaks.push(path);
    }
    expect(leaks).toEqual([]);

    const manifest = await readManifest(target);
    expect(manifest?.agents).toEqual(["codex"]);
    expect((await verifyManifest(target, manifest!)).ok).toBe(true);
  });

  it("adiciona Codex sem alterar a integração Claude e é idempotente", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-agent-add-"));
    await runInit({ target, config: FIXTURE, yes: true });
    const claudePath = join(target, ".claude/agents/architect.md");
    const before = await readFile(claudePath, "utf-8");

    await runAgentAdd("codex", { target });
    await runAgentAdd("codex", { target });

    expect(await readFile(claudePath, "utf-8")).toBe(before);
    expect(existsSync(join(target, ".agents/skills/run-spec/SKILL.md"))).toBe(true);
    const manifest = await readManifest(target);
    expect(manifest?.agents).toEqual(["claude", "codex"]);
    expect((await verifyManifest(target, manifest!)).ok).toBe(true);
  });

  it("mantém customizações, add-ons e o conjunto de agentes durante add/update", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-agent-update-"));
    await runInit({ target, config: FIXTURE, yes: true });
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, {
      tenantColumn: "org_id",
      brandVarPrefix: "--tema-",
      roles: "owner,staff",
    });
    await runAgentAdd("codex", { target });
    await appendFile(join(target, "AGENTS.md"), "\n## Regra local\n", "utf-8");

    await runUpdate({ target });

    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toContain("Regra local");
    expect(await readFile(join(target, ".maker/workflow/agents/code-reviewer.md"), "utf-8"))
      .toContain("Checklist SaaS");
    expect(existsSync(join(target, ".codex/agents/code-reviewer.toml"))).toBe(true);
    expect((await readManifest(target))?.agents).toEqual(["claude", "codex"]);
  });

  it("lista integrações habilitadas e valida TOML do Codex", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-agent-list-"));
    await runInit({ target, config: FIXTURE, agent: "codex", yes: true });
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
    try {
      await runAgentList({ target });
    } finally {
      console.log = originalLog;
    }
    expect(messages.join("\n")).toContain("claude: não habilitada");
    expect(messages.join("\n")).toMatch(/codex: .*íntegra · \d+ skills · 12 agentes/);

    await writeFile(join(target, ".codex/agents/architect.toml"), "name = [toml quebrado", "utf-8");
    const validation = await validateAgentIntegration(target, "codex");
    expect(validation.issues.some((issue) => issue.includes("TOML inválido"))).toBe(true);
  });

  it("reporta colisões por arquivo e não faz escrita parcial", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-agent-collision-"));
    await runInit({ target, config: FIXTURE, yes: true });
    const collision = join(target, ".agents/skills/run-spec/SKILL.md");
    await mkdir(join(target, ".agents/skills/run-spec"), { recursive: true });
    await writeFile(collision, "arquivo do usuário\n", "utf-8");

    await expect(runAgentAdd("codex", { target })).rejects.toThrow(
      /\.agents\/skills\/run-spec\/SKILL\.md[\s\S]*nenhuma alteração foi feita/,
    );
    expect(await readFile(collision, "utf-8")).toBe("arquivo do usuário\n");
    expect((await readManifest(target))?.agents).toEqual(["claude"]);
    expect(existsSync(join(target, ".codex/agents/architect.toml"))).toBe(false);
  });
});
