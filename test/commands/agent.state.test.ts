import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runAgentAdd } from "../../src/commands/agent.js";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall, lockfileText, readManifest, snapshotTree } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("agent add: formato em uso, bases registradas, transação (AC-30, AC-33, FR-005, FR-006, FR-011, FR-022)", () => {
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

  it("AC-33: install ainda não migrado — agent add grava bases por arquivo e não migra nem registra formato", async () => {
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

  it("FR-022: colisão com arquivo não gerenciado não deixa escrita parcial (árvore idêntica byte a byte)", async () => {
    const target = await initInstall("maker-agent-add-collision-", { format: "pack" });
    directories.push(target);
    await mkdir(join(target, ".agents/skills/run-spec"), { recursive: true });
    await writeFile(join(target, ".agents/skills/run-spec/SKILL.md"), "arquivo do usuário\n", "utf-8");
    const before = await snapshotTree(target);

    await expect(runAgentAdd("codex", { target })).rejects.toThrow(/nenhuma alteração foi feita/);
    expect(await snapshotTree(target)).toEqual(before);
  });
});
