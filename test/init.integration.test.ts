import { describe, it, expect, beforeAll } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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

async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await walk(dir);
  const result: Record<string, string> = {};
  for (const file of entries.sort()) {
    result[relative(dir, file)] = (await readFile(file)).toString("base64");
  }
  return result;
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
    expect(existsSync(join(target, "AGENTS.md"))).toBe(true);
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
    expect(m!.schemaVersion).toBe(2);
    expect(m!.agents).toEqual(["claude"]);
    expect(m!.config?.commands.verify).toBe("just verify");
    const r = await verifyManifest(target, m!);
    expect(r.ok, `missing=${r.missing}, modified=${r.modified}`).toBe(true);
    expect(r.checked).toBeGreaterThan(10);
  });
});

describe("maker init (preflight de colisões)", () => {
  it("aborta com todas as colisões e não altera o diretório-alvo", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-collision-"));
    await mkdir(join(target, ".specify/memory"), { recursive: true });
    await Promise.all([
      writeFile(join(target, "CLAUDE.md"), "claude do usuário\n"),
      writeFile(join(target, ".mcp.json"), '{"mcp":"usuario"}\n'),
      writeFile(join(target, ".gitattributes"), "*.custom text\n"),
      writeFile(join(target, "AGENTS.md"), "agentes do usuário\n"),
      writeFile(join(target, ".specify/memory/project-rules.md"), "regras do usuário\n"),
    ]);
    const before = await snapshot(target);

    await expect(runInit({ target, config: FIXTURE, yes: true })).rejects.toThrow(
      /\.gitattributes[\s\S]*\.mcp\.json[\s\S]*\.specify\/memory\/project-rules\.md[\s\S]*AGENTS\.md[\s\S]*CLAUDE\.md[\s\S]*nenhuma alteração foi feita/,
    );

    expect(await snapshot(target)).toEqual(before);
    expect(existsSync(join(target, ".maker/manifest.json"))).toBe(false);
  });

  it("aceita conteúdo idêntico e reutiliza config e installedAt do manifest", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-idempotent-"));
    await runInit({ target, config: FIXTURE, yes: true });
    const before = await readManifest(target);

    await runInit({ target, yes: true });

    const after = await readManifest(target);
    expect(after?.config).toEqual(before?.config);
    expect(after?.installedAt).toBe(before?.installedAt);
    expect((await verifyManifest(target, after!)).ok).toBe(true);
  });

  it("reporta colisão estrutural antes de escrever qualquer arquivo", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-structural-"));
    await writeFile(join(target, ".claude"), "não é diretório\n");
    await mkdir(join(target, "CLAUDE.md"));
    const before = await snapshot(target);

    const result = runInit({ target, config: FIXTURE, yes: true });
    await expect(result).rejects.toThrow(/\.claude: deveria ser um diretório/);
    await expect(result).rejects.toThrow(/CLAUDE\.md: deveria ser um arquivo regular/);
    expect(await snapshot(target)).toEqual(before);
    expect((await stat(join(target, "CLAUDE.md"))).isDirectory()).toBe(true);
  });

  it("--force lista e substitui colisões sem tocar em arquivos alheios", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-force-"));
    await writeFile(join(target, "CLAUDE.md"), "claude do usuário\n");
    await writeFile(join(target, ".mcp.json"), '{"mcp":"usuario"}\n');
    await writeFile(join(target, "arquivo-local.txt"), "preservar\n");
    const messages: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
    try {
      await runInit({ target, config: FIXTURE, yes: true, force: true });
    } finally {
      console.log = originalLog;
    }

    const output = messages.join("\n");
    expect(output).toContain("--force substituirá estes caminhos");
    expect(output).toContain("CLAUDE.md");
    expect(output).toContain(".mcp.json");
    expect(await readFile(join(target, "CLAUDE.md"), "utf-8")).not.toContain("do usuário");
    expect(await readFile(join(target, "arquivo-local.txt"), "utf-8")).toBe("preservar\n");
    const manifest = await readManifest(target);
    expect((await verifyManifest(target, manifest!)).ok).toBe(true);
  });

  it("--force substitui symlink sem seguir nem alterar seu destino", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "maker-init-outside-"));
    const externalFile = join(outside, "CLAUDE.md");
    await writeFile(externalFile, "conteúdo externo\n");
    await symlink(externalFile, join(target, "CLAUDE.md"));

    await runInit({ target, config: FIXTURE, yes: true, force: true });

    expect(await readFile(externalFile, "utf-8")).toBe("conteúdo externo\n");
    expect((await lstat(join(target, "CLAUDE.md"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(target, "CLAUDE.md"), "utf-8")).toContain("Nimbus Ledger");
  });
});
