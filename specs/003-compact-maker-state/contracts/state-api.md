# Contrato — API da camada de estado (`src/state/`)

Dono: US-1. **Congelada** depois de US-1: US-2..US-6 só consomem. Mudança de assinatura = retorno ao
Gate 2. Tipos de dados em `data-model.md`.

## `src/state/paths.ts` (sem imports)

```ts
export const MANIFEST_FILE = ".maker/manifest.json";
export const LOCKFILE = ".maker/maker.lock";
export const BASES_DIR = ".maker/bases";
export const GIT_CONTROL_FILES: readonly string[] = [".maker/.gitattributes", ".maker/.gitignore"];
export function basePath(hash: string): string;            // `${BASES_DIR}/${hash}`
export function isBaseName(name: string): boolean;         // /^[a-f0-9]{64}$/
/**
 * manifest.json, maker.lock e .maker/addons/<id>.json: aplicados por último na transação e, entre eles,
 * create/update antes de remove (crash no meio de uma migração deixa coexistência, nunca "sem estado").
 */
export function isStateMetadata(path: string): boolean;
```

## `src/state/lockfile.ts` (puro, sem I/O)

```ts
export const LOCKFILE_VERSION = 1;
export function canonicalJson(value: unknown): string;
export function serializeLockfile(manifest: Manifest, bases: ReadonlyMap<string, Buffer>): Buffer;
export function parseLockfile(raw: Buffer): ParsedLockfile;   // lança LockfileError
export class LockfileError extends Error { readonly kind; readonly line?: number }
```
Detalhes em `lockfile-format.md`.

## `src/state/store.ts`

```ts
export type BasesFormat = "files" | "pack";
export type OpenMode = "mutate" | "dry-run" | "read";
export class StateError extends Error { readonly kind: StateErrorKind; readonly action: string; readonly path: string }

/** Leitura pura. Nunca lança por conteúdo de estado (só por erro de I/O inesperado). */
export function inspectState(targetDir: string): Promise<StateSnapshot>;

/**
 * mutate  → adquire o lock, recupera transações pendentes (recoverBeforeRead) e só então lê.
 * dry-run → assertNoPendingTransactions (erro atual) e lê.
 * read    → lê sem recuperar.
 * null quando não há manifest.json nem lockfile. Lança StateError em coexistence/unreadable/
 * unknown-version/manifest-invalid/manifest-conflict — nunca devolve null nesses casos.
 */
export function openState(targetDir: string, opts: { mode: OpenMode }): Promise<InstallState | null>;

/** Fachada: (await openState(t, { mode: "read" }))?.manifest ?? null. */
export function readManifest(targetDir: string): Promise<Manifest | null>;

/**
 * Planeja a escrita do estado no `format` pedido. Não escreve nada.
 * - bases: bases que o resultado deve conter além das mantidas.
 * - prune=false: mantém todas as bases válidas já presentes (pack: carrega-as no lockfile;
 *   files: não remove nenhum arquivo). prune=true: o resultado contém exatamente `bases` ∪
 *   `preserve` (files: remove arquivos com nome de hash fora desse conjunto).
 * - preserve (opcional): hashes ainda referenciados pelo manifest cujo arquivo não verifica
 *   (corrompido) — nunca são podados; diagnóstico é do doctor. Só afeta o formato files: em pack,
 *   entradas que não verificam não são reescritas no lockfile (cli-output §1).
 * - consolidate=true: remove o armazenamento do outro formato (pack → manifest.json e bases/;
 *   files → lockfile). consolidate=false com format ≠ state.inUse é erro de programação.
 * - Sempre: manifest.config sem `state`; base files gravadas com force (conteúdo endereçado);
 *   lockfile/manifest via planWrite(force: true) → "preserve" quando idêntico (idempotência).
 * - `.maker/bases` é removido com um único `remove` de diretório quando só contém nomes de hash;
 *   senão, removem-se só os arquivos de base.
 */
export function planStateWrite(
  state: InstallState | null,
  targetDir: string,
  next: { manifest: Manifest; format: BasesFormat; bases: ReadonlyMap<string, Buffer>; consolidate?: boolean; prune?: boolean; preserve?: ReadonlySet<string> },
): Promise<PlannedChange[]>;

/** União de bases válidas (helper para chamadores). */
export function withBases(...maps: ReadonlyMap<string, Buffer>[]): Map<string, Buffer>;
```

Ações (`StateError.action`) — texto exato em `cli-output.md` §3.

## `src/state/format.ts`

```ts
/**
 * init: passa a config carregada; update/doctor: lê maker.config.json do alvo e valida só `state`.
 * - arquivo ausente ou sem `state.bases` → { kind: "unset" }
 * - `state.bases` válido → { kind: "set", format }
 * - JSON válido com `state.bases` fora do enum → lança o ZodError de validação (FR-003) —
 *   o doctor usa `inspect: true` e recebe { kind: "invalid", message } em vez de lançar
 * - JSON malformado → { kind: "unreadable", message } (nunca lança): o chamador resolve sem migrar
 */
export function configuredBasesFormat(targetDir: string, opts?: { loaded?: { state?: { bases?: BasesFormat } }; inspect?: boolean }): Promise<ConfiguredFormat>;
export type ConfiguredFormat = { kind: "unset" } | { kind: "set"; format: BasesFormat } | { kind: "invalid"; message: string } | { kind: "unreadable"; message: string };
/** unreadable → recorded ?? inUse com reason "unreadable-config" (nunca migra por default). */
export function effectiveBasesFormat(configured: ConfiguredFormat, recorded: BasesFormat | undefined, inUse: BasesFormat | undefined):
  { format: BasesFormat; reason: "config" | "manifest" | "default" | "unreadable-config" };
/** null quando inUse === effective e não há bases soltas a consolidar. */
export function planFormatTransition(state: InstallState, effective: { format: BasesFormat; reason: … }, referenced?: ReadonlySet<string>): FormatTransition | null;
/** files em uso, nada registrado, nada configurado → o próximo update migra (FR-025). */
export function pendingDefaultMigration(state: Pick<InstallState, "inUse" | "recorded">, configured: ConfiguredFormat): boolean;
```

## `src/changes/transaction.ts` (acréscimos)

```ts
export function applyChangePlan(plan: ChangePlan, options?: { failAfter?: number; crashAfter?: number }): Promise<void>;
/** crashAfter: depois da operação i, sai lançando sem rollback, deixando journal e um lock com pid "0" (inativo) — simula processo morto. Só para testes. */
export function recoverBeforeRead(targetDir: string): Promise<void>;   // lock → recoverPendingTransactions → libera
export function hasPendingTransactions(targetDir: string): Promise<boolean>;
```
`isMetadata` passa a ser `isStateMetadata` de `paths.ts`.

## `src/config/schema.ts` (acréscimo)

```ts
state: z.object({
  bases: z.enum(["files", "pack"], { error: 'state.bases deve ser "files" ou "pack"' }).optional(),
}).optional()
```
Sem `.default()`/`.prefault()`. `parseConfig({ project })` → `state === undefined`.

## `test/helpers/state.ts` (US-1, congelado)

```ts
export { readManifest } from "../../src/state/store.js";
export function writeManifest(target: string, manifest: Manifest): Promise<void>;          // transacional, formato em uso, prune=false
export function putBase(target: string, content: Buffer | string): Promise<string>;     // grava base no formato em uso; devolve hash
export function corruptBase(target: string, hash: string, mutate?: (b: Buffer) => Buffer): Promise<void>; // nos dois formatos
export function removeBase(target: string, hash: string): Promise<void>;
export function lockfileText(target: string): Promise<string>;
export function snapshotTree(dir: string): Promise<Map<string, string>>;                 // path → sha256, inclui .maker
/**
 * Produz o formato pedido SEM depender do default do `init` (US-3 roda em paralelo com a US-2, que troca
 * o default): roda `runInit` e, em seguida, converte o estado via `planStateWrite({ consolidate: true })`
 * + `applyChangePlan` para o formato pedido, gravando `basesFormat` = format. `"unset"` = formato files
 * sem `basesFormat` e sem `state.bases` na config (install "não migrado").
 */
export function initInstall(prefix: string, opts?: { format?: BasesFormat | "unset"; agents?: AgentProvider[]; addon?: string }): Promise<string>;
export function toLegacyFiles(target: string): Promise<void>;                            // converte para files sem basesFormat ("não migrado")
export function hasGit(): boolean;
```
