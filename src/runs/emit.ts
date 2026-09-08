import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { eventSchema, type Event } from "./schema.js";

export const RUNS_DIR = ".maker/runs";

export function runFilePath(target: string, runId: string): string {
  return join(target, RUNS_DIR, `${runId}.jsonl`);
}

export function runDir(target: string, runId: string): string {
  return join(target, RUNS_DIR, runId);
}

/**
 * Só anexa: `fs.appendFile` nunca lê o arquivo existente, então uma escrita
 * concorrente ou um evento anterior malformado no disco não pode ser
 * silenciosamente reescrito (P3/P5).
 */
export async function appendEvent(target: string, event: Event): Promise<void> {
  const validated = eventSchema.parse(event);
  const path = runFilePath(target, validated.run_id);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(validated) + "\n", "utf-8");
}
