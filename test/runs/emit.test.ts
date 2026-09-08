import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEvent, runFilePath } from "../../src/runs/emit.js";
import { eventSchema, type Event } from "../../src/runs/schema.js";

const RUN_ID = "2026-09-07T14-32-10_evt-stream";

const SEQUENCE: Event[] = [
  {
    type: "run.start",
    run_id: RUN_ID,
    ts: "2026-09-07T14:32:10Z",
    cost: { tokens: 0, duration_ms: 0 },
  },
  {
    type: "agent.handoff",
    run_id: RUN_ID,
    ts: "2026-09-07T14:33:00Z",
    actor: "architect",
    phase: "plan",
    cost: { tokens: 100, duration_ms: 10 },
  },
  {
    type: "gate.decision",
    run_id: RUN_ID,
    ts: "2026-09-07T14:40:00Z",
    gate: "plan",
    actor: "human",
    decision: "reject",
    reason_inferred: "escopo ampliado",
    cost: { tokens: 0, duration_ms: 5 },
  },
  {
    type: "run.end",
    run_id: RUN_ID,
    ts: "2026-09-07T14:41:00Z",
    cost: { tokens: 18422, duration_ms: 41000 },
  },
];

describe("appendEvent", () => {
  let target: string;

  beforeAll(async () => {
    target = await mkdtemp(join(tmpdir(), "maker-runs-"));
    for (const event of SEQUENCE) {
      await appendEvent(target, event);
    }
  });

  it("grava 4 linhas JSONL válidas, na ordem", async () => {
    const raw = await readFile(runFilePath(target, RUN_ID), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(4);
    lines.forEach((line, i) => {
      const parsed = eventSchema.parse(JSON.parse(line));
      expect(parsed.type).toBe(SEQUENCE[i].type);
    });
  });

  it("emitir sobre arquivo existente só anexa (não trunca)", async () => {
    const before = await readFile(runFilePath(target, RUN_ID), "utf-8");
    await appendEvent(target, SEQUENCE[0]);
    const after = await readFile(runFilePath(target, RUN_ID), "utf-8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
  });
});
