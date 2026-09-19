import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ChangePlan, PlannedChange } from "./plan.js";
import { hasConflicts, inspectTarget } from "./plan.js";

interface JournalOperation {
  path: string;
  action: "create" | "update" | "remove";
  originalKind: "absent" | "file" | "other";
  started: boolean;
}

interface Journal {
  id: string;
  operations: JournalOperation[];
}

const TRANSACTIONS = ".maker/transactions";
const LOCK = ".maker/transaction.lock";

export async function recoverPendingTransactions(targetDir: string): Promise<void> {
  const root = join(targetDir, TRANSACTIONS);
  let ids: string[];
  try {
    ids = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const id of ids.sort()) {
    const dir = join(root, id);
    let journal: Journal;
    try {
      journal = JSON.parse(await readFile(join(dir, "journal.json"), "utf-8")) as Journal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await rollback(targetDir, dir, journal);
    await rm(dir, { recursive: true, force: true });
  }
}

export async function assertNoPendingTransactions(targetDir: string): Promise<void> {
  try {
    const ids = await readdir(join(targetDir, TRANSACTIONS));
    if (ids.length) throw new Error("Existe uma transação pendente; execute um comando sem --dry-run para recuperá-la.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function applyChangePlan(plan: ChangePlan, options: { failAfter?: number } = {}): Promise<void> {
  if (hasConflicts(plan)) throw new Error("O plano contém conflitos; nenhuma alteração foi feita.");
  await mkdir(join(plan.targetDir, ".maker"), { recursive: true });
  const lockPath = join(plan.targetDir, LOCK);
  const lock = await acquireLock(lockPath);
  await lock.writeFile(String(process.pid));

  const actionable = plan.changes.filter(
    (change): change is PlannedChange & { action: "create" | "update" | "remove" } =>
      change.action === "create" || change.action === "update" || change.action === "remove",
  ).sort((a, b) => {
    const aMetadata = isMetadata(a.path) ? 1 : 0;
    const bMetadata = isMetadata(b.path) ? 1 : 0;
    return aMetadata - bMetadata || a.path.localeCompare(b.path);
  });
  const id = randomUUID();
  const transactionDir = join(plan.targetDir, TRANSACTIONS, id);
  const journal: Journal = {
    id,
    operations: actionable.map((change) => ({
      path: change.path,
      action: change.action,
      originalKind: change.expectedKind,
      started: false,
    })),
  };

  try {
    await recoverPendingTransactions(plan.targetDir);
    await mkdir(join(transactionDir, "backup"), { recursive: true });
    await mkdir(join(transactionDir, "stage"), { recursive: true });
    for (let i = 0; i < actionable.length; i++) {
      const change = actionable[i]!;
      const current = await inspectTarget(plan.targetDir, change.path);
      if (current.kind !== change.expectedKind || current.hash !== change.expectedHash) {
        throw new Error(`${change.path} mudou depois do planejamento; execute novamente.`);
      }
      if (current.kind !== "absent") {
        await cp(join(plan.targetDir, change.path), join(transactionDir, "backup", String(i)), {
          recursive: true,
          dereference: false,
        });
      }
      if (change.action !== "remove") {
        await writeFile(join(transactionDir, "stage", String(i)), change.content!);
      }
    }
    await writeJournal(transactionDir, journal);

    for (let i = 0; i < actionable.length; i++) {
      const change = actionable[i]!;
      journal.operations[i]!.started = true;
      await writeJournal(transactionDir, journal);
      const destination = join(plan.targetDir, change.path);
      if (change.action === "remove") {
        await rm(destination, { recursive: true, force: true });
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await rm(destination, { recursive: true, force: true });
        await rename(join(transactionDir, "stage", String(i)), destination);
        if (change.mode !== undefined) await chmod(destination, change.mode & 0o777);
      }
      if (options.failAfter === i) throw new Error("Falha injetada durante a aplicação.");
    }
    await rm(transactionDir, { recursive: true, force: true });
  } catch (error) {
    await rollback(plan.targetDir, transactionDir, journal);
    await rm(transactionDir, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function acquireLock(lockPath: string): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    return await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let active = true;
    try {
      const pid = Number(await readFile(lockPath, "utf-8"));
      if (!Number.isInteger(pid) || pid <= 0) active = false;
      else process.kill(pid, 0);
    } catch (lockError) {
      if ((lockError as NodeJS.ErrnoException).code === "ESRCH") active = false;
      else if ((lockError as NodeJS.ErrnoException).code !== undefined) throw lockError;
    }
    if (active) throw new Error("Outra mutação do maker está em andamento neste projeto.");
    await rm(lockPath, { force: true });
    return open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  }
}

function isMetadata(path: string): boolean {
  return path === ".maker/manifest.json" || /^\.maker\/addons\/[^/]+\.json$/.test(path);
}

async function writeJournal(dir: string, journal: Journal): Promise<void> {
  const temporary = join(dir, "journal.json.tmp");
  await writeFile(temporary, JSON.stringify(journal, null, 2) + "\n", "utf-8");
  await rename(temporary, join(dir, "journal.json"));
}

async function rollback(targetDir: string, transactionDir: string, journal: Journal): Promise<void> {
  for (let i = journal.operations.length - 1; i >= 0; i--) {
    const operation = journal.operations[i]!;
    if (!operation.started) continue;
    const destination = join(targetDir, operation.path);
    const backup = join(transactionDir, "backup", String(i));
    await rm(destination, { recursive: true, force: true });
    if (operation.originalKind !== "absent") {
      await mkdir(dirname(destination), { recursive: true });
      await cp(backup, destination, { recursive: true, dereference: false });
    }
  }
}
