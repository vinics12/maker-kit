import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runInit } from "../src/commands/init.js";
import { readManifest, verifyManifest } from "../src/render/manifest.js";

const FIXTURE = join(__dirname, "..", "fixtures", "example.config.json");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

describe("maker init (integração)", () => {
  let target: string;
  let files: string[];

  beforeAll(async () => {
    target = await mkdtemp(join(tmpdir(), "maker-it-"));
    await runInit({ target, config: FIXTURE, yes: true });
    files = await walk(target);
  }, 30_000);

  it("instala .specify e .claude", () => {
    expect(existsSync(join(target, ".specify"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "run-spec", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "agents", "architect.md"))).toBe(true);
    expect(existsSync(join(target, ".claude", "skills", "speckit-plan"))).toBe(true);
  });

  it("renderiza a identidade do projeto na constitution", async () => {
    const c = await readFile(join(target, ".specify", "memory", "constitution.md"), "utf-8");
    expect(c).toContain("Nimbus Ledger");
    expect(c).toContain("Princípios de Processo");
  });

  it("não deixa placeholders do maker por resolver (namespaces project/commands/layout/join/generatedAt)", async () => {
    // Arquivos stock do SpecKit usam {{ inputs.* }} próprio — não são placeholders do maker.
    const makerPlaceholder = /\{\{\s*(project|commands|layout|join|generatedAt)\b/;
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(".png") || f.includes("/.git/")) continue;
      const content = await readFile(f, "utf-8");
      if (makerPlaceholder.test(content)) offenders.push(f.replace(target, ""));
    }
    expect(offenders, `placeholders do maker em: ${offenders.join(", ")}`).toEqual([]);
  });

  it("ANTI-ACOPLAMENTO: sem regra de negócio fora de stubs", async () => {
    const businessRe =
      /\btenant\b|multi-?tenant|supabase|whitelabel|\brls\b|service_role|posthog|sentry|pg_boss|shadcn/i;
    const stubMarkers = /A PREENCHER|STUB|_\(nenhum|a preencher/i;
    const offenders: string[] = [];
    for (const f of files) {
      // stubs de memória são onde o projeto autora negócio — permitido lá
      const isMemoryStub = /\/\.specify\/memory\/(project-rules|product-overview)\.md$/.test(f);
      const content = await readFile(f, "utf-8").catch(() => "");
      content.split("\n").forEach((line, i) => {
        if (businessRe.test(line) && !(isMemoryStub && stubMarkers.test(content))) {
          offenders.push(`${f.replace(target, "")}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(offenders, `acoplamento de negócio:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("constitution tem os princípios de processo e NÃO os SaaS", async () => {
    const c = await readFile(join(target, ".specify", "memory", "constitution.md"), "utf-8");
    expect(c).toMatch(/PR1\./);
    expect(c).toMatch(/PR2\./);
    expect(c).not.toMatch(/Multi-Tenant First/i);
    expect(c).not.toMatch(/BFF Obrigatório/i);
  });

  it("manifest íntegro (doctor)", async () => {
    const m = await readManifest(target);
    expect(m).not.toBeNull();
    const r = await verifyManifest(target, m!);
    expect(r.ok, `missing=${r.missing}, modified=${r.modified}`).toBe(true);
    expect(r.checked).toBeGreaterThan(10);
  });
});
