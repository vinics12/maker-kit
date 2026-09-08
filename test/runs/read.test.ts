import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listRunFiles, readRun } from "../../src/runs/read.js";

const RUN_ID = "2026-09-08T09-00-00_read";

describe("listRunFiles", () => {
  it("retorna lista vazia sem throw quando .maker/runs/ está ausente", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-read-absent-"));
    await expect(listRunFiles(target)).resolves.toEqual([]);
  });

  it("retorna lista vazia sem throw quando .maker/runs/ existe mas está vazio", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-read-empty-"));
    await mkdir(join(target, ".maker/runs"), { recursive: true });
    await expect(listRunFiles(target)).resolves.toEqual([]);
  });

  it("lista só arquivos .jsonl de topo, ordenados por run_id", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-read-list-"));
    const runsDir = join(target, ".maker/runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "2026-09-08T10-00-00_b.jsonl"), "");
    await writeFile(join(runsDir, "2026-09-08T09-00-00_a.jsonl"), "");
    // diretório companheiro de diffs de gate não é um run
    await mkdir(join(runsDir, "2026-09-08T09-00-00_a"), { recursive: true });

    const files = await listRunFiles(target);
    expect(files.map((f) => f.runId)).toEqual([
      "2026-09-08T09-00-00_a",
      "2026-09-08T10-00-00_b",
    ]);
  });
});

describe("readRun — parse tolerante (FR-013)", () => {
  it("retorna linhas íntegras e ignora a última linha truncada", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-read-truncated-"));
    const runsDir = join(target, ".maker/runs");
    await mkdir(runsDir, { recursive: true });
    const path = join(runsDir, `${RUN_ID}.jsonl`);

    const intact = JSON.stringify({
      type: "run.start",
      run_id: RUN_ID,
      ts: "2026-09-08T09:00:00Z",
      cost: { tokens: 0, duration_ms: 0 },
    });
    const truncated = '{"type":"agent.handoff","run_id":"' + RUN_ID + '","ts":"2026-09';
    await writeFile(path, intact + "\n" + truncated);

    const events = await readRun(path);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("run.start");
  });

  it("ignora linha não-truncada mas inválida contra o schema, sem throw", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-read-invalid-"));
    const runsDir = join(target, ".maker/runs");
    await mkdir(runsDir, { recursive: true });
    const path = join(runsDir, `${RUN_ID}.jsonl`);

    const intact = JSON.stringify({
      type: "run.start",
      run_id: RUN_ID,
      ts: "2026-09-08T09:00:00Z",
      cost: { tokens: 0, duration_ms: 0 },
    });
    const invalid = JSON.stringify({ type: "unknown.event", foo: "bar" });
    await writeFile(path, intact + "\n" + invalid + "\n");

    const events = await readRun(path);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("run.start");
  });
});
