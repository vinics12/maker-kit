import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPlan } from "../../src/changes/plan.js";
import { applyChangePlan } from "../../src/changes/transaction.js";
import { openState } from "../../src/state/store.js";
import { LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { planUpdate, runUpdate } from "../../src/commands/update.js";
import { initInstall, snapshotTree } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("rollback da migração (AC-10, AC-11)", () => {
  it("AC-10(a): falha injetada durante a migração files→pack não deixa alteração", async () => {
    const target = await initInstall("maker-update-rollback-failafter-", { format: "unset" });
    directories.push(target);
    const before = await snapshotTree(target);
    const state = await openState(target, { mode: "mutate" });
    const { plan } = await planUpdate(target, { state });
    await expect(applyChangePlan(plan, { failAfter: 1 })).rejects.toThrow();
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-10(a): falha injetada durante a migração pack→files não deixa alteração", async () => {
    const target = await initInstall("maker-update-rollback-failafter-reverse-", { format: "pack" });
    directories.push(target);
    await writeFile(join(target, "maker.config.json"), JSON.stringify({ project: { name: "X" }, state: { bases: "files" } }));
    const before = await snapshotTree(target);
    const state = await openState(target, { mode: "mutate" });
    const { plan } = await planUpdate(target, { state });
    await expect(applyChangePlan(plan, { failAfter: 1 })).rejects.toThrow();
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-10(b): crash em cada ponto da migração deixa coexistência recuperável — próximo comando mutante recupera exatamente o estado anterior", async () => {
    const target = await initInstall("maker-update-rollback-crash-", { format: "unset" });
    directories.push(target);
    const before = await snapshotTree(target);
    const state = await openState(target, { mode: "mutate" });
    const { plan } = await planUpdate(target, { state });
    const actionable = plan.changes.filter((change) => change.action === "create" || change.action === "update" || change.action === "remove");
    for (let i = 0; i < actionable.length; i++) {
      const fresh = await initInstall(`maker-update-rollback-crash-point-${i}-`, { format: "unset" });
      directories.push(fresh);
      const freshState = await openState(fresh, { mode: "mutate" });
      const freshPlan = (await planUpdate(fresh, { state: freshState })).plan;
      await expect(applyChangePlan(freshPlan, { crashAfter: i })).rejects.toThrow(/Falha simulada/);
      // Recupera antes de ler: o próximo comando mutante limpa o journal e conclui a transação.
      await runUpdate({ target: fresh });
      expect(existsSync(join(fresh, LOCKFILE))).toBe(true);
      expect(existsSync(join(fresh, MANIFEST_FILE))).toBe(false);
    }
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("AC-11: falha no update em pack (sem migração) não deixa alteração", async () => {
    const target = await initInstall("maker-update-rollback-pack-fail-", { format: "pack" });
    directories.push(target);
    // Arquivo gerenciado ausente: garante ao menos uma operação "create" no plano (accionável).
    await rm(join(target, "AGENTS.md"));
    const before = await snapshotTree(target);
    const state = await openState(target, { mode: "mutate" });
    const { plan } = await planUpdate(target, { state });
    const actionable = plan.changes.filter((change) => change.action === "create" || change.action === "update" || change.action === "remove");
    expect(actionable.length).toBeGreaterThan(0);
    await expect(applyChangePlan(plan, { failAfter: 0 })).rejects.toThrow();
    expect(await snapshotTree(target)).toEqual(before);
  });
});
