import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectState, openState } from "../../src/state/store.js";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall, lockfileText, readManifest, snapshotTree } from "../helpers/state.js";
import { runAgentAdd } from "../../src/commands/agent.js";
import { runUpdate } from "../../src/commands/update.js";

// Injeta `failAfter`/`crashAfter` na única `applyChangePlan` que `runAgentAdd` dispara, sem afetar as
// chamadas de setup (`initInstall`, `runUpdate`): o controle é consumido uma vez e devolvido a `undefined`.
// `vi.mock` é hoisted pelo vitest acima destes imports, então `runAgentAdd`/`runUpdate` já enxergam o mock.
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

describe("agent add: formato em uso, bases registradas, transação (AC-19, AC-30, AC-33, FR-005, FR-006, FR-011, FR-022)", () => {
  it("AC-30: em pack, bases novas vão só para o lockfile e cada entrada ganha baseHash", async () => {
    const target = await initInstall("maker-agent-add-pack-", { format: "pack" });
    directories.push(target);

    await runAgentAdd("codex", { target });

    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    const manifest = (await readManifest(target))!;
    expect(manifest.basesFormat).toBe("pack");
    const codexEntry = manifest.files[".codex/agents/architect.toml"];
    expect(codexEntry?.baseHash).toBe(codexEntry?.hash);
    const text = await lockfileText(target);
    expect(text).toContain(`@base sha256=${codexEntry!.hash}`);
  });

  it("AC-33: install ainda não migrado — agent add grava bases por arquivo, não migra nem registra formato, e um update posterior migra", async () => {
    const target = await initInstall("maker-agent-add-unset-", { format: "unset" });
    directories.push(target);

    await runAgentAdd("codex", { target });

    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(true);
    const manifest = (await readManifest(target))!;
    expect(manifest.basesFormat).toBeUndefined();
    const codexEntry = manifest.files[".codex/agents/architect.toml"];
    expect(codexEntry?.baseHash).toBe(codexEntry?.hash);
    expect(existsSync(join(target, BASES_DIR, codexEntry!.hash))).toBe(true);

    await runUpdate({ target });

    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    const migrated = (await readManifest(target))!;
    expect(migrated.basesFormat).toBe("pack");
    expect(await lockfileText(target)).toContain(`@base sha256=${codexEntry!.hash}`);
  });

  it("FR-005: agent add preserva state.bases='files' explícito exatamente como estava", async () => {
    const target = await initInstall("maker-agent-add-files-", { format: "files" });
    directories.push(target);

    await runAgentAdd("codex", { target });

    const manifest = (await readManifest(target))!;
    expect(manifest.basesFormat).toBe("files");
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
  });

  it("AC-38: manifest.json e lockfile coexistindo — agent add aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-agent-add-coexist-", { format: "pack" });
    directories.push(target);
    await writeFile(join(target, MANIFEST_FILE), "{}");
    const before = await snapshotTree(target);

    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/coexistem/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-39: seção de manifest do lockfile com marcador de conflito — agent add aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-agent-add-conflict-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[manifest]\n", "[manifest]\n<<<<<<< HEAD\n"), "utf-8");
    const before = await snapshotTree(target);

    await expect(runAgentAdd("codex", { target })).rejects.toThrow(
      /marcadores de conflito do git na seção de manifest/,
    );
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-19: lockfile com versão de formato desconhecida — agent add aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-agent-add-unknownversion-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("maker-lockfile 1", "maker-lockfile 2"), "utf-8");
    const before = await snapshotTree(target);

    await expect(runAgentAdd("codex", { target })).rejects.toThrow(
      /usa um formato mais novo \(versão 2\) que este maker entende \(1\)[\s\S]*atualize o maker/,
    );
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("preflight: colisão com arquivo não gerenciado aborta antes de planejar (comportamento anterior à US-5, não exercita a transação)", async () => {
    const target = await initInstall("maker-agent-add-collision-", { format: "pack" });
    directories.push(target);
    await mkdir(join(target, ".agents/skills/run-spec"), { recursive: true });
    await writeFile(join(target, ".agents/skills/run-spec/SKILL.md"), "arquivo do usuário\n", "utf-8");
    const before = await snapshotTree(target);

    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/nenhuma alteração foi feita/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("FR-022: falha injetada durante a transação do agent add restaura tudo (pack)", async () => {
    const target = await initInstall("maker-agent-add-rollback-pack-", { format: "pack" });
    directories.push(target);
    const before = await snapshotTree(target);

    injected.options = { failAfter: 0 };
    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/Falha injetada durante a aplicação/);
    expect(await snapshotTree(target)).toEqual(before);
    expect((await readManifest(target))?.agents).toEqual(["claude"]);
  });

  it("FR-022: falha injetada durante a transação do agent add restaura tudo (files, install não migrado)", async () => {
    const target = await initInstall("maker-agent-add-rollback-files-", { format: "unset" });
    directories.push(target);
    const before = await snapshotTree(target);

    injected.options = { failAfter: 0 };
    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/Falha injetada durante a aplicação/);
    expect(await snapshotTree(target)).toEqual(before);
    expect((await readManifest(target))?.agents).toEqual(["claude"]);
  });

  it("FR-022: crash a meio caminho da transação do agent add é recuperável (journal + rollback)", async () => {
    const target = await initInstall("maker-agent-add-crash-", { format: "pack" });
    directories.push(target);
    const before = await snapshotTree(target);

    injected.options = { crashAfter: 0 };
    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/Falha simulada/);
    expect((await inspectState(target)).pendingTransactions).toBe(true);

    await openState(target, { mode: "mutate" });
    expect((await inspectState(target)).pendingTransactions).toBe(false);
    expect(await snapshotTree(target)).toEqual(before);
  });
});
