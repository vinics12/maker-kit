import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeGateDiff } from "../../src/runs/diff.js";

const RUN_ID = "2026-09-08T10-00-00_diff-test";

describe("computeGateDiff", () => {
  it("before != after: persiste diff, retorna ref não-vazia e narração derivada do delta", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-diff-"));
    const before = "linha 1\nlinha 2\nlinha 3\n";
    const after = "linha 1\nlinha 2 editada\nlinha 3\nlinha 4\n";

    const result = await computeGateDiff(target, {
      runId: RUN_ID,
      gate: "plan",
      before,
      after,
    });

    expect(result.artifact_diff_ref).toBe(join(".maker/runs", RUN_ID, "plan.diff"));
    expect(result.narration).toBe("+2/-1 linhas");

    const persisted = await readFile(join(target, result.artifact_diff_ref!), "utf-8");
    expect(persisted).toContain("- linha 2");
    expect(persisted).toContain("+ linha 2 editada");
    expect(persisted).toContain("+ linha 4");
    expect(persisted).toContain("  linha 1");
  });

  it("before == after: narração 'sem alterações', sem ref, nenhum motivo fabricado", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-diff-"));
    const same = "conteúdo idêntico\n";

    const result = await computeGateDiff(target, {
      runId: RUN_ID,
      gate: "review",
      before: same,
      after: same,
    });

    expect(result.narration).toBe("sem alterações");
    expect(result.artifact_diff_ref).toBeUndefined();

    await expect(
      access(join(target, ".maker/runs", RUN_ID, "review.diff")),
    ).rejects.toThrow();
  });

  it("narração é determinística: mesmas entradas produzem mesmo resultado", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-diff-"));
    const before = "a\nb\n";
    const after = "a\nc\n";

    const first = await computeGateDiff(target, { runId: RUN_ID, gate: "dev", before, after });
    const second = await computeGateDiff(target, { runId: RUN_ID, gate: "dev", before, after });

    expect(first.narration).toBe(second.narration);
    expect(first.narration).toBe("+1/-1 linhas");
  });
});
