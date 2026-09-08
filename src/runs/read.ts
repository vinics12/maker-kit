import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { eventSchema, type Event } from "./schema.js";
import { RUNS_DIR } from "./emit.js";

export interface RunFile {
  runId: string;
  path: string;
}

/**
 * Lista só `.jsonl` de topo (os diffs de gate ficam em subdiretórios
 * companheiros e não são runs) — leitura pura, nenhum `.maker/runs/`
 * ausente/vazio derruba o comando (FR-014).
 */
export async function listRunFiles(target: string): Promise<RunFile[]> {
  const dir = join(target, RUNS_DIR);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => ({ runId: basename(e.name, ".jsonl"), path: join(dir, e.name) }))
    .sort((a, b) => a.runId.localeCompare(b.runId));
}

/**
 * Parse tolerante linha-a-linha (FR-013): uma linha truncada (ex.: escrita
 * interrompida) ou inválida não pode derrubar a leitura das demais — só é
 * descartada silenciosamente.
 */
export async function readRun(path: string): Promise<Event[]> {
  const raw = await readFile(path, "utf-8");
  const events: Event[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      continue; // JSON inválido/truncado — ignora, não derruba o comando
    }
    const result = eventSchema.safeParse(parsedJson);
    if (result.success) events.push(result.data);
  }
  return events;
}
