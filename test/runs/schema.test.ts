import { describe, it, expect } from "vitest";

import { eventSchema } from "../../src/runs/schema.js";

// Fixtures copiadas literalmente de contracts/event.schema.md (PR6) — não
// aproximar valores; o contrato é a fonte normativa.
const RUN_START = {
  type: "run.start",
  run_id: "2026-09-07T14-32-10_evt-stream",
  ts: "2026-09-07T14:32:10Z",
  cost: { tokens: 0, duration_ms: 0 },
};

const AGENT_HANDOFF = {
  type: "agent.handoff",
  run_id: "2026-09-07T14-32-10_evt-stream",
  ts: "2026-09-07T14:33:00Z",
  actor: "architect",
  phase: "plan",
  cost: { tokens: 100, duration_ms: 10 },
};

const GATE_DECISION = {
  type: "gate.decision",
  run_id: "2026-09-07T14-32-10_evt-stream",
  ts: "2026-09-07T14:40:00Z",
  gate: "plan",
  actor: "human",
  decision: "reject",
  reason_inferred: "escopo do plano ampliado: +2 endpoints",
  artifact_diff_ref: "2026-09-07T14-32-10_evt-stream/plan.diff",
  cost: { tokens: 0, duration_ms: 5 },
};

const RUN_END = {
  type: "run.end",
  run_id: "2026-09-07T14-32-10_evt-stream",
  ts: "2026-09-07T14:41:00Z",
  cost: { tokens: 18422, duration_ms: 41000 },
};

describe("eventSchema — exemplos válidos do contrato", () => {
  it.each([
    ["run.start", RUN_START],
    ["agent.handoff", AGENT_HANDOFF],
    ["gate.decision", GATE_DECISION],
    ["run.end", RUN_END],
  ])("%s passa", (_name, fixture) => {
    expect(eventSchema.safeParse(fixture).success).toBe(true);
  });
});

describe("eventSchema — exemplos inválidos do contrato", () => {
  it("run.start com phase reprova (INV-3)", () => {
    const r = eventSchema.safeParse({ ...RUN_START, phase: "spec" });
    expect(r.success).toBe(false);
  });

  it("agent.handoff sem phase reprova", () => {
    const { phase: _phase, ...withoutPhase } = AGENT_HANDOFF;
    const r = eventSchema.safeParse(withoutPhase);
    expect(r.success).toBe(false);
  });

  it("gate.decision com enum errado reprova (PR6: valor exato 'approve')", () => {
    const r = eventSchema.safeParse({ ...GATE_DECISION, decision: "approved" });
    expect(r.success).toBe(false);
  });

  it("run.end com tokens negativo reprova", () => {
    const r = eventSchema.safeParse({ ...RUN_END, cost: { tokens: -1, duration_ms: 0 } });
    expect(r.success).toBe(false);
  });
});
