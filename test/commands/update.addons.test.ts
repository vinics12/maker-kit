import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runUpdate } from "../../src/commands/update.js";
import { runAgentAdd } from "../../src/commands/agent.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { addonStateFile, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import {
  initInstall, lockfileText, readAddonStates, readManifest, snapshotTree, writeAddonStateFile,
} from "../helpers/state.js";

const injected = vi.hoisted(() => ({ options: undefined as { failAfter?: number; crashAfter?: number } | undefined }));
vi.mock("../../src/changes/transaction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/changes/transaction.js")>();
  return {
    ...actual,
    applyChangePlan: async (plan: Parameters<typeof actual.applyChangePlan>[0], options?: Parameters<typeof actual.applyChangePlan>[1]) => {
      const forced = injected.options;
      injected.options = undefined;
      return actual.applyChangePlan(plan, forced ? { ...options, ...forced } : options);
    },
  };
});

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  injected.options = undefined;
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function doctorGreen(target: string): Promise<void> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = 0;
  await runDoctor({ target });
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain("Install íntegro");
  expect(process.exitCode).not.toBe(1);
  log.mockRestore();
  process.exitCode = 0;
}

describe("update: estado de add-ons na migração de formato (US-7)", () => {
  it("AC-43/AC-01: files não migrado com saas → update migra para pack (default); unidade com os mesmos campos/valores; sem .maker/addons", async () => {
    const target = await initInstall("maker-update-addons-migrate-", { format: "unset", addon: "saas" });
    directories.push(target);
    const before = (await readAddonStates(target)).get("saas")!;

    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });

    expect(existsSync(join(target, ".maker", "addons"))).toBe(false);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    const after = (await readAddonStates(target)).get("saas")!;
    expect(after).toEqual(before);
    await doctorGreen(target);
  });

  it("AC-43: config \"files\" → update recria .maker/addons/saas.json igual em campos/valores; lockfile removido", async () => {
    const target = await initInstall("maker-update-addons-migrate-back-", { format: "pack", addon: "saas" });
    directories.push(target);
    const before = (await readAddonStates(target)).get("saas")!;
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }));

    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });

    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    expect(existsSync(join(target, addonStateFile("saas")))).toBe(true);
    const raw = JSON.parse(await readFile(join(target, addonStateFile("saas")), "utf-8"));
    expect(raw).toEqual(before);
    await doctorGreen(target);
  });

  it("FR-032: segundo update sem mudança não regrava o estado do add-on (idempotência)", async () => {
    const target = await initInstall("maker-update-addons-idempotent-", { format: "pack", addon: "saas" });
    directories.push(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    const first = await lockfileText(target);
    await runUpdate({ target });
    const second = await lockfileText(target);
    expect(second).toBe(first);
  });

  it("crashAfter na migração files→pack: recupera exatamente o estado anterior, inclusive o do add-on", async () => {
    const target = await initInstall("maker-update-addons-crash-", { format: "unset", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    injected.options = { crashAfter: 0 };
    await expect(runUpdate({ target })).rejects.toThrow();

    // Próximo comando mutante recupera a transação pendente antes de ler.
    await runUpdate({ target });
    const finalTree = await snapshotTree(target);
    expect(finalTree).not.toEqual(before); // a segunda tentativa migra de verdade
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, ".maker", "addons"))).toBe(false);
    await doctorGreen(target);
  });

  it("AC-36: pack + .maker/addons/ vazio → o próximo update remove o diretório", async () => {
    const target = await initInstall("maker-update-addons-empty-dir-", { format: "pack" });
    directories.push(target);
    await mkdir(join(target, ".maker", "addons"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(existsSync(join(target, ".maker", "addons"))).toBe(false);
  });

  it("AC-36: pack + .maker/addons/ com conteúdo alheio → mantido, update não aborta", async () => {
    const target = await initInstall("maker-update-addons-alien-dir-", { format: "pack" });
    directories.push(target);
    await mkdir(join(target, ".maker", "addons"), { recursive: true });
    await writeFile(join(target, ".maker", "addons", "nota.txt"), "não é estado de add-on");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(existsSync(join(target, ".maker", "addons", "nota.txt"))).toBe(true);
  });

  it("AC-44: init sobre install existente com [addons] em conflito aborta, árvore idêntica", async () => {
    const target = await initInstall("maker-update-addons-init-conflict-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[addons]\n\n", "[addons]\n\n<<<<<<< HEAD\n\n"), "utf-8");
    const before = await snapshotTree(target);
    const FIXTURE = join(__dirname, "..", "..", "fixtures", "example.config.json");
    await expect(runInit({ target, config: FIXTURE, yes: true }))
      .rejects.toThrow(/marcadores de conflito do git na seção de add-ons/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-44/AC-39: update com [addons] inválida aborta antes de escrever, árvore idêntica", async () => {
    const target = await initInstall("maker-update-addons-invalid-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[addons]\n\n", "[addons]\n\nlinha fora da gramática\n\n"), "utf-8");
    const before = await snapshotTree(target);
    await expect(runUpdate({ target })).rejects.toThrow(/seção de add-ons de .*inválida/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-44: agent add com coexistência de add-on aborta, árvore idêntica", async () => {
    const target = await initInstall("maker-update-addons-agent-coexist-", { format: "pack" });
    directories.push(target);
    await mkdir(join(target, ".maker", "addons"), { recursive: true });
    await writeFile(join(target, ".maker", "addons", "saas.json"), "{}");
    const before = await snapshotTree(target);
    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/coexistem/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("S1/AC-47: files com chave fora da gramática do lockfile → update default aborta com opt-out; com state.bases: files segue", async () => {
    const target = await initInstall("maker-update-addons-key-invalid-", { format: "unset" });
    directories.push(target);
    await writeAddonStateFile(target, "saas", {
      id: "saas", version: "0.1.0", appliedAt: "2026-09-28T12:00:00.000Z",
      knobs: {}, createdFiles: [], injectedTargets: [], "my-field": "x",
    });
    const before = await snapshotTree(target);
    await expect(runUpdate({ target })).rejects.toThrow(/não migrável.*campo "my-field" fora da gramática/s);
    expect(await snapshotTree(target)).toEqual(before);

    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    expect(existsSync(join(target, addonStateFile("saas")))).toBe(true);
  });

  it("addon-state-invalid: files com JSON inválido + migração default → aborta sem escrita", async () => {
    const target = await initInstall("maker-update-addons-json-invalid-", { format: "unset" });
    directories.push(target);
    await writeAddonStateFile(target, "saas", "{ json inválido");
    const before = await snapshotTree(target);
    await expect(runUpdate({ target })).rejects.toThrow(/estado de add-on não migrável/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("S3: .maker/addons não-diretório + pack → files → aborta com addons-dir-invalid", async () => {
    const target = await initInstall("maker-update-addons-dir-invalid-", { format: "pack", addon: "saas" });
    directories.push(target);
    await writeFile(join(target, ".maker", "addons"), "não é diretório");
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }));
    const before = await snapshotTree(target);
    await expect(runUpdate({ target })).rejects.toThrow(/\.maker\/addons existe e não é um diretório/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("em pack sem migração, .maker/addons não-diretório é tolerado (update segue)", async () => {
    const target = await initInstall("maker-update-addons-dir-tolerated-", { format: "pack" });
    directories.push(target);
    await writeFile(join(target, ".maker", "addons"), "não é diretório");
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(existsSync(join(target, ".maker", "addons"))).toBe(true);
  });
});
