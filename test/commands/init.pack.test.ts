import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall, readManifest, snapshotTree } from "../helpers/state.js";

const FIXTURE = join(__dirname, "..", "..", "fixtures", "example.config.json");
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(prefix: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), prefix));
  directories.push(target);
  return target;
}

describe("init em pack: formato efetivo e comportamento sobre install existente", () => {
  it("AC-06: install novo sem state.bases fica em pack (default)", async () => {
    const target = await temp("maker-init-pack-default-");
    await runInit({ target, config: FIXTURE, yes: true });
    expect((await readManifest(target))?.basesFormat).toBe("pack");
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
  });

  it("AC-06: install novo com state.bases:'files' na config carregada respeita o opt-out", async () => {
    const target = await temp("maker-init-pack-optout-");
    const configPath = join(target, "config.json");
    await writeFile(configPath, JSON.stringify({ project: { name: "X" }, state: { bases: "files" } }));
    await runInit({ target, config: configPath, yes: true });
    expect((await readManifest(target))?.basesFormat).toBe("files");
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(true);
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
  });

  it("AC-34: init sobre install existente 'files' não migrado migra para pack (mesma regra do update, sem podar)", async () => {
    const target = await initInstall("maker-init-pack-existing-", { format: "unset" });
    directories.push(target);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runInit({ target, yes: true });
    expect(log.mock.calls.flat().join("\n")).toContain("Migração do formato das bases: files → pack");
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
  });

  it("AC-19/AC-38/AC-39: init sobre install em coexistência aborta antes de escrever, árvore idêntica", async () => {
    const target = await initInstall("maker-init-pack-coexist-", { format: "pack" });
    directories.push(target);
    await writeFile(join(target, MANIFEST_FILE), "{}");
    const before = await snapshotTree(target);
    await expect(runInit({ target, yes: true })).rejects.toThrow(/coexistem/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-19/AC-38/AC-39: init nunca cria manifest.json sobre install em pack, mesmo com colisão --force", async () => {
    const target = await initInstall("maker-init-pack-force-", { format: "pack" });
    directories.push(target);
    await runInit({ target, yes: true, force: true });
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
  });

  it("FR-003: state.bases inválido na config carregada aborta o init antes de escrever", async () => {
    const target = await temp("maker-init-pack-invalid-");
    const configPath = join(target, "config.json");
    await writeFile(configPath, JSON.stringify({ project: { name: "X" }, state: { bases: "zip" } }));
    const before = await snapshotTree(target);
    await expect(runInit({ target, config: configPath, yes: true })).rejects.toThrow(
      /maker\.config\.json: state\.bases deve ser "files" ou "pack"/,
    );
    expect(await snapshotTree(target)).toEqual(before);
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
  });
});
