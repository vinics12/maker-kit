import { resolve } from "node:path";
import pc from "picocolors";

import { listRunFiles, readRun } from "../runs/read.js";
import { costByGate, runTotals } from "../runs/aggregate.js";
import { phaseSchema } from "../runs/schema.js";

export interface RunsOptions {
  target?: string;
}

const GATES = phaseSchema.options; // ordem fixa (spec, plan, dev, review) — saída determinística

/** Lista runs com custo/tempo por gate + total (FR-009..015). Leitura pura, nunca muta `.maker/runs/`. */
export async function runRuns(opts: RunsOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const files = await listRunFiles(targetDir);

  if (files.length === 0) {
    console.log(pc.dim("nenhum run registrado"));
    return;
  }

  for (const file of files) {
    const events = await readRun(file.path);
    const perGate = costByGate(events);
    const total = runTotals(events);

    console.log(pc.bold(file.runId));
    for (const gate of GATES) {
      const cost = perGate[gate];
      if (!cost) continue;
      console.log(
        pc.dim(`  ${gate}: tokens=${cost.tokens} duration_ms=${cost.duration_ms}`),
      );
    }
    console.log(`  total: tokens=${total.tokens} duration_ms=${total.duration_ms}`);
  }
}
