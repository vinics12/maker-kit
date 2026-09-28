import { afterEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { formatPlan } from "../../src/changes/plan.js";
import { planUpdate } from "../../src/commands/update.js";
import { runUpdate } from "../../src/commands/update.js";
import { initInstall, snapshotTree } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("update --dry-run: leitura pura e determinística (AC-08/SC-007, AC-12)", () => {
  it("dois dry-runs seguidos produzem o mesmo plano e não alteram a árvore, em pack e em files", async () => {
    for (const format of ["pack", "files"] as const) {
      const target = await initInstall(`maker-update-dryrun-${format}-`, { format: "unset" });
      directories.push(target);
      const before = await snapshotTree(target);
      const first = formatPlan((await planUpdate(target, {})).plan);
      const second = formatPlan((await planUpdate(target, {})).plan);
      expect(first).toBe(second);
      expect(await snapshotTree(target)).toEqual(before);
    }
  });

  it("dry-run durante uma migração pendente também é determinístico e não escreve nada", async () => {
    const target = await initInstall("maker-update-dryrun-migration-", { format: "unset" });
    directories.push(target);
    const before = await snapshotTree(target);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    await runUpdate({ target, dryRun: true });
    expect(await snapshotTree(target)).toEqual(before);
    const calls = log.mock.calls.map((call) => call.join(" "));
    const firstRun = calls.slice(0, calls.length / 2).join("\n");
    const secondRun = calls.slice(calls.length / 2).join("\n");
    expect(firstRun).toBe(secondRun);
  });

  it("AC-12: anúncio no dry-run mostra origem → destino, contagens e opt-out", async () => {
    const target = await initInstall("maker-update-dryrun-announce-", { format: "unset" });
    directories.push(target);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("Migração do formato das bases: files → pack");
    expect(output).toMatch(/\d+ base\(s\) migrada\(s\), \d+ descartada\(s\)\./);
    expect(output).toContain('declare "state": { "bases": "files" } em maker.config.json');
  });
});
