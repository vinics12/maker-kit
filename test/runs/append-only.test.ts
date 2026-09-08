import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEvent, runFilePath } from "../../src/runs/emit.js";
import type { Event } from "../../src/runs/schema.js";

const RUN_ID = "2026-09-08T09-00-00_append-only";

function handoff(n: number): Event {
  return {
    type: "agent.handoff",
    run_id: RUN_ID,
    ts: "2026-09-08T09:00:00Z",
    actor: `agent-${n}`,
    phase: "dev",
    cost: { tokens: n, duration_ms: n },
  };
}

describe("appendEvent — prova P3 (append-only)", () => {
  it("o prefixo de bytes anterior nunca muda; o arquivo só cresce", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-append-only-"));
    const path = runFilePath(target, RUN_ID);

    let previous = "";
    for (let n = 0; n < 5; n++) {
      await appendEvent(target, handoff(n));
      const current = await readFile(path, "utf-8");
      expect(current.startsWith(previous), `emissão ${n}: prefixo anterior mudou`).toBe(true);
      expect(current.length).toBeGreaterThan(previous.length);
      previous = current;
    }
  });
});
