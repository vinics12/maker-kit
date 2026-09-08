import { describe, it, expect } from "vitest";

import { costByGate, runTotals } from "../../src/runs/aggregate.js";
import type { Event, Phase } from "../../src/runs/schema.js";

const RUN_ID = "2026-09-08T09-00-00_aggregate";

function handoff(phase: Phase, tokens: number, duration_ms: number): Event {
  return {
    type: "agent.handoff",
    run_id: RUN_ID,
    ts: "2026-09-08T09:00:00Z",
    actor: "architect",
    phase,
    cost: { tokens, duration_ms },
  };
}

function decision(gate: Phase, tokens: number, duration_ms: number): Event {
  return {
    type: "gate.decision",
    run_id: RUN_ID,
    ts: "2026-09-08T09:05:00Z",
    gate,
    actor: "human",
    decision: "approve",
    reason_inferred: "ok",
    cost: { tokens, duration_ms },
  };
}

// US2 AC6 (contracts/maker-runs-output.md): 3 handoffs phase=plan (100/200/300 tokens,
// 10/20/30 duration) + 1 gate.decision gate=plan (0 tokens, 5 duration) ⇒ plan = 600/65.
const AC6_EVENTS: Event[] = [
  handoff("plan", 100, 10),
  handoff("plan", 200, 20),
  handoff("plan", 300, 30),
  decision("plan", 0, 5),
];

describe("costByGate — FR-011a", () => {
  it("US2 AC6: soma exata tokens=600 duration_ms=65 para o gate plan", () => {
    const result = costByGate(AC6_EVENTS);
    expect(result.plan).toEqual({ tokens: 600, duration_ms: 65 });
  });

  it("é independente da ordem de leitura dos eventos", () => {
    const shuffled = [...AC6_EVENTS].reverse();
    expect(costByGate(shuffled)).toEqual(costByGate(AC6_EVENTS));
  });

  it("run.start/run.end não são atribuídos a nenhum gate (INV-3)", () => {
    const events: Event[] = [
      { type: "run.start", run_id: RUN_ID, ts: "2026-09-08T09:00:00Z", cost: { tokens: 999, duration_ms: 999 } },
      handoff("dev", 50, 5),
      { type: "run.end", run_id: RUN_ID, ts: "2026-09-08T09:10:00Z", cost: { tokens: 999, duration_ms: 999 } },
    ];
    const result = costByGate(events);
    expect(result).toEqual({ dev: { tokens: 50, duration_ms: 5 } });
  });

  it("gates distintos são acumulados separadamente", () => {
    const events: Event[] = [handoff("spec", 10, 1), handoff("dev", 20, 2), decision("review", 5, 1)];
    const result = costByGate(events);
    expect(result.spec).toEqual({ tokens: 10, duration_ms: 1 });
    expect(result.dev).toEqual({ tokens: 20, duration_ms: 2 });
    expect(result.review).toEqual({ tokens: 5, duration_ms: 1 });
  });
});

describe("runTotals", () => {
  it("soma sobre todos os eventos, incluindo run.start/run.end", () => {
    const events: Event[] = [
      { type: "run.start", run_id: RUN_ID, ts: "2026-09-08T09:00:00Z", cost: { tokens: 0, duration_ms: 0 } },
      handoff("plan", 100, 10),
      decision("plan", 0, 5),
      { type: "run.end", run_id: RUN_ID, ts: "2026-09-08T09:10:00Z", cost: { tokens: 18000, duration_ms: 40000 } },
    ];
    expect(runTotals(events)).toEqual({ tokens: 18100, duration_ms: 40015 });
  });
});
