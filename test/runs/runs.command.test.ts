import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { runRuns } from "../../src/commands/runs.js";
import { appendEvent } from "../../src/runs/emit.js";
import type { Event } from "../../src/runs/schema.js";

const RUN_A = "2026-09-08T09-00-00_a";
const RUN_B = "2026-09-08T10-00-00_b";

/** Hash determinístico do conteúdo de `.maker/runs/**` — prova SC-005 (leitura pura). */
async function hashRunsDir(target: string): Promise<string> {
  const dir = join(target, ".maker/runs");
  let entries: string[] = [];
  try {
    entries = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return "empty";
  }
  const hash = createHash("sha256");
  for (const name of entries) {
    hash.update(name);
    hash.update(await readFile(join(dir, name)));
  }
  return hash.digest("hex");
}

let logSpy: ReturnType<typeof vi.spyOn>;
let logs: string[];

beforeEach(() => {
  logs = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
    logs.push(msg);
  });
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("runRuns — caso vazio (FR-014)", () => {
  it(".maker/runs/ ausente ⇒ exit 0 e mensagem, sem stack trace", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-runs-cmd-absent-"));
    await expect(runRuns({ target })).resolves.toBeUndefined();
    expect(logs.join("\n")).toContain("nenhum run registrado");
  });

  it(".maker/runs/ vazio ⇒ exit 0 e mensagem", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-runs-cmd-empty-"));
    await mkdir(join(target, ".maker/runs"), { recursive: true });
    await expect(runRuns({ target })).resolves.toBeUndefined();
    expect(logs.join("\n")).toContain("nenhum run registrado");
  });
});

describe("runRuns — caso feliz", () => {
  it("lista N runs com custo/tempo por gate + total, e nunca muta .maker/runs/ (SC-005)", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-runs-cmd-happy-"));

    const runA: Event[] = [
      { type: "run.start", run_id: RUN_A, ts: "2026-09-08T09:00:00Z", cost: { tokens: 0, duration_ms: 0 } },
      { type: "agent.handoff", run_id: RUN_A, ts: "2026-09-08T09:01:00Z", actor: "architect", phase: "plan", cost: { tokens: 100, duration_ms: 10 } },
      { type: "agent.handoff", run_id: RUN_A, ts: "2026-09-08T09:02:00Z", actor: "architect", phase: "plan", cost: { tokens: 200, duration_ms: 20 } },
      { type: "agent.handoff", run_id: RUN_A, ts: "2026-09-08T09:03:00Z", actor: "architect", phase: "plan", cost: { tokens: 300, duration_ms: 30 } },
      { type: "gate.decision", run_id: RUN_A, ts: "2026-09-08T09:04:00Z", gate: "plan", actor: "human", decision: "approve", reason_inferred: "ok", cost: { tokens: 0, duration_ms: 5 } },
      { type: "run.end", run_id: RUN_A, ts: "2026-09-08T09:05:00Z", cost: { tokens: 0, duration_ms: 0 } },
    ];
    const runB: Event[] = [
      { type: "run.start", run_id: RUN_B, ts: "2026-09-08T10:00:00Z", cost: { tokens: 0, duration_ms: 0 } },
      { type: "agent.handoff", run_id: RUN_B, ts: "2026-09-08T10:01:00Z", actor: "dev", phase: "dev", cost: { tokens: 50, duration_ms: 5 } },
      { type: "run.end", run_id: RUN_B, ts: "2026-09-08T10:02:00Z", cost: { tokens: 0, duration_ms: 0 } },
    ];
    for (const e of [...runA, ...runB]) await appendEvent(target, e);

    const before = await hashRunsDir(target);
    await runRuns({ target });
    const after = await hashRunsDir(target);
    expect(after).toBe(before);

    const output = logs.join("\n");
    expect(output).toContain(RUN_A);
    expect(output).toContain(RUN_B);
    // US2 AC6 — a linha do gate plan de RUN_A reporta a soma exata.
    expect(output).toMatch(/plan: tokens=600 duration_ms=65/);
    expect(output).toMatch(/dev: tokens=50 duration_ms=5/);
  });
});

describe("runRuns — seção L1 de rejeição por gate (US4 AC1/AC2)", () => {
  it("3 runs com decisões variadas ⇒ contagem N de M exata por gate, sem supressão", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-runs-cmd-l1-"));

    const RUN_C = "2026-09-08T11-00-00_c";
    const runA: Event[] = [
      { type: "run.start", run_id: RUN_A, ts: "2026-09-08T09:00:00Z", cost: { tokens: 0, duration_ms: 0 } },
      { type: "gate.decision", run_id: RUN_A, ts: "2026-09-08T09:04:00Z", gate: "plan", actor: "human", decision: "reject", reason_inferred: "faltou caso", cost: { tokens: 0, duration_ms: 5 } },
      { type: "run.end", run_id: RUN_A, ts: "2026-09-08T09:05:00Z", cost: { tokens: 0, duration_ms: 0 } },
    ];
    const runB: Event[] = [
      { type: "run.start", run_id: RUN_B, ts: "2026-09-08T10:00:00Z", cost: { tokens: 0, duration_ms: 0 } },
      { type: "gate.decision", run_id: RUN_B, ts: "2026-09-08T10:01:00Z", gate: "plan", actor: "human", decision: "approve", reason_inferred: "ok", cost: { tokens: 0, duration_ms: 5 } },
      { type: "run.end", run_id: RUN_B, ts: "2026-09-08T10:02:00Z", cost: { tokens: 0, duration_ms: 0 } },
    ];
    const runC: Event[] = [
      { type: "run.start", run_id: RUN_C, ts: "2026-09-08T11:00:00Z", cost: { tokens: 0, duration_ms: 0 } },
      { type: "gate.decision", run_id: RUN_C, ts: "2026-09-08T11:01:00Z", gate: "plan", actor: "human", decision: "reject", reason_inferred: "faltou teste", cost: { tokens: 0, duration_ms: 5 } },
      { type: "run.end", run_id: RUN_C, ts: "2026-09-08T11:02:00Z", cost: { tokens: 0, duration_ms: 0 } },
    ];
    for (const e of [...runA, ...runB, ...runC]) await appendEvent(target, e);

    await runRuns({ target });

    const output = logs.join("\n");
    // plan reprovado em 2 dos 3 runs (A e C rejeitam, B aprova).
    expect(output).toMatch(/plan reprovou em 2 de 3 runs/);
    // sem supressão por limiar: gates sem nenhuma rejeição também aparecem.
    expect(output).toMatch(/spec reprovou em 0 de 3 runs/);
    expect(output).toMatch(/dev reprovou em 0 de 3 runs/);
    expect(output).toMatch(/review reprovou em 0 de 3 runs/);
  });
});
