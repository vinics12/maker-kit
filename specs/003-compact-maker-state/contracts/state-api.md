# Contrato — API da camada de estado (`src/state/`)

Dono: US-1. **Congelada** depois de US-1: US-2..US-6 só consomem. Mudança de assinatura = retorno ao
Gate 2. Tipos de dados em `data-model.md`.

> **Descongelada pela US-7** (emenda da Clarification 23, retorno ao Gate 2). As assinaturas que mudam
> estão na seção "Emenda US-7" no fim; o resto deste contrato continua valendo.

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

---

## Emenda US-7 — estado de add-ons (Clarification 23)

Arquivos descongelados: `src/state/{paths,lockfile,store,diagnose}.ts`, `src/state/addon-state.ts`
(novo) e `test/helpers/state.ts`. **`src/state/format.ts` não muda.** Toda assinatura abaixo marcada
como *nova* ou *muda* é o contrato; o que não aparece aqui continua como acima.

### `src/state/paths.ts`

```ts
export const ADDONS_DIR = ".maker/addons";                                    // nova
export function addonStateFile(id: string): string;                           // nova: `${ADDONS_DIR}/${id}.json`
export function isAddonStateFile(path: string): boolean;                      // nova: /^\.maker\/addons\/[^/]+\.json$/
/** muda: também reconhece o diretório ADDONS_DIR (removido na migração files → pack depois do lockfile criado). */
export function isStateMetadata(path: string): boolean;
```

### `src/state/addon-state.ts` (novo, sem I/O)

```ts
export const addonStateSchema: z.ZodObject<…>;      // movido de src/addons/state.ts, idêntico ao da 1.0.0
export type AddonState = z.infer<typeof addonStateSchema>;
export type AddonStateRecord = AddonState & Record<string, unknown>;
export const ADDON_STATE_FIELDS: readonly ["id", "version", "appliedAt", "knobs", "createdFiles", "injectedTargets", "injectedBlocks"];
export function isAddonId(id: string): boolean;                               // /^[a-z0-9-]+$/
export function parseAddonStateRecord(raw: unknown): AddonStateRecord;        // addonStateSchema.passthrough().parse
/** null = cabe numa unidade do lockfile; senão o motivo (chave de topo fora de [A-Za-z][A-Za-z0-9]*). */
export function isLockfileSerializable(record: AddonStateRecord): string | null;
/** JSON como o maker grava hoje: ordem de topo ADDON_STATE_FIELDS + extras; createdFiles {path, hash}; 2 espaços + "\n". */
export function addonStateJson(record: AddonStateRecord): string;
```

### `src/state/lockfile.ts`

```ts
// muda (3º parâmetro opcional; omitido = seção [addons] vazia — as 41 chamadas existentes compilam)
export function serializeLockfile(manifest: Manifest, bases: ReadonlyMap<string, Buffer>, addons?: ReadonlyMap<string, AddonStateRecord>): Buffer;
// muda: ParsedLockfile.addons: Map<string, AddonStateRecord>; LockfileError.kind += "addons-invalid" | "addons-conflict"
```

### `src/state/store.ts`

```ts
// muda
export type StateErrorKind = "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict"
  | "addon-coexistence" | "addons-invalid" | "addons-conflict" | "addon-state-invalid" | "addons-dir-invalid";
// muda: StateSnapshot += addons, addonProblems, unmigratableAddons, orphanAddonStateFiles, addonStateFiles, addonsDir, addonsDirIssue? (data-model §4)
// muda: InstallState += addons: ReadonlyMap<string, AddonStateRecord>, addonProblems: readonly AddonStateProblem[]

/**
 * inspectState (muda):
 * - lockfile + manifest.json → coexistence (precedência); lockfile + ≥1 .maker/addons/*.json regular → addon-coexistence;
 * - pack: addons = ParsedLockfile.addons; .maker/addons sem *.json (ou não-diretório) é ignorado;
 * - files: addons = cada .maker/addons/<id>.json válido (chave = nome do arquivo); inválidos (JSON,
 *   schema, id fora de isAddonId) → addonProblems; válidos com `id` ≠ nome ou chave fora da gramática
 *   → entram em addons E em unmigratableAddons; diretório não-diretório/ilegível → addonsDirIssue.
 * - sem install (nem manifest.json nem lockfile): addons vazio; ids de .maker/addons/*.json regulares →
 *   orphanAddonStateFiles (nunca "aplicados").
 */
export function inspectState(targetDir: string): Promise<StateSnapshot>;

/**
 * planStateWrite (muda: next.addons?)
 * - addons omitido → state?.addons ?? vazio (init/agent add/update sem mudança de add-on carregam intacto).
 * - state === null (install novo) com qualquer .maker/addons/*.json regular no disco → StateError
 *   ("addon-coexistence", variante órfã) antes de planejar, em qualquer formato.
 * - format "pack": addons vão para [addons] do lockfile. Lança StateError("addon-state-invalid") ANTES de
 *   planejar se state.inUse === "files" e há addonProblems/unmigratableAddons, ou se algum registro
 *   de addons tem id ≠ chave ou falha isLockfileSerializable.
 *   consolidate=true: remove .maker/addons/<id>.json de cada id em state.addons (um único `remove` do
 *   diretório quando ele só contém esses arquivos); diretório vazio → `remove` do diretório; conteúdo
 *   alheio fica.
 * - format "files" (ou pack → files): se há JSON a escrever e ADDONS_DIR existe sem ser diretório →
 *   StateError("addons-dir-invalid") no planejamento. Para cada id em addons, planWrite(addonStateFile(id), addonStateJson(r), force) só
 *   quando r difere (canonicalJson) de state.addons.get(id) ou o formato de origem não é files; remove
 *   addonStateFile(id) para ids de state.addons (em files) ausentes de addons; nunca toca ids de
 *   addonProblems. consolidate=true com lockfile → remove o lockfile (como hoje).
 */
export function planStateWrite(state: InstallState | null, targetDir: string, next: {
  manifest: Manifest; format: BasesFormat; bases: ReadonlyMap<string, Buffer>;
  addons?: ReadonlyMap<string, AddonStateRecord>;
  consolidate?: boolean; prune?: boolean; preserve?: ReadonlySet<string>;
}): Promise<PlannedChange[]>;
```

Mensagens/ações dos kinds novos: `cli-output.md` §3.

### `src/state/diagnose.ts`

`diagnoseState` mapeia `snapshot.error.kind` `addon-coexistence` | `addons-invalid` | `addons-conflict`
para achados `fail` com o mesmo `code` (`cli-output.md` §2), e emite `addon-state-invalid` (**warn**)
quando `inUse === "files"`, o formato efetivo (`effectiveBasesFormat(configured, recorded, inUse)`) é
`"pack"` e há `addonProblems` ou `unmigratableAddons` (um achado por arquivo). Diretório `.maker/addons` sem `*.json` em
pack não gera achado.

### Fora de `src/state/` (consumidores; assinaturas que mudam)

```ts
// src/addons/state.ts — fachada
export { addonStateSchema, type AddonState } from "../state/addon-state.js";
export function readAddonState(targetDir: string, id: string): Promise<AddonState | null>;  // via openState("read"); StateError propaga; id em addonProblems → lança Error(detail)
export function isAddonApplied(targetDir: string, id: string): Promise<boolean>;             // muda: era síncrona; via inspectState, false em erro (só para log)
// removidas: writeAddonState, deleteAddonState, addonStatePath

// src/addons/doctor.ts
export function inspectAddons(targetDir: string, state: Pick<InstallState, "manifest" | "addons" | "addonProblems" | "hasBase">): Promise<AddonDoctorSummary>;  // muda

// src/agents/migrate.ts
export function planLegacyAddonAgents(targetDir, staging, expected, manifest, options: { …; addons: ReadonlyMap<string, AddonStateRecord> })
  : Promise<{ changes; handled; reports; bases; addons: Map<string, AddonStateRecord> }>;  // muda: sem planWrite de JSON; devolve o mapa atualizado
```

`applyAddon`, `removeAddon`, `runAdd`, `runRemove`, `runList`, `runDoctor`, `applyResolutions` mantêm as
assinaturas; mudam só por dentro.

### `test/helpers/state.ts` (muda)

```ts
export function readAddonStates(target: string): Promise<Map<string, AddonStateRecord>>;       // nova: formato-agnóstico (inspectState)
export function writeAddonState(target: string, state: AddonStateRecord): Promise<void>;      // nova: transacional, formato em uso (planStateWrite addons)
export function removeAddonState(target: string, id: string): Promise<void>;                  // nova: transacional
/** nova: grava cru .maker/addons/<id>.json (fixture de coexistência/JSON inválido; fora da transação de propósito). */
export function writeAddonStateFile(target: string, id: string, content: string | AddonStateRecord): Promise<void>;
// initInstall/toLegacyFiles: mesma assinatura; passam a levar os add-ons junto na conversão de formato (default de planStateWrite)
```

### `test/helpers/legacy-binary.ts` (novo, S7)

```ts
/**
 * Extrai `git archive v1.0.0 dist addons templates package.json` para um mkdtemp em
 * <repo>/node_modules/.cache/ (as deps de runtime do bundle resolvem pelo node_modules do repo) e devolve
 * o caminho do cli.js, ou { skip: motivo } sem git, sem a tag ou com `dependencies` da tag ≠ atuais.
 */
export function legacyCli(): Promise<{ cli: string; cleanup(): Promise<void> } | { skip: string }>;
/** execFileSync(process.execPath, [cli, ...args]) sem lançar: { code, stdout, stderr }. */
export function runLegacy(cli: string, args: string[]): { code: number; stdout: string; stderr: string };
```

### `test/helpers/addons.ts` (novo)

```ts
export const SYNTHETIC_ADDONS_ROOT: string;   // fixtures/addons-synthetic
/** Para `vi.mock("../../src/addons/loader.js", mockLoaderWithSynthetic)`: addonDir/listAddonCatalog/loadAddon enxergam a raiz sintética além da real. */
export function mockLoaderWithSynthetic(importOriginal: () => Promise<typeof import("../../src/addons/loader.js")>): Promise<typeof import("../../src/addons/loader.js")>;
```
