import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runUpdate } from "../../src/commands/update.js";
import { runAgentAdd } from "../../src/commands/agent.js";
import { runAdd } from "../../src/commands/add.js";
import { runRemove } from "../../src/commands/remove.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { addonStateFile, ADDONS_DIR, isStateMetadata, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { openState } from "../../src/state/store.js";
import {
  initInstall, lockfileText, readAddonStates, readManifest, snapshotTree, writeAddonStateFile,
} from "../helpers/state.js";

const injected = vi.hoisted(() => ({
  options: undefined as { failAfter?: number; crashAfter?: number } | undefined,
  lastPlan: [] as { path: string; action: string }[],
}));
vi.mock("../../src/changes/transaction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/changes/transaction.js")>();
  return {
    ...actual,
    applyChangePlan: async (plan: Parameters<typeof actual.applyChangePlan>[0], options?: Parameters<typeof actual.applyChangePlan>[1]) => {
      const forced = injected.options;
      injected.options = undefined;
      injected.lastPlan = plan.changes.map((change) => ({ path: change.path, action: change.action }));
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

  it("crashAfter na migração files→pack: a recuperação devolve exatamente o estado anterior, inclusive o do add-on", async () => {
    const target = await initInstall("maker-update-addons-crash-", { format: "unset", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    injected.options = { crashAfter: 0 };
    await expect(runUpdate({ target })).rejects.toThrow(/crashAfter/);
    expect(await snapshotTree(target)).not.toEqual(before);

    // Abrir o estado para mutar recupera a transação pendente antes de ler.
    await openState(target, { mode: "mutate" });
    expect(await snapshotTree(target)).toEqual(before);
    expect((await readAddonStates(target)).has("saas")).toBe(true);

    await runUpdate({ target });
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, ".maker", "addons"))).toBe(false);
    await doctorGreen(target);
  });

  type PlannedOp = { path: string; action: string };

  /** Mesma ordem em que `applyChangePlan` executa: metadados de estado por último, create/update antes de remove. */
  function executionOrder(plan: PlannedOp[]): PlannedOp[] {
    const rank = (change: PlannedOp) => (!isStateMetadata(change.path) ? 0 : change.action === "remove" ? 2 : 1);
    return plan.filter((change) => ["create", "update", "remove"].includes(change.action))
      .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
  }

  /** Falha logo depois de cada operação de estado indicada; cada falha tem de devolver a árvore inicial. */
  async function failAfterEachOperation(target: string, before: Map<string, string>, operations: PlannedOp[]): Promise<void> {
    vi.spyOn(console, "log").mockImplementation(() => {});
    injected.options = { failAfter: 0 };
    await expect(runUpdate({ target })).rejects.toThrow(/Falha injetada/);
    expect(await snapshotTree(target)).toEqual(before);
    const order = executionOrder(injected.lastPlan);
    for (const operation of operations) {
      const index = order.findIndex((change) => change.path === operation.path && change.action === operation.action);
      expect(index, `${operation.action} ${operation.path} está no plano`).toBeGreaterThanOrEqual(0);
      injected.options = { failAfter: index };
      await expect(runUpdate({ target })).rejects.toThrow(/Falha injetada/);
      expect(await snapshotTree(target)).toEqual(before);
    }
  }

  it("failAfter depois de criar maker.lock, de remover .maker/addons e de remover manifest.json (files→pack): árvore idêntica à inicial", async () => {
    const target = await initInstall("maker-update-addons-fail-forward-", { format: "unset", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    await failAfterEachOperation(target, before, [
      { path: LOCKFILE, action: "create" },
      { path: ADDONS_DIR, action: "remove" },
      { path: MANIFEST_FILE, action: "remove" },
    ]);

    await runUpdate({ target });
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, ".maker", "addons"))).toBe(false);
  }, 60_000);

  it("failAfter depois de criar manifest.json, de criar o JSON do add-on e de remover maker.lock (pack→files): árvore idêntica à inicial", async () => {
    const target = await initInstall("maker-update-addons-fail-back-", { format: "pack", addon: "saas" });
    directories.push(target);
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }));
    const before = await snapshotTree(target);
    await failAfterEachOperation(target, before, [
      { path: MANIFEST_FILE, action: "create" },
      { path: addonStateFile("saas"), action: "create" },
      { path: LOCKFILE, action: "remove" },
    ]);

    await runUpdate({ target });
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    expect(existsSync(join(target, addonStateFile("saas")))).toBe(true);
  }, 60_000);

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

  describe.each([["com", "saas"], ["sem", undefined]] as const)("AC-44: lockfile + .maker/addons/saas.json (%s unidade correspondente no lockfile)", (_label, addon) => {
    const FIXTURE = join(__dirname, "..", "..", "fixtures", "example.config.json");
    const commands: [string, (target: string) => Promise<unknown>][] = [
      ["add", (target) => runAdd("saas", { target, yes: true })],
      ["remove", (target) => runRemove("saas", { target })],
      ["agent add", (target) => runAgentAdd("codex", { target })],
      ["init sobre o install existente", (target) => runInit({ target, config: FIXTURE, yes: true })],
      ["update", (target) => runUpdate({ target })],
      ["update --apply-resolutions", (target) => runUpdate({ target, applyResolutions: true })],
    ];

    it.each(commands)("%s aborta por coexistência, com ação recomendada e árvore idêntica", async (_name, run) => {
      const target = await initInstall("maker-update-addons-coexist-", { format: "pack", addon });
      directories.push(target);
      await writeAddonStateFile(target, "saas", "{}");
      const before = await snapshotTree(target);

      const error = await run(target).then(() => null, (thrown: Error) => thrown);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/\.maker\/addons\/<id>\.json e \.maker\/maker\.lock coexistem \(saas\)/);
      expect(error!.message).toContain("escolha um estado e remova o outro, ou restaure .maker do histórico do git");
      expect(error!.message).not.toContain("não está aplicado");
      expect(await snapshotTree(target)).toEqual(before);
    });
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

  const INVALID_STATES: [string, string | Record<string, unknown>][] = [
    ["JSON ilegível", "{ json inválido"],
    ["JSON fora do schema do estado de add-on", { id: "saas", version: 1 }],
  ];

  it.each(INVALID_STATES)("AC-47: %s em files + migração default → aborta sem escrita, citando o arquivo, a ação e o opt-out", async (_label, content) => {
    const target = await initInstall("maker-update-addons-invalid-state-", { format: "unset" });
    directories.push(target);
    await writeAddonStateFile(target, "saas", content as never);
    const before = await snapshotTree(target);

    const error = await runUpdate({ target }).then(() => null, (thrown: Error) => thrown);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("estado de add-on não migrável em .maker/addons/saas.json");
    expect(error!.message).toContain("nenhuma alteração foi feita");
    expect(error!.message).toContain("corrija ou restaure o arquivo");
    expect(error!.message).toContain('"state": { "bases": "files" }');
    expect(await snapshotTree(target)).toEqual(before);
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
  });

  it.each(INVALID_STATES)("AC-47: update --dry-run com %s reporta a migração como bloqueada, sem escrever", async (_label, content) => {
    const target = await initInstall("maker-update-addons-invalid-dry-", { format: "unset" });
    directories.push(target);
    await writeAddonStateFile(target, "saas", content as never);
    const before = await snapshotTree(target);

    await expect(runUpdate({ target, dryRun: true }))
      .rejects.toThrow(/estado de add-on não migrável em \.maker\/addons\/saas\.json.*"state": \{ "bases": "files" \}/s);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it.each(INVALID_STATES)("AC-47: %s com state.bases: files explícito → nenhuma migração é tentada e o update segue", async (_label, content) => {
    const target = await initInstall("maker-update-addons-invalid-optout-", { format: "unset" });
    directories.push(target);
    await writeAddonStateFile(target, "saas", content as never);
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    expect(existsSync(join(target, addonStateFile("saas")))).toBe(true);
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
