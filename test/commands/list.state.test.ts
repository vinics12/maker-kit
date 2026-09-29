import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runList } from "../../src/commands/list.js";
import { LOCKFILE } from "../../src/state/paths.js";
import { initInstall, lockfileText, snapshotTree, writeAddonStateFile } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function outputOf(action: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try { await action(); } finally { console.log = originalLog; }
  return messages.join("\n").replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "");
}

describe("maker list — estado de add-ons (US-7)", () => {
  it("AC-41: pack com saas aplicado → applied lido da seção [addons]; árvore inalterada", async () => {
    const target = await initInstall("maker-list-state-applied-", { format: "pack", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · applied");
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-39: [addons] malformada → erro com ação, nada listado como available", async () => {
    const target = await initInstall("maker-list-state-addons-invalid-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[addons]\n\n", "[addons]\n\nlinha fora da gramática\n\n"), "utf-8");
    await expect(runList({ target })).rejects.toThrow(/seção de add-ons de .*inválida/);
  });

  it("AC-39: [addons] em conflito → erro com ação", async () => {
    const target = await initInstall("maker-list-state-addons-conflict-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[addons]\n\n", "[addons]\n\n<<<<<<< HEAD\n\n"), "utf-8");
    await expect(runList({ target })).rejects.toThrow(/marcadores de conflito do git na seção de add-ons/);
  });

  it("AC-39: [manifest] em conflito → erro (precedência do manifest)", async () => {
    const target = await initInstall("maker-list-state-manifest-conflict-", { format: "pack" });
    directories.push(target);
    const text = await lockfileText(target);
    await writeFile(join(target, LOCKFILE), text.replace("[manifest]\n", "[manifest]\n<<<<<<< HEAD\n"), "utf-8");
    await expect(runList({ target })).rejects.toThrow(/marcadores de conflito do git na seção de manifest/);
  });

  it("AC-44: coexistência (.maker/addons/<id>.json + lockfile) → erro", async () => {
    const target = await initInstall("maker-list-state-coexist-", { format: "pack" });
    directories.push(target);
    await mkdir(join(target, ".maker", "addons"), { recursive: true });
    await writeFile(join(target, ".maker", "addons", "saas.json"), "{}");
    await expect(runList({ target })).rejects.toThrow(/coexistem/);
  });

  it(".maker/addons/ vazio em pack é ignorado (list segue normal)", async () => {
    const target = await initInstall("maker-list-state-empty-dir-", { format: "pack", addon: "saas" });
    directories.push(target);
    await mkdir(join(target, ".maker", "addons"), { recursive: true });
    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · applied");
  });

  it("sem install: catálogo todo available; JSON órfão aparece degraded", async () => {
    const target = await initInstall("maker-list-state-orphan-", { format: "pack", addon: "saas" });
    directories.push(target);
    await rm(join(target, ".maker"), { recursive: true, force: true });
    const record = { id: "saas", version: "0.1.0", appliedAt: "2026-09-28T12:00:00.000Z", knobs: {}, createdFiles: [], injectedTargets: [] };
    await writeAddonStateFile(target, "saas", record);

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · degraded");
    expect(output).toContain("estado de add-on sem install do maker");
  });
});
