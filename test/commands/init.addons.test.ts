import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { initInstall, snapshotTree, writeAddonStateFile } from "../helpers/state.js";

const directories: string[] = [];
const FIXTURE_CONFIG = join(__dirname, "..", "..", "fixtures", "example.config.json");

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("maker init — JSON de add-on órfão sem install (S2/S4, AC-47 parte init)", () => {
  it("init sem install com .maker/addons/x.json aborta antes de escrever (destino pack, default)", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-orphan-pack-"));
    directories.push(target);
    await writeAddonStateFile(target, "x", {
      id: "x", version: "0.1.0", appliedAt: "2026-09-28T12:00:00.000Z", knobs: {}, createdFiles: [], injectedTargets: [],
    });
    const before = await snapshotTree(target);

    await expect(runInit({ target, config: FIXTURE_CONFIG, yes: true }))
      .rejects.toThrow(/\.maker\/addons\/.*\.json existe\(m\) sem install do maker/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("init sem install com .maker/addons/x.json aborta antes de escrever (destino files, opt-out)", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-init-orphan-files-"));
    directories.push(target);
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ state: { bases: "files" } }));
    await writeAddonStateFile(target, "x", {
      id: "x", version: "0.1.0", appliedAt: "2026-09-28T12:00:00.000Z", knobs: {}, createdFiles: [], injectedTargets: [],
    });
    const before = await snapshotTree(target);

    await expect(runInit({ target, config: FIXTURE_CONFIG, yes: true }))
      .rejects.toThrow(/\.maker\/addons\/.*\.json existe\(m\) sem install do maker/);
    expect(await snapshotTree(target)).toEqual(before);
  });
});

describe("maker init sobre install files existente com estado de add-on inválido (AC-47)", () => {
  it.each<[string, string | Record<string, unknown>]>([
    ["JSON ilegível", "{ json inválido"],
    ["JSON fora do schema", { id: "saas", version: 1 }],
  ])("%s: a migração default é bloqueada antes de qualquer escrita, citando arquivo, ação e opt-out", async (_label, content) => {
    const target = await initInstall("maker-init-invalid-addon-", { format: "unset" });
    directories.push(target);
    await writeAddonStateFile(target, "saas", content as never);
    const before = await snapshotTree(target);

    const error = await runInit({ target, config: FIXTURE_CONFIG, yes: true }).then(() => null, (thrown: Error) => thrown);
    expect(error).not.toBeNull();
    expect(error!.message).toContain("estado de add-on não migrável em .maker/addons/saas.json");
    expect(error!.message).toContain('"state": { "bases": "files" }');
    expect(await snapshotTree(target)).toEqual(before);
  });
});
