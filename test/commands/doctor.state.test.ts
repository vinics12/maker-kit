import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BasesFormat } from "../../src/render/manifest.js";
import { runDoctor } from "../../src/commands/doctor.js";
import {
  corruptBase, initInstall, lockfileText, putBase, readManifest, removeBase, snapshotTree, writeManifest,
} from "../helpers/state.js";

const AGENTS = "AGENTS.md";

async function outputOf(action: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try { await action(); } finally { console.log = originalLog; }
  return messages.join("\n").replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "");
}

/** Registra `hash` como base upstream de AGENTS.md (arquivo gerenciado já intacto). */
async function referenceBase(target: string, hash: string): Promise<void> {
  const manifest = (await readManifest(target))!;
  manifest.files[AGENTS] = { ...manifest.files[AGENTS]!, baseHash: hash };
  await writeManifest(target, manifest);
}

describe.each<BasesFormat>(["files", "pack"])("maker doctor — Estado (.maker), formato %s", (format) => {
  it("AC-14: base referenciada ausente — falha citando arquivo e hash, ação de mediação, sai com código de erro", async () => {
    const target = await initInstall("maker-doctor-state-missing-", { format });
    const hash = await putBase(target, await readFile(join(target, AGENTS), "utf-8"));
    await referenceBase(target, hash);
    await removeBase(target, hash);

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain(`base ausente ${hash} (referenciada por ${AGENTS})`);
    expect(output).toContain("sem a base, o próximo maker update preserva o arquivo e pede mediação");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-15: base corrompida (hash não confere) — falha com ação de restaurar e .gitattributes", async () => {
    const target = await initInstall("maker-doctor-state-corrupt-", { format });
    const hash = await putBase(target, await readFile(join(target, AGENTS), "utf-8"));
    await referenceBase(target, hash);
    await corruptBase(target, hash);

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain(`base corrompida ${hash} [${format === "pack" ? "pack" : "files"}]`);
    expect(output).toContain(".gitattributes (fim de linha)");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-15: base corrompida mas recuperável (CRLF) continua falha, com nota de recuperação e ação de update", async () => {
    const target = await initInstall("maker-doctor-state-crlf-", { format });
    const upstream = "linha 1\nlinha 2\nlinha 3\n";
    const hash = await putBase(target, upstream);
    await referenceBase(target, hash);
    await corruptBase(target, hash, (content) => Buffer.from(content.toString("utf-8").replace(/\n/g, "\r\n"), "utf-8"));

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain(`base corrompida ${hash}`);
    expect(output).toContain("(recuperável: fins de linha convertidos para CRLF)");
    expect(output).toContain("rode maker update para regravá-la; confira .maker/.gitattributes");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-17: bases órfãs — aviso, sem degradar o install", async () => {
    const target = await initInstall("maker-doctor-state-orphan-", { format });
    const hash = await putBase(target, "conteúdo upstream órfão, ninguém referencia.\n");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("1 base(s) órfã(s) no armazenamento");
    expect(output).toContain("rode maker update para podá-las");
    expect(process.exitCode).not.toBe(1);
    expect(output).toContain("✓ Install íntegro.");
  });

  it("AC-18: install íntegro sai verde (com add-ons) e não escreve nada em disco", async () => {
    const target = await initInstall("maker-doctor-state-green-", { format });
    const before = await snapshotTree(target);
    const output = await outputOf(() => runDoctor({ target }));
    const after = await snapshotTree(target);
    expect(output).toContain(`Estado (.maker): íntegro (${format})`);
    expect(output).toContain("✓ Install íntegro.");
    expect(process.exitCode).not.toBe(1);
    expect(after).toEqual(before);
  });
});

describe("maker doctor — Estado (.maker): específicos de pack", () => {
  it("AC-17: bases soltas por arquivo junto a um lockfile — aviso, sem degradar", async () => {
    const target = await initInstall("maker-doctor-state-loose-", { format: "pack" });
    const hash = await putBase(target, "solta, mas presente em .maker/bases.\n");
    await mkdir(join(target, ".maker", "bases"), { recursive: true });
    await writeFile(join(target, ".maker", "bases", hash), "solta, mas presente em .maker/bases.\n", "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("bases por arquivo em .maker/bases junto ao lockfile");
    expect(output).toContain("rode maker update para consolidar no formato configurado");
    expect(process.exitCode).not.toBe(1);
  });

  it("AC-16: lockfile ilegível — falha com ação de restaurar do git", async () => {
    const target = await initInstall("maker-doctor-state-unreadable-", { format: "pack" });
    await writeFile(join(target, ".maker", "maker.lock"), "isto não é um lockfile\n", "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("lockfile ilegível");
    expect(output).toContain("restaure .maker/maker.lock do histórico do git");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-16/AC-19: versão de formato desconhecida — falha com ação de atualizar o maker", async () => {
    const target = await initInstall("maker-doctor-state-version-", { format: "pack" });
    const text = await lockfileText(target);
    await writeFile(join(target, ".maker", "maker.lock"), text.replace("maker-lockfile 1", "maker-lockfile 2"), "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("versão de formato do lockfile desconhecida");
    expect(output).toContain("atualize o maker");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-16: entrada truncada (tamanho declarado diferente do conteúdo) — falha", async () => {
    const target = await initInstall("maker-doctor-state-truncated-", { format: "pack" });
    const hash = await putBase(target, "conteúdo com tamanho declarado errado.\n");
    await referenceBase(target, hash);
    const text = await lockfileText(target);
    const headerRe = new RegExp(`@base sha256=${hash} size=(\\d+) encoding=utf8`);
    const match = headerRe.exec(text)!;
    const wrongSize = Number(match[1]) + 5;
    await writeFile(join(target, ".maker", "maker.lock"), text.replace(match[0]!, `@base sha256=${hash} size=${wrongSize} encoding=utf8`), "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain(`entrada truncada ${hash}`);
    expect(output).toContain("restaure .maker/maker.lock do histórico do git");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-38: manifest.json e maker.lock coexistindo — falha, install nunca tratado como ausente", async () => {
    const target = await initInstall("maker-doctor-state-coexist-", { format: "pack" });
    await writeFile(join(target, ".maker", "manifest.json"), JSON.stringify({
      makerVersion: "1.0.0", project: { name: "x", slug: "x" }, installedAt: "1970-01-01T00:00:00.000Z", files: {},
    }), "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain(".maker/manifest.json e .maker/maker.lock coexistem");
    expect(output).toContain("escolha um estado e remova o outro, ou restaure .maker do histórico do git");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("AC-39: seção de manifest com marcador de conflito do git — falha, install nunca tratado como ausente", async () => {
    const target = await initInstall("maker-doctor-state-manifestconflict-", { format: "pack" });
    const text = await lockfileText(target);
    const withConflict = text.replace("[manifest]\n", "[manifest]\n<<<<<<< HEAD\n");
    await writeFile(join(target, ".maker", "maker.lock"), withConflict, "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("marcadores de conflito do git na seção de manifest");
    expect(output).toContain("resolva o conflito em .maker/maker.lock ou restaure do histórico do git");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("maker doctor — Estado (.maker): migração pendente (AC-17/AC-35)", () => {
  it("AC-17: install não migrado — informa que o próximo update migra para pack, sem degradar", async () => {
    const target = await initInstall("maker-doctor-state-pending-migration-", { format: "unset" });

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain('o próximo maker update migrará as bases para o formato "pack"');
    expect(output).toContain('declare "state": { "bases": "files" } em maker.config.json');
    expect(process.exitCode).not.toBe(1);
  });

  it("AC-35: install não migrado com state.bases: \"files\" explícito — não informa migração pendente", async () => {
    const target = await initInstall("maker-doctor-state-optout-", { format: "unset" });
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }), "utf-8");

    const output = await outputOf(() => runDoctor({ target }));
    expect(output).not.toContain("migrará as bases");
    expect(process.exitCode).not.toBe(1);
  });
});
