import { z } from "zod";

export const phaseSchema = z.enum(["spec", "plan", "dev", "review"]);
export const decisionSchema = z.enum(["approve", "reject", "edit"]);

export const costSchema = z
  .object({
    tokens: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
  })
  .strict();

const base = {
  run_id: z.string().min(1),
  ts: z.string().datetime({ offset: true }), // ISO-8601 UTC
  cost: costSchema,
};

export const runStartSchema = z.object({ type: z.literal("run.start"), ...base }).strict();
export const runEndSchema = z.object({ type: z.literal("run.end"), ...base }).strict();

export const agentHandoffSchema = z
  .object({
    type: z.literal("agent.handoff"),
    actor: z.string().min(1),
    phase: phaseSchema,
    ...base,
  })
  .strict();

export const gateDecisionSchema = z
  .object({
    type: z.literal("gate.decision"),
    gate: phaseSchema,
    actor: z.string().min(1),
    decision: decisionSchema,
    reason_inferred: z.string(),
    artifact_diff_ref: z.string().optional(),
    ...base,
  })
  .strict();

// discriminatedUnion + .strict() por variante é o que impede `phase` vazar para
// run-level e campos extras em qualquer tipo — a atribuição custo→fase fica inderrubável.
export const eventSchema = z.discriminatedUnion("type", [
  runStartSchema,
  agentHandoffSchema,
  gateDecisionSchema,
  runEndSchema,
]);

export type Event = z.infer<typeof eventSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Decision = z.infer<typeof decisionSchema>;
