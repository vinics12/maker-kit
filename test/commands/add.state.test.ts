import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall, lockfileText, putBase, readManifest, snapshotTree } from "../helpers/state.js";
import { loadAddon } from "../../src/addons/loader.js";
import { applyAddon, removeAddon } from "../../src/addons/apply.js";
import { runUpdate } from "../../src/commands/update.js";

// Injeta `failAfter` na única `applyChangePlan` que `applyAddon`/`removeAddon` dispara, sem afetar as
// chamadas de setup (`initInstall`, `runUpdate`): o controle é consumido uma vez e devolvido a `undefined`.
// `vi.mock` é hoisted pelo vitest acima destes imports, então `applyAddon`/`removeAddon` já enxergam o mock.
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
const KNOBS = { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" };

afterEach(async () => {
  vi.restoreAllMocks();
  injected.options = undefined;
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("add/remove: formato em uso preservado e sem poda (AC-19, AC-33, AC-38, AC-39, FR-005, FR-011, FR-022)", () => {
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

  it("AC-33: add e remove sobre install ainda não migrado não migram, não registram formato, e um update posterior migra", async () => {
    const target = await initInstall("maker-add-unset-", { format: "unset" });
    directories.push(target);
    const addon = await loadAddon("saas");

    await applyAddon(target, addon, KNOBS);
    expect((await readManifest(target))?.basesFormat).toBeUndefined();
    expect(existsSync(join(target, LOCKFILE))).toBe(false);

    await removeAddon(target, "saas");
    expect((await readManifest(target))?.basesFormat).toBeUndefined();
    expect(existsSync(join(target, LOCKFILE))).toBe(false);

    await runUpdate({ target });

    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    expect((await readManifest(target))?.basesFormat).toBe("pack");
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

  it("AC-38: manifest.json e lockfile coexistindo — remove aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-remove-coexist-", { format: "pack" });
    directories.push(target);
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, KNOBS);
    await writeFile(join(target, MANIFEST_FILE), "{}");
    const before = await snapshotTree(target);

    await expect(removeAddon(target, "saas")).rejects.toThrow(/coexistem/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-39: seção de manifest do lockfile com marcador de conflito — add aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-add-conflict-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[manifest]\n", "[manifest]\n<<<<<<< HEAD\n"), "utf-8");
    const before = await snapshotTree(target);
    const addon = await loadAddon("saas");

    await expect(applyAddon(target, addon, KNOBS)).rejects.toThrow(
      /marcadores de conflito do git na seção de manifest/,
    );
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-39: seção de manifest do lockfile com marcador de conflito — remove aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-remove-conflict-", { format: "pack" });
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

  it("AC-19: lockfile com versão de formato desconhecida — add aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-add-unknownversion-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("maker-lockfile 1", "maker-lockfile 2"), "utf-8");
    const before = await snapshotTree(target);
    const addon = await loadAddon("saas");

    await expect(applyAddon(target, addon, KNOBS)).rejects.toThrow(
      /usa um formato mais novo \(versão 2\) que este maker entende \(1\)[\s\S]*atualize o maker/,
    );
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-19: lockfile com versão de formato desconhecida — remove aborta antes de qualquer escrita", async () => {
    const target = await initInstall("maker-remove-unknownversion-", { format: "pack" });
    directories.push(target);
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, KNOBS);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("maker-lockfile 1", "maker-lockfile 2"), "utf-8");
    const before = await snapshotTree(target);

    await expect(removeAddon(target, "saas")).rejects.toThrow(
      /usa um formato mais novo \(versão 2\) que este maker entende \(1\)[\s\S]*atualize o maker/,
    );
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("FR-022: falha injetada durante a transação do add restaura tudo (pack)", async () => {
    const target = await initInstall("maker-add-rollback-pack-", { format: "pack" });
    directories.push(target);
    const before = await snapshotTree(target);
    const addon = await loadAddon("saas");

    injected.options = { failAfter: 0 };
    await expect(applyAddon(target, addon, KNOBS)).rejects.toThrow(/Falha injetada durante a aplicação/);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("FR-022: falha injetada durante a transação do remove restaura tudo (pack)", async () => {
    const target = await initInstall("maker-remove-rollback-pack-", { format: "pack" });
    directories.push(target);
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, KNOBS);
    const before = await snapshotTree(target);

    injected.options = { failAfter: 0 };
    await expect(removeAddon(target, "saas")).rejects.toThrow(/Falha injetada durante a aplicação/);
    expect(await snapshotTree(target)).toEqual(before);
  });
});
