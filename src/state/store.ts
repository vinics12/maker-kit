import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { assertNoPendingTransactions, hasPendingTransactions, recoverBeforeRead } from "../changes/transaction.js";
import { sha256, type BasesFormat, type Manifest } from "../render/manifest.js";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE, basePath, isBaseName } from "./paths.js";
import { LockfileError, parseLockfile, serializeLockfile, type BaseProblem, type LockfileErrorKind } from "./lockfile.js";

export type { BasesFormat };
export type OpenMode = "mutate" | "dry-run" | "read";

export type StateErrorKind = "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict";

export class StateError extends Error {
  readonly kind: StateErrorKind;
  readonly action: string;
  readonly path: string;
  constructor(kind: StateErrorKind, message: string, action: string, path: string) {
    super(message);
    this.kind = kind;
    this.action = action;
    this.path = path;
  }
}

export interface StateSnapshot {
  targetDir: string;
  hasManifestJson: boolean;
  hasLockfile: boolean;
  basesDirEntries: string[];
  pendingTransactions: boolean;
  error?: StateError;
  manifest?: Manifest;
  inUse?: BasesFormat;
  recorded?: BasesFormat;
  bases: Map<string, Buffer>;
  baseOrigins: Map<string, ("pack" | "files")[]>;
  problems: BaseProblem[];
  looseFileBases: string[];
  conflictMarkersInBases: number;
  crlfSuspected: boolean;
}

export interface InstallState {
  targetDir: string;
  manifest: Manifest;
  inUse: BasesFormat;
  recorded?: BasesFormat;
  bases: ReadonlyMap<string, Buffer>;
  problems: readonly BaseProblem[];
  looseFileBases: readonly string[];
  readBase(hash: string): Buffer | null;
  hasBase(hash: string): boolean;
}

function stateErrorAction(kind: StateErrorKind, subject: "manifest" | "lockfile"): string {
  switch (kind) {
    case "coexistence": return "escolha um estado e remova o outro, ou restaure .maker do histórico do git";
    case "unreadable": return subject === "manifest" ? "restaure .maker/manifest.json do histórico do git" : "restaure .maker/maker.lock do histórico do git";
    case "unknown-version": return "atualize o maker";
    case "manifest-invalid": return "restaure .maker/maker.lock do histórico do git";
    case "manifest-conflict": return "resolva o conflito ou restaure .maker/maker.lock do histórico do git";
  }
}

function stateErrorMessage(kind: StateErrorKind, subject: "manifest" | "lockfile", lockfileError?: LockfileError): string {
  switch (kind) {
    case "coexistence":
      return `.maker/manifest.json e .maker/maker.lock coexistem; nenhuma alteração foi feita.`;
    case "unreadable":
      return subject === "manifest"
        ? `.maker/manifest.json ilegível; nenhuma alteração foi feita.`
        : `.maker/maker.lock ilegível; nenhuma alteração foi feita.`;
    case "unknown-version":
      return `.maker/maker.lock usa um formato mais novo que este maker entende (1); nenhuma alteração foi feita.`;
    case "manifest-invalid":
      return `seção de manifest de .maker/maker.lock inválida (linha ${lockfileError?.line}: ${lockfileError?.message}); nenhuma alteração foi feita.`;
    case "manifest-conflict":
      return `.maker/maker.lock contém marcadores de conflito do git na seção de manifest (linha ${lockfileError?.line}); nenhuma alteração foi feita.`;
  }
}

function toStateError(kind: StateErrorKind, targetDir: string, subject: "manifest" | "lockfile" = "lockfile", lockfileError?: LockfileError): StateError {
  return new StateError(kind, stateErrorMessage(kind, subject, lockfileError), stateErrorAction(kind, subject), targetDir);
}

function lockfileKindToStateKind(kind: LockfileErrorKind): StateErrorKind {
  return kind;
}

async function listBaseDirEntries(targetDir: string): Promise<string[]> {
  try {
    return (await readdir(join(targetDir, BASES_DIR))).filter(isBaseName).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Verifica bases em `.maker/bases`: válidas por hash exato, ou recuperadas via `\r\n` → `\n`. */
async function verifyFilesBases(
  targetDir: string,
  entries: string[],
): Promise<{ bases: Map<string, Buffer>; problems: BaseProblem[] }> {
  const bases = new Map<string, Buffer>();
  const problems: BaseProblem[] = [];
  for (const hash of entries) {
    const content = await readFile(join(targetDir, basePath(hash)));
    if (sha256(content) === hash) {
      bases.set(hash, content);
      continue;
    }
    const text = content.toString("utf-8");
    if (text.includes("\r\n")) {
      const normalized = Buffer.from(text.replace(/\r\n/g, "\n"), "utf-8");
      if (sha256(normalized) === hash) {
        bases.set(hash, normalized);
        problems.push({ origin: "files", kind: "hash-mismatch", hash, detail: "conteúdo recuperado (\\r\\n → \\n)", recovered: true });
        continue;
      }
    }
    problems.push({ origin: "files", kind: "hash-mismatch", hash, detail: "sha256 do conteúdo não confere com o nome do arquivo" });
  }
  return { bases, problems };
}

/** Leitura pura. Nunca lança por conteúdo de estado (só por erro de I/O inesperado). */
export async function inspectState(targetDir: string): Promise<StateSnapshot> {
  const manifestPath = join(targetDir, MANIFEST_FILE);
  const lockfilePath = join(targetDir, LOCKFILE);
  const hasManifestJson = existsSync(manifestPath);
  const hasLockfile = existsSync(lockfilePath);
  const basesDirEntries = await listBaseDirEntries(targetDir);
  const pendingTransactions = await hasPendingTransactions(targetDir);

  const empty = {
    targetDir, hasManifestJson, hasLockfile, basesDirEntries, pendingTransactions,
    bases: new Map<string, Buffer>(), baseOrigins: new Map<string, ("pack" | "files")[]>(),
    problems: [] as BaseProblem[], looseFileBases: [] as string[],
    conflictMarkersInBases: 0, crlfSuspected: false,
  };

  if (hasManifestJson && hasLockfile) {
    return { ...empty, error: toStateError("coexistence", targetDir) };
  }

  if (hasLockfile) {
    let raw: Buffer;
    try {
      raw = await readFile(lockfilePath);
    } catch {
      return { ...empty, error: toStateError("unreadable", targetDir, "lockfile") };
    }
    let parsed;
    try {
      parsed = parseLockfile(raw);
    } catch (error) {
      if (error instanceof LockfileError) {
        return { ...empty, error: toStateError(lockfileKindToStateKind(error.kind), targetDir, "lockfile", error) };
      }
      throw error;
    }
    const { bases: filesBases, problems: filesProblems } = await verifyFilesBases(targetDir, basesDirEntries);
    const baseOrigins = new Map<string, ("pack" | "files")[]>();
    for (const hash of parsed.bases.keys()) baseOrigins.set(hash, [...(baseOrigins.get(hash) ?? []), "pack"]);
    for (const hash of filesBases.keys()) baseOrigins.set(hash, [...(baseOrigins.get(hash) ?? []), "files"]);
    const bases = new Map(parsed.bases);
    for (const [hash, content] of filesBases) if (!bases.has(hash)) bases.set(hash, content);
    return {
      ...empty,
      manifest: parsed.manifest,
      inUse: "pack",
      recorded: parsed.manifest.basesFormat,
      bases,
      baseOrigins,
      problems: [...parsed.problems, ...filesProblems],
      looseFileBases: basesDirEntries,
      conflictMarkersInBases: parsed.conflictMarkers,
      crlfSuspected: parsed.crlf,
    };
  }

  if (hasManifestJson) {
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as Manifest;
    } catch {
      return { ...empty, error: toStateError("unreadable", targetDir, "manifest") };
    }
    const { bases, problems } = await verifyFilesBases(targetDir, basesDirEntries);
    const baseOrigins = new Map<string, ("pack" | "files")[]>();
    for (const hash of bases.keys()) baseOrigins.set(hash, ["files"]);
    return {
      ...empty,
      manifest,
      inUse: "files",
      recorded: manifest.basesFormat,
      bases,
      baseOrigins,
      problems,
      looseFileBases: [],
      conflictMarkersInBases: 0,
      crlfSuspected: false,
    };
  }

  return empty;
}

/**
 * mutate  → adquire o lock, recupera transações pendentes (recoverBeforeRead) e só então lê.
 * dry-run → assertNoPendingTransactions (erro atual) e lê.
 * read    → lê sem recuperar.
 */
export async function openState(targetDir: string, opts: { mode: OpenMode }): Promise<InstallState | null> {
  if (opts.mode === "mutate") await recoverBeforeRead(targetDir);
  else if (opts.mode === "dry-run") await assertNoPendingTransactions(targetDir);

  const snapshot = await inspectState(targetDir);
  if (snapshot.error) throw snapshot.error;
  if (!snapshot.manifest || !snapshot.inUse) return null;

  const manifest = structuredClone(snapshot.manifest);
  const bases = snapshot.bases;
  return {
    targetDir,
    manifest,
    inUse: snapshot.inUse,
    recorded: snapshot.recorded,
    bases,
    problems: snapshot.problems,
    looseFileBases: snapshot.looseFileBases,
    readBase: (hash: string) => bases.get(hash) ?? null,
    hasBase: (hash: string) => bases.has(hash),
  };
}

/** Fachada: (await openState(t, { mode: "read" }))?.manifest ?? null. */
export async function readManifest(targetDir: string): Promise<Manifest | null> {
  const state = await openState(targetDir, { mode: "read" });
  return state?.manifest ?? null;
}

/** União de bases válidas (helper para chamadores). */
export function withBases(...maps: ReadonlyMap<string, Buffer>[]): Map<string, Buffer> {
  const merged = new Map<string, Buffer>();
  for (const map of maps) for (const [hash, content] of map) merged.set(hash, content);
  return merged;
}

function stripState(manifest: Manifest): Manifest {
  if (!manifest.config) return manifest;
  const { state: _state, ...rest } = manifest.config;
  return { ...manifest, config: rest };
}

/** Entradas de `.maker/bases` (hash-shaped) e demais entradas presentes hoje no disco. */
async function readBaseDir(targetDir: string): Promise<{ hashNamed: string[]; other: string[]; exists: boolean }> {
  try {
    const entries = await readdir(join(targetDir, BASES_DIR), { withFileTypes: true });
    const hashNamed = entries.filter((entry) => entry.isFile() && isBaseName(entry.name)).map((entry) => entry.name);
    const other = entries.filter((entry) => !(entry.isFile() && isBaseName(entry.name))).map((entry) => entry.name);
    return { hashNamed, other, exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hashNamed: [], other: [], exists: false };
    throw error;
  }
}

/** Remove `.maker/bases` inteiro (1 change) quando só contém nomes de hash fora de `keep`; senão, só os arquivos. */
async function planBasesRemoval(targetDir: string, keep: ReadonlySet<string>): Promise<PlannedChange[]> {
  const { hashNamed, other, exists } = await readBaseDir(targetDir);
  if (!exists) return [];
  const toRemove = hashNamed.filter((hash) => !keep.has(hash));
  if (!toRemove.length) return [];
  if (!other.length && toRemove.length === hashNamed.length && keep.size === 0) {
    const inspected = await inspectTarget(targetDir, BASES_DIR);
    return [{ path: BASES_DIR, action: "remove", source: "metadata", reason: "armazenamento de bases por arquivo removido",
      expectedHash: inspected.hash, expectedKind: inspected.kind }];
  }
  const changes: PlannedChange[] = [];
  for (const hash of toRemove) {
    const path = basePath(hash);
    const inspected = await inspectTarget(targetDir, path);
    changes.push({ path, action: "remove", source: "metadata", reason: "base não referenciada", expectedHash: inspected.hash, expectedKind: inspected.kind });
  }
  return changes;
}

/**
 * Planeja a escrita do estado no `format` pedido. Não escreve nada.
 */
export async function planStateWrite(
  state: InstallState | null,
  targetDir: string,
  next: { manifest: Manifest; format: BasesFormat; bases: ReadonlyMap<string, Buffer>; consolidate?: boolean; prune?: boolean },
): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = [];
  const manifest = stripState(next.manifest);
  const finalBases = next.prune ? new Map(next.bases) : withBases(state?.bases ?? new Map<string, Buffer>(), next.bases);

  const hasManifestJson = existsSync(join(targetDir, MANIFEST_FILE));
  const hasLockfile = existsSync(join(targetDir, LOCKFILE));

  if (next.format === "files") {
    for (const [hash, content] of finalBases) {
      changes.push(await planWrite({ targetDir, path: basePath(hash), content, source: "metadata", reason: "base upstream", force: true }));
    }
    if (next.prune) {
      changes.push(...await planBasesRemoval(targetDir, new Set(finalBases.keys())));
    }
    changes.push(await planWrite({
      targetDir, path: MANIFEST_FILE, content: `${JSON.stringify(manifest, null, 2)}\n`,
      source: "metadata", reason: "publicar manifest", force: true,
    }));
    if (next.consolidate && hasLockfile) {
      const inspected = await inspectTarget(targetDir, LOCKFILE);
      changes.push({ path: LOCKFILE, action: "remove", source: "metadata", reason: "consolidado no formato files",
        expectedHash: inspected.hash, expectedKind: inspected.kind });
    }
  } else {
    changes.push(await planWrite({
      targetDir, path: LOCKFILE, content: serializeLockfile(manifest, finalBases),
      source: "metadata", reason: "publicar estado (manifest + bases)", force: true,
    }));
    if (next.consolidate) {
      changes.push(...await planBasesRemoval(targetDir, new Set()));
      if (hasManifestJson) {
        const inspected = await inspectTarget(targetDir, MANIFEST_FILE);
        changes.push({ path: MANIFEST_FILE, action: "remove", source: "metadata", reason: "consolidado no formato pack",
          expectedHash: inspected.hash, expectedKind: inspected.kind });
      }
    }
  }

  return changes;
}
