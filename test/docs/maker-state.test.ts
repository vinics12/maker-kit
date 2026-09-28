import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { initInstall } from "../helpers/state.js";
import { FORMAT_OPT_OUT_SNIPPET } from "../../src/state/format.js";

const DOC_PATH = join(__dirname, "..", "..", "docs", "maker-state.md");
const MIGRATION_PATH = join(__dirname, "..", "..", "docs", "MIGRATION.md");
const README_PATH = join(__dirname, "..", "..", "README.md");

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function readDoc(): Promise<string> {
  return readFile(DOC_PATH, "utf-8");
}

/** Itens (coluna 1) da tabela de taxonomia do §1 — uma linha por item. */
function taxonomyItems(doc: string): string[] {
  return doc.split("\n")
    .filter((line) => line.startsWith("| `.maker/"))
    .map((line) => line.split("|")[1]!.trim().replace(/`/g, ""));
}

/** Simula os quatro temporários com conteúdo real (nunca versionados, cobertos pelo .gitignore). */
async function createTemporaries(target: string): Promise<void> {
  await mkdir(join(target, ".maker/transactions"), { recursive: true });
  await writeFile(join(target, ".maker/transactions/tx-1.json"), "{}");
  await writeFile(join(target, ".maker/transaction.lock"), "");
  await mkdir(join(target, ".maker/mediation/items"), { recursive: true });
  await writeFile(join(target, ".maker/mediation/items/README.md"), "");
  await mkdir(join(target, ".maker/runs"), { recursive: true });
  await writeFile(join(target, ".maker/runs/run-1.jsonl"), "");
}

async function walkMaker(target: string): Promise<string[]> {
  const root = join(target, ".maker");
  const out: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await visit(abs);
      else out.push(relative(root, abs).split("\\").join("/"));
    }
  };
  await visit(root);
  return out;
}

/** Normaliza um caminho real (relativo a `.maker`) para a forma canônica usada na tabela do §1. */
function canonicalize(relPath: string): string {
  if (relPath === "maker.lock") return ".maker/maker.lock";
  if (relPath === "manifest.json") return ".maker/manifest.json";
  if (relPath === ".gitattributes") return ".maker/.gitattributes";
  if (relPath === ".gitignore") return ".maker/.gitignore";
  if (/^bases\/[0-9a-f]{64}$/.test(relPath)) return ".maker/bases/<hash>";
  if (/^addons\/[^/]+\.json$/.test(relPath)) return ".maker/addons/<id>.json";
  if (/^workflow\/agents\/[^/]+\.md$/.test(relPath)) return ".maker/workflow/agents/*.md";
  if (relPath === "transaction.lock") return ".maker/transaction.lock";
  if (relPath.startsWith("transactions/")) return ".maker/transactions/";
  if (relPath.startsWith("mediation/")) return ".maker/mediation/";
  if (relPath.startsWith("runs/")) return ".maker/runs/";
  throw new Error(`item sem normalização conhecida: .maker/${relPath}`);
}

describe("docs/maker-state.md — AC-28: taxonomia contra o install de referência real", () => {
  it("pack: cada item do install real tem linha na tabela; maker.lock aparece uma única vez; 16 versionados", async () => {
    const target = await initInstall("maker-state-doc-pack-", { agents: ["claude", "codex"], addon: "saas", format: "pack" });
    directories.push(target);
    await createTemporaries(target);

    const doc = await readDoc();
    const items = taxonomyItems(doc);
    const itemSet = new Set(items);

    const found = await walkMaker(target);
    const canonical = found.map(canonicalize);
    for (const item of new Set(canonical)) {
      expect(itemSet.has(item), `item ${item} sem linha na tabela do §1`).toBe(true);
    }

    // maker.lock aparece em exatamente uma linha.
    expect(items.filter((item) => item === ".maker/maker.lock")).toHaveLength(1);

    // 16 arquivos versionados: tudo, menos os temporários (cobertos pelo .gitignore).
    const versioned = found.filter((rel) => canonicalize(rel) !== ".maker/transactions/"
      && canonicalize(rel) !== ".maker/transaction.lock" && canonicalize(rel) !== ".maker/mediation/"
      && canonicalize(rel) !== ".maker/runs/");
    expect(versioned).toHaveLength(16);
  });

  it("files: cada item do install real tem linha na tabela (manifest.json + bases por arquivo)", async () => {
    const target = await initInstall("maker-state-doc-files-", { agents: ["claude", "codex"], addon: "saas", format: "files" });
    directories.push(target);
    await createTemporaries(target);

    const doc = await readDoc();
    const itemSet = new Set(taxonomyItems(doc));

    const found = await walkMaker(target);
    const canonical = found.map(canonicalize);
    for (const item of new Set(canonical)) {
      expect(itemSet.has(item), `item ${item} sem linha na tabela do §1`).toBe(true);
    }
    expect(canonical).toContain(".maker/manifest.json");
    expect(canonical).toContain(".maker/bases/<hash>");
    expect(canonical).not.toContain(".maker/maker.lock");
  });
});

describe("docs/maker-state.md — AC-29: escolha, troca de formato e diagnóstico", () => {
  it("documenta a chave state.bases, o default, os trade-offs e o procedimento de migração", async () => {
    const doc = await readDoc();

    expect(doc).toContain("state.bases");
    expect(doc).toContain('"pack"');
    expect(doc).toContain('"files"');
    expect(doc.toLowerCase()).toMatch(/default/);

    // Trade-offs obrigatórios.
    expect(doc.toLowerCase()).toContain("legibilidade");
    expect(doc.toLowerCase()).toContain("ruído de diff");
    expect(doc).toContain("linguist-generated");
    expect(doc).toContain("Load diff");
    expect(doc).toContain("git diff -- .maker/maker.lock");
    expect(doc).toContain(".git/info/attributes");
    expect(doc.toLowerCase()).toContain("conflito");

    // Sem link para o contrato (podado no Gate 4) — o formato é descrito no próprio doc.
    expect(doc).not.toContain("contracts/lockfile-format.md");

    // Procedimento de migração.
    expect(doc).toContain("maker update");
    expect(doc).toContain(FORMAT_OPT_OUT_SNIPPET);

    // Diagnóstico e recuperação: cada situação do contrato coberta.
    const lower = doc.toLowerCase();
    for (const term of [
      "coexistência", "manifest ilegível", "lockfile ilegível", "versão de formato desconhecida",
      "base ausente", "base corrompida", "crlf", "maker.config.json", "transação pendente",
    ]) {
      expect(lower).toContain(term);
    }
    expect(doc).toContain("maker doctor");
    expect(doc.toLowerCase()).toContain("íntegro");

    // A saída do doctor citada é a real.
    expect(doc).toContain("Estado (.maker): íntegro");
    expect(doc).toContain("✓ Install íntegro.");
  });

  it("registra a mudança de default para pack e a instrução de opt-out (FR-006a)", async () => {
    const doc = await readFile(MIGRATION_PATH, "utf-8");

    expect(doc).toContain("Bases no formato pack por padrão");
    expect(doc.toLowerCase()).toContain("formato padrão");
    expect(doc).toContain(FORMAT_OPT_OUT_SNIPPET);
    expect(doc.toLowerCase()).toContain("atualize o maker em todo o time e na ci antes de migrar");
    expect(doc).toContain("init --force");

    // A saída do doctor citada é a real, não "Install íntegro (pack)".
    expect(doc).not.toContain("Install íntegro (pack)");
    expect(doc).toContain("Estado (.maker): íntegro (pack)");
    expect(doc).toContain("✓ Install íntegro.");
  });

  it("README aponta para a documentação de estado em vez de citar só manifest.json", async () => {
    const readme = await readFile(README_PATH, "utf-8");

    expect(readme).toContain("docs/maker-state.md");
  });
});
