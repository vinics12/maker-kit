import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlan, formatPlan, planWrite } from "../src/changes/plan.js";
import { applyChangePlan, recoverPendingTransactions } from "../src/changes/transaction.js";

describe("change plan", () => {
  it("ordena e formata operações deterministicamente", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-plan-"));
    const b = await planWrite({ targetDir: target, path: "b.txt", content: "b", source: "engine" });
    const a = await planWrite({ targetDir: target, path: "a.txt", content: "a", source: "engine" });
    const plan = createPlan(target, [b, a]);
    expect(plan.changes.map((change) => change.path)).toEqual(["a.txt", "b.txt"]);
    expect(formatPlan(plan)).toContain("create   a.txt");
  });

  it("revalida o alvo antes de escrever", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-plan-race-"));
    await writeFile(join(target, "a.txt"), "antes");
    const change = await planWrite({
      targetDir: target,
      path: "a.txt",
      content: "depois",
      source: "engine",
      force: true,
    });
    await writeFile(join(target, "a.txt"), "concorrente");
    await expect(applyChangePlan(createPlan(target, [change]))).rejects.toThrow("mudou depois");
    expect(await readFile(join(target, "a.txt"), "utf-8")).toBe("concorrente");
  });

  it("aplica criações e atualizações", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-plan-apply-"));
    const change = await planWrite({ targetDir: target, path: "a.txt", content: "ok", source: "engine" });
    await applyChangePlan(createPlan(target, [change]));
    expect(await readFile(join(target, "a.txt"), "utf-8")).toBe("ok");
  });

  it("faz rollback integral quando uma operação falha", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-plan-rollback-"));
    await writeFile(join(target, "a.txt"), "a0");
    await writeFile(join(target, "b.txt"), "b0");
    const a = await planWrite({ targetDir: target, path: "a.txt", content: "a1", source: "engine", force: true });
    const b = await planWrite({ targetDir: target, path: "b.txt", content: "b1", source: "engine", force: true });
    await expect(applyChangePlan(createPlan(target, [a, b]), { failAfter: 0 })).rejects.toThrow("Falha injetada");
    expect(await readFile(join(target, "a.txt"), "utf-8")).toBe("a0");
    expect(await readFile(join(target, "b.txt"), "utf-8")).toBe("b0");
  });

  it("recupera uma transação interrompida", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-plan-recover-"));
    const transaction = join(target, ".maker", "transactions", "tx");
    await mkdir(join(transaction, "backup"), { recursive: true });
    await writeFile(join(target, "a.txt"), "parcial");
    await writeFile(join(transaction, "backup", "0"), "original");
    await writeFile(join(transaction, "journal.json"), JSON.stringify({
      id: "tx",
      operations: [{ path: "a.txt", action: "update", originalKind: "file", started: true }],
    }));
    await recoverPendingTransactions(target);
    expect(await readFile(join(target, "a.txt"), "utf-8")).toBe("original");
  });
});
