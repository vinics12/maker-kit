import { afterEach, describe, expect, it } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateAgentIntegration } from "../../src/agents/validate.js";
import { initInstall } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const SKILL = ".claude/skills/run-spec/SKILL.md";
const AGENT = ".claude/agents/architect.md";

function toCRLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

describe("validação de integração aceita CRLF (T406)", () => {
  it("skill e agente Claude em LF: frontmatter válido, sem issue", async () => {
    const target = await initInstall("maker-validate-lf-");
    directories.push(target);
    const validation = await validateAgentIntegration(target, "claude");
    expect(validation.issues).not.toContain(expect.stringContaining("frontmatter"));
  });

  it("skill e agente Claude convertidos para CRLF (core.autocrlf=true): frontmatter continua válido", async () => {
    const target = await initInstall("maker-validate-crlf-");
    directories.push(target);
    for (const rel of [SKILL, AGENT]) {
      const path = join(target, rel);
      await writeFile(path, toCRLF(await readFile(path, "utf-8")), "utf-8");
    }
    const validation = await validateAgentIntegration(target, "claude");
    expect(validation.issues.filter((issue) => issue.includes("frontmatter"))).toEqual([]);
  });

  it("skill com frontmatter realmente inválido continua reprovada, em LF e em CRLF", async () => {
    const target = await initInstall("maker-validate-skill-invalid-");
    directories.push(target);
    const path = join(target, SKILL);
    const broken = "---\nname: run-spec\n"; // sem `description` e sem `---` de fechamento
    await writeFile(path, broken, "utf-8");
    const lf = await validateAgentIntegration(target, "claude");
    expect(lf.issues).toContain(`.claude/skills/run-spec/SKILL.md: frontmatter name/description inválido`);

    await writeFile(path, toCRLF(broken), "utf-8");
    const crlf = await validateAgentIntegration(target, "claude");
    expect(crlf.issues).toContain(`.claude/skills/run-spec/SKILL.md: frontmatter name/description inválido`);
  });

  it("agente Claude com frontmatter realmente inválido continua reprovado, em LF e em CRLF", async () => {
    const target = await initInstall("maker-validate-agent-invalid-");
    directories.push(target);
    const path = join(target, AGENT);
    const original = await readFile(path, "utf-8");
    const body = original.slice(original.indexOf("---", 3) + 3); // corpo depois do frontmatter original
    const broken = `---\nname: architect\n${body}`; // sem `description` nem `---` de fechamento do bloco
    await writeFile(path, broken, "utf-8");
    const lf = await validateAgentIntegration(target, "claude");
    expect(lf.issues).toContain(".claude/agents/architect.md: frontmatter inválido");

    await writeFile(path, toCRLF(broken), "utf-8");
    const crlf = await validateAgentIntegration(target, "claude");
    expect(crlf.issues).toContain(".claude/agents/architect.md: frontmatter inválido");
  });
});
