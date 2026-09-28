import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initInstall } from "../helpers/state.js";
import { FORMAT_OPT_OUT_SNIPPET } from "../../src/state/format.js";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";

const DOC_PATH = join(__dirname, "..", "..", "docs", "maker-state.md");

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function readDoc(): Promise<string> {
  return readFile(DOC_PATH, "utf-8");
}

/** Simula os quatro temporários que um install em uso pode ter (nunca versionados). */
async function createTemporaries(target: string): Promise<void> {
  await mkdir(join(target, ".maker/transactions"), { recursive: true });
  await writeFile(join(target, ".maker/transaction.lock"), "");
  await mkdir(join(target, ".maker/mediation"), { recursive: true });
  await mkdir(join(target, ".maker/runs"), { recursive: true });
}

describe("docs/maker-state.md — AC-28: taxonomia contra install de referência", () => {
  it("classifica cada item presente num install pack (Claude + Codex + saas), incluindo temporários", async () => {
    const target = await initInstall("maker-state-doc-pack-", { agents: ["claude", "codex"], addon: "saas", format: "pack" });
    directories.push(target);
    await createTemporaries(target);
    const doc = await readDoc();

    // Estado autoritativo + snapshots, no compacto: um único arquivo, documentado como contendo os dois.
    expect(doc).toContain(LOCKFILE.replace(".maker/", ""));
    expect(doc.toLowerCase()).toContain("estado autoritativo");
    expect(doc.toLowerCase()).toContain("snapshot");
    // AC-28: deixa explícito que em pack manifest.json/bases/ não existem.
    expect(doc).toContain(MANIFEST_FILE.replace(".maker/", ""));
    expect(doc).toMatch(/manifest\.json.{0,80}(não existe|deixam de existir)|(não existe|deixam de existir).{0,80}manifest\.json/is);
    expect(doc).toContain(BASES_DIR.replace(".maker/", ""));

    // Arquivos gerenciados (papéis do pipeline).
    expect(doc).toContain("workflow/agents");

    // Add-on: estado de add-on é estado autoritativo.
    expect(doc).toContain("addons/");

    // Arquivos de controle do git.
    expect(doc).toContain(".gitattributes");
    expect(doc).toContain(".gitignore");

    // Temporários: todos os quatro citados como não versionados.
    for (const item of ["transactions", "transaction.lock", "mediation", "runs"]) {
      expect(doc).toContain(item);
    }
  });

  it("classifica os mesmos itens no formato files (bases por arquivo + manifest.json)", async () => {
    const target = await initInstall("maker-state-doc-files-", { agents: ["claude", "codex"], addon: "saas", format: "files" });
    directories.push(target);
    await createTemporaries(target);
    const doc = await readDoc();

    expect(doc).toContain("manifest.json");
    expect(doc).toContain(".maker/bases/");
    expect(doc.toLowerCase()).toContain("uma base por arquivo");
  });
});

describe("docs/maker-state.md — AC-29: escolha, troca de formato e diagnóstico", () => {
  it("documenta a chave state.bases, o default, os trade-offs e o procedimento de migração", async () => {
    const doc = await readDoc();

    expect(doc).toContain("state.bases");
    expect(doc).toContain('"pack"');
    expect(doc).toContain('"files"');
    // Default explícito.
    expect(doc.toLowerCase()).toMatch(/default/);

    // Trade-offs obrigatórios (FR-002).
    expect(doc.toLowerCase()).toContain("legibilidade");
    expect(doc.toLowerCase()).toContain("ruído de diff");
    expect(doc).toContain("linguist-generated");
    expect(doc).toContain("Load diff");
    expect(doc).toContain("git diff -- .maker/maker.lock");
    expect(doc).toContain(".git/info/attributes");
    expect(doc.toLowerCase()).toContain("conflito");

    // Procedimento de migração.
    expect(doc).toContain("maker update");
    expect(doc).toContain(FORMAT_OPT_OUT_SNIPPET);

    // Diagnóstico e recuperação: cada situação do contrato coberta.
    const lower = doc.toLowerCase();
    for (const term of [
      "coexistência", "ilegível", "versão de formato desconhecida", "base ausente", "base corrompida",
      "crlf", "manifest", "bases", "maker.config.json", "transação pendente",
    ]) {
      expect(lower).toContain(term);
    }
    expect(doc).toContain("maker doctor");
    expect(doc).toContain("íntegro");
  });

  it("registra a mudança de default para pack e a instrução de opt-out (FR-006a)", async () => {
    const doc = await readFile(join(__dirname, "..", "..", "docs", "MIGRATION.md"), "utf-8");

    expect(doc).toContain("Bases no formato pack por padrão");
    expect(doc.toLowerCase()).toContain('formato padrão');
    expect(doc).toContain(FORMAT_OPT_OUT_SNIPPET);
    expect(doc.toLowerCase()).toContain("atualize o maker em todo o time e na ci antes de migrar");
    expect(doc).toContain("init --force");
  });

  it("README aponta para a documentação de estado em vez de citar só manifest.json", async () => {
    const readme = await readFile(join(__dirname, "..", "..", "README.md"), "utf-8");

    expect(readme).toContain("docs/maker-state.md");
  });
});
