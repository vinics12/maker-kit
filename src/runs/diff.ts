/**
 * Diff de gate em JS puro — P1 do repo. Nenhum subprocesso/binário externo
 * (`git diff`, `diff` de shell): a persistência do stream de eventos não pode
 * depender do que está instalado no host (portabilidade + auditabilidade do
 * trilho L0).
 *
 * Seam com o orquestrador (plan.md §2): este módulo entrega só uma narração-
 * *stub* determinística (contagem +N/−M derivada do próprio diff) — nunca chama
 * LLM nem fabrica motivo (FR-018/019/020). A narração NL rica de `reason_inferred`
 * é responsabilidade do agente orquestrador ao emitir `gate.decision`; aqui o
 * contrato é só "diff persistido + resumo determinístico do delta".
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runDir, RUNS_DIR } from "./emit.js";
import type { Phase } from "./schema.js";

export interface GateDiffInput {
  runId: string;
  gate: Phase;
  before: string;
  after: string;
}

export interface GateDiffResult {
  artifact_diff_ref?: string;
  narration: string;
}

type HunkLine = { kind: "ctx" | "add" | "del"; text: string };

/**
 * LCS por linha via matriz de comprimentos + backtrack — O(n*m) tempo/espaço,
 * suficiente para artefatos de gate (specs/plans, não repositórios inteiros).
 */
function diffLines(beforeLines: string[], afterLines: string[]): HunkLine[] {
  const n = beforeLines.length;
  const m = afterLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const cell = (i: number, j: number): number => lcs[i]?.[j] ?? 0;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i];
      if (!row) continue;
      row[j] = beforeLines[i] === afterLines[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }

  const hunks: HunkLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const b = beforeLines[i] as string;
    const a = afterLines[j] as string;
    if (b === a) {
      hunks.push({ kind: "ctx", text: b });
      i++;
      j++;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      hunks.push({ kind: "del", text: b });
      i++;
    } else {
      hunks.push({ kind: "add", text: a });
      j++;
    }
  }
  while (i < n) {
    hunks.push({ kind: "del", text: beforeLines[i] as string });
    i++;
  }
  while (j < m) {
    hunks.push({ kind: "add", text: afterLines[j] as string });
    j++;
  }
  return hunks;
}

function serializeHunks(hunks: HunkLine[]): string {
  const prefix = { ctx: "  ", add: "+ ", del: "- " } as const;
  return hunks.map((h) => `${prefix[h.kind]}${h.text}`).join("\n") + "\n";
}

/**
 * Narração-stub determinística: contagem de linhas adicionadas/removidas.
 * Não interpreta conteúdo — só resume o delta bruto (FR-018/020).
 */
function summarizeDelta(hunks: HunkLine[]): string {
  const added = hunks.filter((h) => h.kind === "add").length;
  const removed = hunks.filter((h) => h.kind === "del").length;
  return `+${added}/-${removed} linhas`;
}

export async function computeGateDiff(
  target: string,
  input: GateDiffInput,
): Promise<GateDiffResult> {
  const { runId, gate, before, after } = input;

  if (before === after) {
    return { narration: "sem alterações" };
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const hunks = diffLines(beforeLines, afterLines);

  const dir = runDir(target, runId);
  await mkdir(dir, { recursive: true });
  const absolutePath = join(dir, `${gate}.diff`);
  await writeFile(absolutePath, serializeHunks(hunks), "utf-8");

  // artifact_diff_ref é relativo ao target (não inline na linha JSONL, não
  // absoluto do host) — evita vazar layout de filesystem no stream portável.
  const relativeRef = join(RUNS_DIR, runId, `${gate}.diff`);

  return {
    artifact_diff_ref: relativeRef,
    narration: summarizeDelta(hunks),
  };
}
