import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";
import { runUpdate } from "../../src/commands/update.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { LOCKFILE, MANIFEST_FILE, BASES_DIR } from "../../src/state/paths.js";
import { initInstall, lockfileText, readManifest, snapshotTree, writeManifest } from "../helpers/state.js";

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

describe("update em pack: default, migração e relatório", () => {
  it("AC-01/AC-02: init novo já fica em pack — sem manifest.json nem .maker/bases", async () => {
    const target = await temp("maker-update-pack-init-");
    await runInit({ target, config: FIXTURE, yes: true });
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    const manifest = await readManifest(target);
    expect(manifest?.basesFormat).toBe("pack");
  });

  it("AC-03: update em pack sem mudanças produz o mesmo lockfile byte a byte", async () => {
    const target = await temp("maker-update-pack-idempotent-");
    await runInit({ target, config: FIXTURE, yes: true });
    const before = await lockfileText(target);
    await runUpdate({ target });
    expect(await lockfileText(target)).toBe(before);
  });

  it("AC-07/SC-002: install 'files' não migrado migra para pack no próximo update (default)", async () => {
    const target = await initInstall("maker-update-pack-migrate-", { format: "unset" });
    directories.push(target);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("Migração do formato das bases: files → pack");
    expect(output).toContain("base(s) migrada(s)");
    expect(output).toContain('declare "state": { "bases": "files" } em maker.config.json');
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    const manifest = await readManifest(target);
    expect(manifest?.basesFormat).toBe("pack");
  });

  it("AC-31/AC-32: opt-out em maker.config.json mantém 'files' sem migrar, e config 'pack' força a migração", async () => {
    const optOut = await initInstall("maker-update-pack-optout-", { format: "unset" });
    directories.push(optOut);
    await writeFile(join(optOut, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "files" } }));
    await runUpdate({ target: optOut });
    expect(existsSync(join(optOut, MANIFEST_FILE))).toBe(true);
    expect((await readManifest(optOut))?.basesFormat).toBe("files");

    const forced = await initInstall("maker-update-pack-forced-", { format: "files" });
    directories.push(forced);
    await writeFile(join(forced, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "pack" } }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target: forced });
    expect(log.mock.calls.flat().join("\n")).toContain("Migração do formato das bases: files → pack");
    // Reason "config" nunca imprime o opt-out do default.
    expect(log.mock.calls.flat().join("\n")).not.toContain("é o padrão");
    expect(existsSync(join(forced, LOCKFILE))).toBe(true);
  });

  it("AC-35: update em install não migrado com opt-out registra basesFormat 'files' sem migrar", async () => {
    const target = await initInstall("maker-update-pack-ac35-", { format: "unset" });
    directories.push(target);
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "files" } }));
    await runUpdate({ target });
    const manifest = await readManifest(target);
    expect(manifest?.basesFormat).toBe("files");
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(true);
  });

  it("AC-36: após a migração o doctor reporta install íntegro", async () => {
    const target = await initInstall("maker-update-pack-doctor-", { format: "unset" });
    directories.push(target);
    await runUpdate({ target });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDoctor({ target });
    expect(process.exitCode).not.toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain("Install íntegro");
  });

  it("FR-003: state.bases inválido em maker.config.json aborta update antes de escrever", async () => {
    const target = await temp("maker-update-pack-invalid-");
    await runInit({ target, config: FIXTURE, yes: true });
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "zip" } }));
    const before = await snapshotTree(target);
    await expect(runUpdate({ target })).rejects.toThrow(/maker\.config\.json: state\.bases deve ser "files" ou "pack"/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("maker.config.json malformado com config já no manifest: update segue sem migrar, com aviso", async () => {
    const target = await temp("maker-update-pack-malformed-");
    await runInit({ target, config: FIXTURE, yes: true });
    await writeFile(join(target, "maker.config.json"), "{ not json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(log.mock.calls.flat().join("\n")).toContain("maker.config.json ilegível");
    expect(log.mock.calls.flat().join("\n")).toContain("formato das bases mantido (pack)");
    expect((await readManifest(target))?.basesFormat).toBe("pack");
  });

  it("B2: arquivo de controle do git pré-existente e idêntico ao upstream passa a ser rastreado", async () => {
    const target = await initInstall("maker-update-pack-b2-same-");
    directories.push(target);
    const before = await readManifest(target);
    // Simula um install anterior aos templates de controle do git: sem entrada no manifest, mas
    // o arquivo em disco já é byte a byte igual ao que o engine geraria.
    const { [".maker/.gitignore"]: _removed, ...rest } = before!.files;
    await writeManifest(target, { ...before!, files: rest });
    await runUpdate({ target });
    const after = await readManifest(target);
    expect(after?.files[".maker/.gitignore"]).toBeDefined();
    expect(after?.files[".maker/.gitignore"]?.baseHash).toBeTruthy();
  });

  it("B2: arquivo de controle do git pré-existente e diferente é preservado e mediado (base nula)", async () => {
    const target = await initInstall("maker-update-pack-b2-diff-");
    directories.push(target);
    const before = await readManifest(target);
    const { [".maker/.gitignore"]: _removed, ...rest } = before!.files;
    await writeManifest(target, { ...before!, files: rest });
    await writeFile(join(target, ".maker/.gitignore"), "# customizado pelo dono\n/algo-local/\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(log.mock.calls.flat().join("\n")).toContain("precisam de mediação");
    expect(await readFile(join(target, ".maker/.gitignore"), "utf-8")).toContain("customizado pelo dono");
    expect((await readManifest(target))?.files[".maker/.gitignore"]).toBeUndefined();
  });
});
