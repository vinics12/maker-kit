import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { assertNoPendingTransactions, hasPendingTransactions, recoverBeforeRead } from "../changes/transaction.js";
import { sha256, type BasesFormat, type Manifest } from "../render/manifest.js";
import { ADDONS_DIR, BASES_DIR, LOCKFILE, MANIFEST_FILE, addonStateFile, basePath, isBaseName } from "./paths.js";
import { LockfileError, canonicalJson, parseLockfile, serializeLockfile, type BaseProblem } from "./lockfile.js";
import {
  isLockfileSerializable,
  parseAddonStateRecord,
  addonStateJson,
  type AddonStateRecord,
} from "./addon-state.js";

export type { BasesFormat };
export type OpenMode = "mutate" | "dry-run" | "read";

export type StateErrorKind =
  | "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict"
  | "addon-coexistence" | "addons-invalid" | "addons-conflict" | "addon-state-invalid" | "addons-dir-invalid";

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

export interface AddonStateProblem {
  id: string;
  path: string;
  detail: string;
}

export type AddonsDirState = "absent" | "empty" | "entries" | "not-directory" | "unreadable";

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
  addons: Map<string, AddonStateRecord>;
  orphanAddonStateFiles: string[];
  unmigratableAddons: AddonStateProblem[];
  addonProblems: AddonStateProblem[];
  addonStateFiles: string[];
  addonsDir: AddonsDirState;
  addonsDirIssue?: string;
}

export interface InstallState {
  targetDir: string;
  manifest: Manifest;
  inUse: BasesFormat;
  recorded?: BasesFormat;
  bases: ReadonlyMap<string, Buffer>;
  problems: readonly BaseProblem[];
  looseFileBases: readonly string[];
  addons: ReadonlyMap<string, AddonStateRecord>;
  addonProblems: readonly AddonStateProblem[];
  readBase(hash: string): Buffer | null;
  hasBase(hash: string): boolean;
}

function stateErrorAction(kind: "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict", subject: "manifest" | "lockfile"): string {
  switch (kind) {
    case "coexistence": return "escolha um estado e remova o outro, ou restaure .maker do histórico do git";
    case "unreadable": return subject === "manifest" ? "restaure .maker/manifest.json do histórico do git" : "restaure .maker/maker.lock do histórico do git";
    case "unknown-version": return "atualize o maker";
    case "manifest-invalid": return "restaure .maker/maker.lock do histórico do git";
    case "manifest-conflict": return "resolva o conflito ou restaure .maker/maker.lock do histórico do git";
  }
}

/** `LockfileError("unknown-version", "versão de lockfile desconhecida: N")`: extrai o N para a mensagem do contrato. */
function unknownVersionNumber(lockfileError?: LockfileError): string {
  return lockfileError?.message.match(/desconhecida: (\d+)/)?.[1] ?? "desconhecida";
}

function stateErrorMessage(kind: "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict", subject: "manifest" | "lockfile", lockfileError?: LockfileError): string {
  switch (kind) {
    case "coexistence":
      return `.maker/manifest.json e .maker/maker.lock coexistem; nenhuma alteração foi feita.`;
    case "unreadable":
      return subject === "manifest"
        ? `.maker/manifest.json ilegível; nenhuma alteração foi feita.`
        : `.maker/maker.lock ilegível; nenhuma alteração foi feita.`;
    case "unknown-version":
      return `.maker/maker.lock usa um formato mais novo (versão ${unknownVersionNumber(lockfileError)}) que este maker entende (1); nenhuma alteração foi feita.`;
    case "manifest-invalid":
      return `seção de manifest de .maker/maker.lock inválida (linha ${lockfileError?.line}: ${lockfileError?.message}); nenhuma alteração foi feita.`;
    case "manifest-conflict":
      return `.maker/maker.lock contém marcadores de conflito do git na seção de manifest (linha ${lockfileError?.line}); nenhuma alteração foi feita.`;
  }
}

function toStateError(
  kind: "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict",
  targetDir: string,
  subject: "manifest" | "lockfile" = "lockfile",
  lockfileError?: LockfileError,
): StateError {
  const action = stateErrorAction(kind, subject);
  const path = subject === "manifest" ? join(targetDir, MANIFEST_FILE) : join(targetDir, LOCKFILE);
  return new StateError(kind, `${stateErrorMessage(kind, subject, lockfileError)} Ação: ${action}.`, action, path);
}

function addonCoexistenceError(targetDir: string, ids: readonly string[], orphan: boolean): StateError {
  const idsList = ids.join(", ");
  if (orphan) {
    const action = "remova .maker/addons/ ou restaure .maker do histórico do git";
    return new StateError(
      "addon-coexistence",
      `.maker/addons/<id>.json existe(m) sem install do maker (${idsList}); nenhuma alteração foi feita. Ação: ${action}.`,
      action, join(targetDir, ADDONS_DIR),
    );
  }
  const action = "escolha um estado e remova o outro, ou restaure .maker do histórico do git";
  return new StateError(
    "addon-coexistence",
    `.maker/addons/<id>.json e .maker/maker.lock coexistem (${idsList}); nenhuma alteração foi feita. Ação: ${action}.`,
    action, join(targetDir, ADDONS_DIR),
  );
}

function addonsInvalidError(targetDir: string, lockfileError: LockfileError): StateError {
  const action = "restaure .maker/maker.lock do histórico do git";
  return new StateError(
    "addons-invalid",
    `seção de add-ons de .maker/maker.lock inválida (linha ${lockfileError.line}: ${lockfileError.message}); nenhuma alteração foi feita. Ação: ${action}.`,
    action, join(targetDir, LOCKFILE),
  );
}

function addonsConflictError(targetDir: string, lockfileError: LockfileError): StateError {
  const action = "resolva o conflito ou restaure .maker/maker.lock do histórico do git";
  return new StateError(
    "addons-conflict",
    `.maker/maker.lock contém marcadores de conflito do git na seção de add-ons (linha ${lockfileError.line}); nenhuma alteração foi feita. Ação: ${action}.`,
    action, join(targetDir, LOCKFILE),
  );
}

function addonStateInvalidError(targetDir: string, id: string, motivo: string): StateError {
  const action = 'corrija ou restaure o arquivo do histórico do git, ou declare "state": { "bases": "files" } em maker.config.json';
  return new StateError(
    "addon-state-invalid",
    `estado de add-on não migrável em .maker/addons/${id}.json (${motivo}); a migração para "pack" não foi feita e nenhuma alteração foi feita. Ação: ${action}.`,
    action, join(targetDir, addonStateFile(id)),
  );
}

function addonsDirInvalidError(targetDir: string): StateError {
  const action = "remova ou renomeie .maker/addons e rode o comando de novo";
  return new StateError(
    "addons-dir-invalid",
    `.maker/addons existe e não é um diretório; nenhuma alteração foi feita. Ação: ${action}.`,
    action, join(targetDir, ADDONS_DIR),
  );
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

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Estado de `.maker/addons` no disco: ausente, vazio, com entradas `<id>.json`, não-diretório ou ilegível. */
async function readAddonsDir(targetDir: string): Promise<{ jsonIds: string[]; state: AddonsDirState; issue?: string }> {
  const dir = join(targetDir, ADDONS_DIR);
  let stat;
  try {
    stat = await lstat(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { jsonIds: [], state: "absent" };
    return { jsonIds: [], state: "unreadable", issue: `não foi possível inspecionar ${ADDONS_DIR}: ${errorDetail(error)}` };
  }
  if (!stat.isDirectory()) return { jsonIds: [], state: "not-directory", issue: `${ADDONS_DIR} deveria ser um diretório` };
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return { jsonIds: [], state: "unreadable", issue: `não foi possível ler ${ADDONS_DIR}: ${errorDetail(error)}` };
  }
  if (!entries.length) return { jsonIds: [], state: "empty" };
  const jsonIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .sort();
  return { jsonIds, state: jsonIds.length ? "entries" : "empty" };
}

/** Lê e valida cada `.maker/addons/<id>.json`: inválidos viram `addonProblems`; válidos, mas não
 * serializáveis no lockfile (id ≠ nome do arquivo, campo fora da gramática) entram em `addons` E
 * `unmigratableAddons`. */
async function readFilesAddons(
  targetDir: string,
  ids: readonly string[],
): Promise<{ addons: Map<string, AddonStateRecord>; problems: AddonStateProblem[]; unmigratable: AddonStateProblem[] }> {
  const addons = new Map<string, AddonStateRecord>();
  const problems: AddonStateProblem[] = [];
  const unmigratable: AddonStateProblem[] = [];
  for (const id of ids) {
    const path = addonStateFile(id);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(targetDir, path), "utf-8"));
    } catch (error) {
      problems.push({ id, path, detail: `JSON inválido: ${errorDetail(error)}` });
      continue;
    }
    let record: AddonStateRecord;
    try {
      record = parseAddonStateRecord(raw);
    } catch (error) {
      problems.push({ id, path, detail: `schema: ${errorDetail(error)}` });
      continue;
    }
    if (record.id !== id) {
      unmigratable.push({ id, path, detail: `state declara id "${record.id}"` });
      addons.set(id, record);
      continue;
    }
    const reason = isLockfileSerializable(record);
    if (reason) {
      unmigratable.push({ id, path, detail: reason });
      addons.set(id, record);
      continue;
    }
    addons.set(id, record);
  }
  return { addons, problems, unmigratable };
}

/** Leitura pura. Nunca lança por conteúdo de estado (só por erro de I/O inesperado). */
export async function inspectState(targetDir: string): Promise<StateSnapshot> {
  const manifestPath = join(targetDir, MANIFEST_FILE);
  const lockfilePath = join(targetDir, LOCKFILE);
  const hasManifestJson = existsSync(manifestPath);
  const hasLockfile = existsSync(lockfilePath);
  const basesDirEntries = await listBaseDirEntries(targetDir);
  const addonsDirInfo = await readAddonsDir(targetDir);
  const pendingTransactions = await hasPendingTransactions(targetDir);

  const empty: StateSnapshot = {
    targetDir, hasManifestJson, hasLockfile, basesDirEntries, pendingTransactions,
    bases: new Map<string, Buffer>(), baseOrigins: new Map<string, ("pack" | "files")[]>(),
    problems: [] as BaseProblem[], looseFileBases: [] as string[],
    conflictMarkersInBases: 0, crlfSuspected: false,
    addons: new Map<string, AddonStateRecord>(),
    orphanAddonStateFiles: [],
    unmigratableAddons: [],
    addonProblems: [],
    addonStateFiles: addonsDirInfo.jsonIds,
    addonsDir: addonsDirInfo.state,
    addonsDirIssue: addonsDirInfo.issue,
  };

  if (hasManifestJson && hasLockfile) {
    return { ...empty, error: toStateError("coexistence", targetDir) };
  }

  if (hasLockfile) {
    if (addonsDirInfo.jsonIds.length) {
      return { ...empty, error: addonCoexistenceError(targetDir, addonsDirInfo.jsonIds, false) };
    }
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
        if (error.kind === "addons-invalid") return { ...empty, error: addonsInvalidError(targetDir, error) };
        if (error.kind === "addons-conflict") return { ...empty, error: addonsConflictError(targetDir, error) };
        return { ...empty, error: toStateError(error.kind, targetDir, "lockfile", error) };
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
      addons: parsed.addons,
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
    const { addons, problems: addonProblems, unmigratable } = await readFilesAddons(targetDir, addonsDirInfo.jsonIds);
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
      addons,
      addonProblems,
      unmigratableAddons: unmigratable,
    };
  }

  if (addonsDirInfo.jsonIds.length) {
    return { ...empty, orphanAddonStateFiles: addonsDirInfo.jsonIds };
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
    addons: snapshot.addons,
    addonProblems: snapshot.addonProblems,
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

async function readAddonsDirRaw(targetDir: string): Promise<{ names: string[]; exists: boolean }> {
  try {
    const entries = await readdir(join(targetDir, ADDONS_DIR));
    return { names: entries, exists: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: `.maker/addons` não é diretório — tolerado em pack (D11); nada a remover.
    if (code === "ENOENT" || code === "ENOTDIR") return { names: [], exists: false };
    throw error;
  }
}

/**
 * Remove `.maker/addons/<id>.json` de cada id em `ids` (estado que migrou para o lockfile); remove o
 * diretório inteiro (1 change) quando ele só contém esses arquivos, ou quando fica vazio; conteúdo
 * alheio nunca é apagado.
 */
async function planAddonsRemoval(targetDir: string, ids: ReadonlySet<string>): Promise<PlannedChange[]> {
  const { names, exists } = await readAddonsDirRaw(targetDir);
  if (!exists) return [];
  const knownFiles = new Set([...ids].map((id) => `${id}.json`));
  const foreign = names.filter((name) => !knownFiles.has(name));
  if (!foreign.length) {
    const inspected = await inspectTarget(targetDir, ADDONS_DIR);
    if (inspected.kind === "absent") return [];
    return [{ path: ADDONS_DIR, action: "remove", source: "metadata", reason: "estado de add-ons migrado para o lockfile",
      expectedHash: inspected.hash, expectedKind: inspected.kind }];
  }
  const changes: PlannedChange[] = [];
  for (const id of ids) {
    const path = addonStateFile(id);
    const inspected = await inspectTarget(targetDir, path);
    if (inspected.kind === "absent") continue;
    changes.push({ path, action: "remove", source: "metadata", reason: "estado de add-on migrado para o lockfile",
      expectedHash: inspected.hash, expectedKind: inspected.kind });
  }
  return changes;
}

async function addonsDirIsNotDirectory(targetDir: string): Promise<boolean> {
  try {
    const stat = await lstat(join(targetDir, ADDONS_DIR));
    return !stat.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Planeja a escrita do estado no `format` pedido. Não escreve nada.
 */
export async function planStateWrite(
  state: InstallState | null,
  targetDir: string,
  next: {
    manifest: Manifest;
    format: BasesFormat;
    bases: ReadonlyMap<string, Buffer>;
    addons?: ReadonlyMap<string, AddonStateRecord>;
    consolidate?: boolean;
    prune?: boolean;
    /**
     * Hashes que nunca são removidos por `prune`, mesmo sem conteúdo verificável em `bases` (ex.: uma
     * base ainda referenciada pelo manifest, mas corrompida no armazenamento — a poda some com bases
     * órfãs, não com achados de diagnóstico; quem decide isso é o `doctor`, não `planStateWrite`).
     */
    preserve?: ReadonlySet<string>;
  },
): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = [];
  const manifest = stripState(next.manifest);
  const finalBases = next.prune ? new Map(next.bases) : withBases(state?.bases ?? new Map<string, Buffer>(), next.bases);
  const addons = next.addons ?? state?.addons ?? new Map<string, AddonStateRecord>();

  if (!state) {
    const orphan = await readAddonsDir(targetDir);
    if (orphan.jsonIds.length) throw addonCoexistenceError(targetDir, orphan.jsonIds, true);
  }

  const hasManifestJson = existsSync(join(targetDir, MANIFEST_FILE));
  const hasLockfile = existsSync(join(targetDir, LOCKFILE));

  if (next.format === "pack") {
    if (state && state.addonProblems.length) {
      const problem = state.addonProblems[0]!;
      throw addonStateInvalidError(targetDir, problem.id, problem.detail);
    }
    for (const [key, record] of addons) {
      if (record.id !== key) throw addonStateInvalidError(targetDir, key, `state declara id "${record.id}"`);
      const reason = isLockfileSerializable(record);
      if (reason) throw addonStateInvalidError(targetDir, key, reason);
    }
  }

  if (next.format === "files") {
    for (const [hash, content] of finalBases) {
      changes.push(await planWrite({ targetDir, path: basePath(hash), content, source: "metadata", reason: "base upstream", force: true }));
    }
    if (next.prune) {
      const keep = new Set(finalBases.keys());
      for (const hash of next.preserve ?? []) keep.add(hash);
      changes.push(...await planBasesRemoval(targetDir, keep));
    }
    changes.push(await planWrite({
      targetDir, path: MANIFEST_FILE, content: `${JSON.stringify(manifest, null, 2)}\n`,
      source: "metadata", reason: "publicar manifest", force: true,
    }));

    const addonWrites: PlannedChange[] = [];
    for (const [id, record] of addons) {
      const priorRecord = state?.inUse === "files" ? state.addons.get(id) : undefined;
      if (!priorRecord || canonicalJson(priorRecord) !== canonicalJson(record)) {
        addonWrites.push(await planWrite({
          targetDir, path: addonStateFile(id), content: addonStateJson(record),
          source: "metadata", reason: "publicar estado do add-on", force: true,
        }));
      }
    }
    if (addonWrites.length && await addonsDirIsNotDirectory(targetDir)) {
      throw addonsDirInvalidError(targetDir);
    }
    changes.push(...addonWrites);
    if (state?.inUse === "files") {
      for (const id of state.addons.keys()) {
        if (addons.has(id)) continue;
        const path = addonStateFile(id);
        const inspected = await inspectTarget(targetDir, path);
        if (inspected.kind === "absent") continue;
        changes.push({ path, action: "remove", source: "metadata", reason: "add-on removido",
          expectedHash: inspected.hash, expectedKind: inspected.kind });
      }
    }

    if (next.consolidate && hasLockfile) {
      const inspected = await inspectTarget(targetDir, LOCKFILE);
      changes.push({ path: LOCKFILE, action: "remove", source: "metadata", reason: "consolidado no formato files",
        expectedHash: inspected.hash, expectedKind: inspected.kind });
    }
  } else {
    changes.push(await planWrite({
      targetDir, path: LOCKFILE, content: serializeLockfile(manifest, finalBases, addons),
      source: "metadata", reason: "publicar estado (manifest + bases)", force: true,
    }));
    if (next.consolidate) {
      changes.push(...await planBasesRemoval(targetDir, new Set()));
      const knownIds = state?.inUse === "files" ? new Set(state.addons.keys()) : new Set<string>();
      changes.push(...await planAddonsRemoval(targetDir, knownIds));
      if (hasManifestJson) {
        const inspected = await inspectTarget(targetDir, MANIFEST_FILE);
        changes.push({ path: MANIFEST_FILE, action: "remove", source: "metadata", reason: "consolidado no formato pack",
          expectedHash: inspected.hash, expectedKind: inspected.kind });
      }
    }
  }

  return changes;
}
