import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../render/manifest.js";

export type ChangeAction = "create" | "update" | "preserve" | "remove" | "conflict";
export type ChangeResolution = "replace" | "merge";

export interface PlannedChange {
  path: string;
  action: ChangeAction;
  source: string;
  reason: string;
  expectedHash: string | null;
  expectedKind: "absent" | "file" | "other";
  content?: Buffer;
  mode?: number;
  resolution?: ChangeResolution;
}

export interface ChangePlan {
  targetDir: string;
  changes: PlannedChange[];
}

export function createPlan(targetDir: string, changes: PlannedChange[]): ChangePlan {
  const byPath = new Map<string, PlannedChange>();
  for (const change of changes) byPath.set(change.path, change);
  return { targetDir, changes: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

export function hasConflicts(plan: ChangePlan): boolean {
  return plan.changes.some((change) => change.action === "conflict");
}

export function formatPlan(plan: ChangePlan): string {
  if (!plan.changes.length) return "nenhuma alteração planejada";
  return plan.changes
    .map((change) => {
      const action = change.resolution === "merge" ? "merge" : change.action;
      return `${action.padEnd(8)} ${change.path} [${change.source}] — ${change.reason}`;
    })
    .join("\n");
}

export async function inspectTarget(
  targetDir: string,
  path: string,
): Promise<{ kind: "absent" | "file" | "other"; hash: string | null; mode?: number; content?: Buffer }> {
  const absolute = join(targetDir, path);
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile()) return { kind: "other", hash: null, mode: metadata.mode };
    const content = await readFile(absolute);
    return { kind: "file", hash: sha256(content), mode: metadata.mode, content };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent", hash: null };
    throw error;
  }
}

export async function planWrite(args: {
  targetDir: string;
  path: string;
  content: Buffer | string;
  source: string;
  reason?: string;
  force?: boolean;
  mode?: number;
}): Promise<PlannedChange> {
  const desired = Buffer.isBuffer(args.content) ? args.content : Buffer.from(args.content);
  const current = await inspectTarget(args.targetDir, args.path);
  if (current.kind === "absent") {
    return {
      path: args.path,
      action: "create",
      source: args.source,
      reason: args.reason ?? "arquivo ausente",
      expectedHash: null,
      expectedKind: "absent",
      content: desired,
      mode: args.mode,
    };
  }
  if (current.kind === "other") {
    return {
      path: args.path,
      action: args.force ? "update" : "conflict",
      source: args.source,
      reason: "o caminho existente não é um arquivo regular",
      expectedHash: null,
      expectedKind: "other",
      content: desired,
      mode: args.mode,
    };
  }
  if (current.content!.equals(desired)) {
    return {
      path: args.path,
      action: "preserve",
      source: args.source,
      reason: "conteúdo já está atualizado",
      expectedHash: current.hash,
      expectedKind: "file",
    };
  }
  return {
    path: args.path,
    action: args.force ? "update" : "conflict",
    source: args.source,
    reason: args.reason ?? "conteúdo existente é diferente",
    expectedHash: current.hash,
    expectedKind: "file",
    content: desired,
    mode: args.mode ?? current.mode,
  };
}
