import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAddon } from "../../src/addons/loader.js";
import { applyAddon, removeAddon } from "../../src/addons/apply.js";
import { LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall, lockfileText, putBase, readManifest, snapshotTree } from "../helpers/state.js";

const directories: string[] = [];
const KNOBS = { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" };

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("add/remove: formato em uso preservado e sem poda (FR-005, FR-011, AC-19, AC-33, AC-38, AC-39)", () => {
  it("FR-005: add e remove preservam o formato pack exatamente, sem tocar basesFormat", async () => {
    const target = await initInstall("maker-add-pack-", { format: "pack" });
    directories.push(target);
    const addon = await loadAddon("saas");

    await applyAddon(target, addon, KNOBS);
    expect((await readManifest(target))?.basesFormat).toBe("pack");
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);

    await removeAddon(target, "saas");
    expect((await readManifest(target))?.basesFormat).toBe("pack");
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
  });

  it("AC-33: add e remove sobre install ainda não migrado não migram e não registram formato", async () => {
    const target = await initInstall("maker-add-unset-", { format: "unset" });
    directories.push(target);
    const addon = await loadAddon("saas");

    await applyAddon(target, addon, KNOBS);
    expect((await readManifest(target))?.basesFormat).toBeUndefined();
    expect(existsSync(join(target, LOCKFILE))).toBe(false);

    await removeAddon(target, "saas");
    expect((await readManifest(target))?.basesFormat).toBeUndefined();
    expect(existsSync(join(target, LOCKFILE))).toBe(false);
  });

  it("FR-011: add e remove toleram bases órfãs no armazenamento — só o update poda", async () => {
    const target = await initInstall("maker-add-orphan-", { format: "pack" });
    directories.push(target);
    const orphanHash = await putBase(target, "conteúdo órfão nunca referenciado por nenhum arquivo.\n");
    const addon = await loadAddon("saas");

    await applyAddon(target, addon, KNOBS);
    expect(await lockfileText(target)).toContain(`@base sha256=${orphanHash}`);

    await removeAddon(target, "saas");
    expect(await lockfileText(target)).toContain(`@base sha256=${orphanHash}`);
  });

  it("AC-38: manifest.json e lockfile coexistindo — add aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-add-coexist-", { format: "pack" });
    directories.push(target);
    await writeFile(join(target, MANIFEST_FILE), "{}");
    const before = await snapshotTree(target);
    const addon = await loadAddon("saas");

    await expect(applyAddon(target, addon, KNOBS)).rejects.toThrow(/coexistem/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-39: seção de manifest do lockfile com marcador de conflito — remove aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-add-conflict-", { format: "pack" });
    directories.push(target);
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, KNOBS);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[manifest]\n", "[manifest]\n<<<<<<< HEAD\n"), "utf-8");
    const before = await snapshotTree(target);

    await expect(removeAddon(target, "saas")).rejects.toThrow(
      /marcadores de conflito do git na seção de manifest/,
    );
    expect(await snapshotTree(target)).toEqual(before);
  });
});
