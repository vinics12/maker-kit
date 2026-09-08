# Contrato — Schema do Evento (load-bearing)

Implementado em `src/runs/schema.ts` (zod). Este documento é o contrato; o zod é a execução. Fixtures de teste usam **valores exatos** destes enums (PR6).

## Zod (forma normativa)

```ts
import { z } from "zod";

export const phaseSchema = z.enum(["spec", "plan", "dev", "review"]);
export const decisionSchema = z.enum(["approve", "reject", "edit"]);

export const costSchema = z.object({
  tokens: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
}).strict();

const base = {
  run_id: z.string().min(1),
  ts: z.string().datetime({ offset: true }), // ISO-8601 UTC
  cost: costSchema,
};

export const runStartSchema = z.object({ type: z.literal("run.start"), ...base }).strict();
export const runEndSchema   = z.object({ type: z.literal("run.end"),   ...base }).strict();

export const agentHandoffSchema = z.object({
  type: z.literal("agent.handoff"),
  actor: z.string().min(1),
  phase: phaseSchema,
  ...base,
}).strict();

export const gateDecisionSchema = z.object({
  type: z.literal("gate.decision"),
  gate: phaseSchema,
  actor: z.string().min(1),
  decision: decisionSchema,
  reason_inferred: z.string(),
  artifact_diff_ref: z.string().optional(),
  ...base,
}).strict();

export const eventSchema = z.discriminatedUnion("type", [
  runStartSchema, agentHandoffSchema, gateDecisionSchema, runEndSchema,
]);

export type Event = z.infer<typeof eventSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Decision = z.infer<typeof decisionSchema>;
```

## Regras que o `.strict()` codifica

- `run.start`/`run.end` **não** aceitam `phase`, `gate`, `actor`, `decision`, `reason_inferred`, `artifact_diff_ref` (FR-007a).
- `agent.handoff` exige `phase`, proíbe `gate`/`decision`.
- `gate.decision` exige `gate`+`decision`+`reason_inferred`, proíbe `phase`.

## Exemplos válidos (fixtures canônicas)

```jsonl
{"type":"run.start","run_id":"2026-09-07T14-32-10_evt-stream","ts":"2026-09-07T14:32:10Z","cost":{"tokens":0,"duration_ms":0}}
{"type":"agent.handoff","run_id":"2026-09-07T14-32-10_evt-stream","ts":"2026-09-07T14:33:00Z","actor":"architect","phase":"plan","cost":{"tokens":100,"duration_ms":10}}
{"type":"gate.decision","run_id":"2026-09-07T14-32-10_evt-stream","ts":"2026-09-07T14:40:00Z","gate":"plan","actor":"human","decision":"reject","reason_inferred":"escopo do plano ampliado: +2 endpoints","artifact_diff_ref":"2026-09-07T14-32-10_evt-stream/plan.diff","cost":{"tokens":0,"duration_ms":5}}
{"type":"run.end","run_id":"2026-09-07T14-32-10_evt-stream","ts":"2026-09-07T14:41:00Z","cost":{"tokens":18422,"duration_ms":41000}}
```

## Exemplos inválidos (devem reprovar)

```jsonc
{"type":"run.start", ... ,"phase":"spec", ...}          // run-level com fase → INV-3
{"type":"agent.handoff", ... }  // sem "phase"           // handoff exige fase
{"type":"gate.decision", ... ,"decision":"approved"}     // enum errado (PR6: valor exato "approve")
{"type":"run.end", ... ,"cost":{"tokens":-1,...}}        // tokens negativo
```
