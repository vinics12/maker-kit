import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runUpdate } from "../../src/commands/update.js";
import { LOCKFILE, MANIFEST_FILE, BASES_DIR } from "../../src/state/paths.js";
import { corruptBase, initInstall, readManifest, removeBase } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("update pack → files e volta (AC-24/AC-25/AC-26)", () => {
  it("AC-24/SC-004: pack migra para files com opt-out e volta para pack sem perder bases", async () => {
    const target = await initInstall("maker-update-reverse-", { format: "pack" });
    directories.push(target);
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "files" } }));
    await runUpdate({ target });
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(true);
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
    const midway = await readManifest(target);
    expect(midway?.basesFormat).toBe("files");

    await writeFile(join(target, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "pack" } }));
    await runUpdate({ target });
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    const after = await readManifest(target);
    expect(after?.files).toEqual(midway?.files);
  });

  it("AC-26: base corrompida na origem some da migração e é listada como descartada", async () => {
    const target = await initInstall("maker-update-reverse-corrupt-", { format: "unset" });
    directories.push(target);
    const manifest = await readManifest(target);
    const [path, entry] = Object.entries(manifest!.files).find(([, e]) => e.baseHash)!;
    await corruptBase(target, entry.baseHash!);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("descartada");
    expect(output).toContain(path);
  });

  it("base ausente é tratada como base ausente (preserva e pede mediação)", async () => {
    const target = await initInstall("maker-update-reverse-missing-", { format: "unset" });
    directories.push(target);
    const manifest = await readManifest(target);
    const path = ".specify/memory/constitution.md";
    const baseHash = manifest!.files[path]!.baseHash!;
    await writeFile(join(target, path), (await readFile(join(target, path), "utf-8")) + "\ncustomização local\n");
    await removeBase(target, baseHash);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(log.mock.calls.flat().join("\n")).toContain("precisam de mediação");
  });
});
