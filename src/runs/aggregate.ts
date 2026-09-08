import { phaseSchema, type Event, type Phase } from "./schema.js";

export interface GateCost {
  tokens: number;
  duration_ms: number;
}

export type CostByGate = Partial<Record<Phase, GateCost>>;

/**
 * Custo de um gate = soma de `agent.handoff` com `phase==G` mais
 * `gate.decision` com `gate==G`. Eventos de nível de run (`run.start`/`run.end`)
 * não carregam fase e ficam fora de qualquer gate — soma comutativa,
 * então a ordem de leitura não altera o resultado.
 */
export function costByGate(events: Event[]): CostByGate {
  const result: CostByGate = {};
  for (const event of events) {
    const gate = faseDe(event);
    if (gate === undefined) continue;
    const acc = (result[gate] ??= { tokens: 0, duration_ms: 0 });
    acc.tokens += event.cost.tokens;
    acc.duration_ms += event.cost.duration_ms;
  }
  return result;
}

/** Total do run = soma sobre todos os eventos do arquivo, incluindo run.start/run.end. */
export function runTotals(events: Event[]): GateCost {
  const total: GateCost = { tokens: 0, duration_ms: 0 };
  for (const event of events) {
    total.tokens += event.cost.tokens;
    total.duration_ms += event.cost.duration_ms;
  }
  return total;
}

function faseDe(event: Event): Phase | undefined {
  if (event.type === "agent.handoff") return event.phase;
  if (event.type === "gate.decision") return event.gate;
  return undefined;
}

export type RejectionsByGate = Record<Phase, { n: number; m: number }>;

/**
 * Todo gate entra no resultado com `m` = total de runs, mesmo sem nenhuma rejeição —
 * é o leitor humano quem decide se N/M é significativo, não a agregação (sem limiar aqui).
 * Um run conta no máximo uma vez por gate, ainda que tenha rejeitado o mesmo gate mais de uma vez.
 */
export function rejectionsByGate(runs: Event[][]): RejectionsByGate {
  const m = runs.length;
  const result = {} as RejectionsByGate;
  for (const gate of phaseSchema.options) result[gate] = { n: 0, m };

  for (const events of runs) {
    const rejectedGates = new Set<Phase>();
    for (const event of events) {
      if (event.type === "gate.decision" && event.decision === "reject") {
        rejectedGates.add(event.gate);
      }
    }
    for (const gate of rejectedGates) result[gate].n += 1;
  }

  return result;
}
