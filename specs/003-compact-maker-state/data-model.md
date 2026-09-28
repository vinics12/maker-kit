# Data Model — Estado compacto em `.maker`

Sem banco (Bases Técnicas). Todo o estado é arquivo no projeto-alvo. Tipos TypeScript são o contrato;
os nomes abaixo são os que o código usa.

## 1. Entidades

### BasesFormat
`type BasesFormat = "files" | "pack"` — valores exatos (PR6).

### Manifest (`src/render/manifest.ts`, estendido)

| Campo | Tipo | Notas |
|---|---|---|
| `schemaVersion` | `number?` | Continua `3` (campo novo é opcional; a 1.0.0 não valida versão). |
| `makerVersion` | `string` | Muda só quando a versão do maker muda. |
| `project` | `{ name; slug }` | |
| `config` | `MakerConfig?` | **Nunca** contém `state` quando gravado (normalizado por `planStateWrite`). |
| `agents` | `AgentProvider[]?` | |
| `installedAt` | `string` | Fixado no primeiro `init`; nunca reescrito. |
| `basesFormat` | `BasesFormat?` | **Novo.** Formato registrado. Só `init`/`update` gravam/alteram; os demais preservam como encontraram (ausente continua ausente). |
| `files` | `Record<string, ManifestEntry>` | Chave = caminho POSIX relativo. |

`ManifestEntry` inalterado: `{ hash; source; baseHash?; edited? }`.

Onde vive: `files` → `.maker/manifest.json` (JSON indentado, como hoje). `pack` → seção `[manifest]`
de `.maker/maker.lock`. Nunca nos dois.

### Base
Conteúdo exato de uma versão upstream, endereçado por `sha256(conteúdo)` (hex minúsculo, 64 chars).
Atributos: `hash`, `size` (bytes), `content: Buffer`. Uma base é **válida** somente se
`sha256(content) === hash` (e, no pack, `content.length === size`).

### Armazenamento de bases
- `files`: `.maker/bases/<hash>` — um arquivo por base, nome = hash.
- `pack`: blocos `@base … @end` na seção `[bases]` do lockfile, ordenados por hash (code unit).

### MakerConfig.state (`src/config/schema.ts`)
`state?: { bases?: BasesFormat }` — sem default. `undefined` ≠ `"files"`.

### Lockfile (`.maker/maker.lock`)
Cabeçalho `maker-lockfile 1` + comentários fixos + `[manifest]` + `[bases]`. Gramática em
`contracts/lockfile-format.md`.

### BaseProblem
```ts
interface BaseProblem {
  origin: "pack" | "files";
  kind: "hash-mismatch" | "size-mismatch" | "truncated" | "malformed";
  hash?: string;          // quando o cabeçalho/nome é legível
  detail: string;         // ex.: "tamanho declarado 1834, conteúdo 1840"
  line?: number;          // pack: linha do cabeçalho/da linha inválida
  recovered?: boolean;    // true: a variante \r\n→\n confere com o hash; a base está em `bases` (usável), mas o armazenamento está corrompido
}
```

### StateSnapshot (resultado de `inspectState`, leitura pura; nunca lança por conteúdo)
```ts
interface StateSnapshot {
  targetDir: string;
  hasManifestJson: boolean;
  hasLockfile: boolean;
  basesDirEntries: string[];            // nomes em .maker/bases (hash-shaped), ordenados
  pendingTransactions: boolean;
  error?: StateError;                   // coexistence | unreadable | unknown-version | manifest-invalid | manifest-conflict
  manifest?: Manifest;                  // presente sem error
  inUse?: BasesFormat;                  // pack se o lockfile é o estado; files se manifest.json
  recorded?: BasesFormat;               // manifest.basesFormat
  bases: Map<string, Buffer>;           // união verificada dos dois formatos
  baseOrigins: Map<string, ("pack" | "files")[]>;
  problems: BaseProblem[];
  looseFileBases: string[];             // hashes em .maker/bases quando inUse = "pack"
  conflictMarkersInBases: number;
  crlfSuspected: boolean;               // linhas estruturais do lockfile com \r
}
```

### InstallState (resultado de `openState`, para comandos)
```ts
interface InstallState {
  targetDir: string;
  manifest: Manifest;                   // cópia (structuredClone): o chamador pode mutar
  inUse: BasesFormat;
  recorded?: BasesFormat;
  bases: ReadonlyMap<string, Buffer>;   // união verificada
  problems: readonly BaseProblem[];
  looseFileBases: readonly string[];
  readBase(hash: string): Buffer | null;
  hasBase(hash: string): boolean;
}
```

### FormatTransition (`planFormatTransition`)
```ts
interface FormatTransition {
  from: BasesFormat;                    // inUse
  to: BasesFormat;                      // efetivo
  reason: "config" | "manifest" | "default" | "unreadable-config";   // unreadable-config só consolida bases soltas, nunca troca de formato
  migrated: number;                     // bases válidas levadas ao formato de destino vindas do outro formato
  discarded: BaseProblem[];             // não migram; passam a contar como ausentes
  affected: Record<string, string[]>;   // hash descartado → arquivos do manifest que o referenciam
  consolidatesLoose: boolean;           // pack + bases soltas por arquivo
}
```

### StateError
```ts
type StateErrorKind = "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict";
class StateError extends Error { kind: StateErrorKind; action: string; path: string }
```

### DoctorFinding (`src/state/diagnose.ts`, US-3)
```ts
interface DoctorFinding {
  severity: "fail" | "warn" | "info";
  code: "pending-transaction" | "coexistence" | "unreadable" | "unknown-version" | "manifest-invalid"
      | "manifest-conflict" | "base-missing" | "base-corrupt" | "entry-truncated" | "entry-malformed"
      | "orphan-bases" | "loose-file-bases" | "bases-conflict-markers" | "pending-default-migration"
      | "config-invalid" | "config-unreadable";
  message: string;
  action: string;
  hash?: string;
  files?: string[];
}
```

## 2. Estados do install e transições

| Estado | Arquivos presentes | `inUse` | Mutantes | doctor |
|---|---|---|---|---|
| **files registrado** | `manifest.json` (`basesFormat: "files"`) + `bases/` | files | operam; `update` não migra | verde |
| **files não migrado** | `manifest.json` sem `basesFormat` + `bases/`, config sem `state.bases` | files | `update`/`init` migram para pack; `add`/`remove`/`agent add` não migram | **info** "próximo update migra" |
| **files não migrado com opt-out** | idem + config `"files"` | files | `update` registra `"files"`, não migra | verde, sem info (AC-35) |
| **pack** | `maker.lock` | pack | operam no lockfile | verde |
| **pack + bases soltas** | `maker.lock` + `bases/` | pack | `update` consolida (união verificada) | **warn** |
| **coexistência** | `manifest.json` + `maker.lock` | — | **abortam** antes de escrever | **fail** |
| **lockfile ilegível / versão desconhecida / manifest inválido ou em conflito** | `maker.lock` | — | **abortam** antes de escrever; nunca "sem install" | **fail** |
| **transação pendente** | `.maker/transactions/<id>/journal.json` | — | recuperam antes de ler | **fail** com ação "rode um comando mutante" — checada **antes** de "sem install" |
| **sem install** | nenhum dos dois | — | "Nenhum install do maker em …" (como hoje) | erro (como hoje) |

Transições feitas pelo `update` (e pelo `init` sobre install existente, sem poda):

```
files(não migrado, default) ──update──▶ pack         (reason default, aviso de opt-out)
files ──config "pack"──update──▶ pack                 (reason config)
pack  ──config "files"──update──▶ files               (recria manifest.json + bases/, remove lockfile)
pack + bases soltas ──update──▶ pack                  (união verificada, remove bases/)
```

## 3. Invariantes

- **INV-1** Em pack, `.maker/manifest.json` e `.maker/bases/` não existem após qualquer comando
  bem-sucedido de `init`/`update` (FR-006b).
- **INV-2** O mesmo `(manifest, conjunto de bases)` serializa para os mesmos bytes (FR-009).
- **INV-3** Nenhuma base não verificada é usada como base de merge (FR-010).
- **INV-4** Depois de `update`, o armazenamento contém só bases referenciadas (FR-011); `init`,
  `add`, `remove`, `agent add` e `--apply-resolutions` não podam.
- **INV-5** Nenhum escritor de estado fora de `applyChangePlan` em `src/`.
- **INV-6** `doctor` e `--dry-run` não escrevem nada (hash da árvore antes/depois).
- **INV-7** Numa transação, metadados de estado são aplicados por último e, entre eles, criar/atualizar
  antes de remover: um crash deixa coexistência (com journal), nunca ausência de estado autoritativo.
- **INV-8** Base recuperada por normalização `\r\n`→`\n` só é aceita se o sha256 conferir.

## 4. Emenda — estado de add-ons (Clarification 23, US-7)

### AddonStateRecord (`src/state/addon-state.ts`)

Mesmo conteúdo lógico do `.maker/addons/<id>.json` de hoje. O schema é o da 1.0.0, sem mudança
(`v1.0.0:src/addons/state.ts:7-22`); a leitura usa `passthrough` para que campos desconhecidos
sobrevivam ao round-trip.

| Campo | Tipo | Ordem no JSON (files) | No lockfile (pack) |
|---|---|---|---|
| `id` | `string` (`/^[a-z0-9-]+$/`) | 1º | linha-chave `addon "<id>"` (não repetido como campo) |
| `version` | `string` | 2º | `  version "<v>"` |
| `appliedAt` | `string` (ISO) | 3º | `  appliedAt "<iso>"` |
| `knobs` | `Record<string,string>` | 4º | `  knobs {…}` (chaves em code unit) |
| `createdFiles` | `{ path; hash }[]` | 5º (itens `{ path, hash }`) | `  createdFiles [{"hash":…,"path":…}]` (ordem do array preservada) |
| `injectedTargets` | `string[]` | 6º | `  injectedTargets [...]` (ordem preservada) |
| `injectedBlocks` | `Record<string,string>?` | 7º, omitido quando ausente | `  injectedBlocks {…}` só quando presente |
| extras | desconhecidos | depois, na ordem de inserção | `  <chave> <json>` (ordenados com os demais campos) |

```ts
type AddonStateRecord = AddonState & Record<string, unknown>;
const ADDON_STATE_FIELDS = ["id", "version", "appliedAt", "knobs", "createdFiles", "injectedTargets", "injectedBlocks"] as const;
function addonStateJson(record: AddonStateRecord): string;           // JSON.stringify(ordenado, null, 2) + "\n"
function parseAddonStateRecord(raw: unknown): AddonStateRecord;       // lança ZodError
function isAddonId(id: string): boolean;                              // /^[a-z0-9-]+$/
function isLockfileSerializable(record: AddonStateRecord): string | null;  // null = ok; senão o motivo (ex.: campo "my-field" fora da gramática [A-Za-z][A-Za-z0-9]*)
```

Onde vive: `files` → `.maker/addons/<id>.json`; `pack` → seção `[addons]` de `.maker/maker.lock`. Nunca
nos dois (FR-006b/FR-033).

### AddonStateProblem (files)
```ts
interface AddonStateProblem {
  id: string;             // nome do arquivo sem .json
  path: string;           // ".maker/addons/<id>.json" (montado com addonStateFile)
  detail: string;         // mensagem do JSON.parse/zod ou `state declara id "<x>"`
}
```

### StateSnapshot / InstallState (acréscimos)
```ts
interface StateSnapshot {
  // …campos existentes…
  addons: Map<string, AddonStateRecord>;   // do formato em uso (files: .maker/addons; pack: lockfile); vazio sem install
  orphanAddonStateFiles: string[];         // sem manifest nem lockfile: ids com .maker/addons/<id>.json regular (JSON órfão)
  unmigratableAddons: AddonStateProblem[]; // files: registros válidos que não cabem no lockfile (chave fora da gramática, id ≠ nome) — bloqueiam files → pack
  addonProblems: AddonStateProblem[];      // só files/sem install
  addonStateFiles: string[];               // ids com .maker/addons/<id>.json regular, ordenados (qualquer formato)
  addonsDir: "absent" | "empty" | "entries" | "not-directory" | "unreadable";
  addonsDirIssue?: string;                 // mensagem de hoje do list para not-directory/unreadable
}
interface InstallState {
  // …campos existentes…
  addons: ReadonlyMap<string, AddonStateRecord>;
  addonProblems: readonly AddonStateProblem[];
}
```

### StateError / LockfileError / DoctorFinding (acréscimos)
```ts
type LockfileErrorKind = … | "addons-invalid" | "addons-conflict";
type StateErrorKind = … | "addon-coexistence" | "addons-invalid" | "addons-conflict" | "addon-state-invalid" | "addons-dir-invalid";
// DoctorFinding.code += "addon-coexistence" | "addons-invalid" | "addons-conflict" (fail) | "addon-state-invalid" (warn)
```
`addon-state-invalid` é lançado por `planStateWrite(pack)` a partir de files quando há
`addonProblems` ou `unmigratableAddons` (FR-035, AC-47); o `doctor` emite o achado homônimo como
**aviso** quando essa migração está pendente (files em uso, efetivo pack). `addon-coexistence` também é
lançado por `planStateWrite(null, …)` (`init` sem install) com JSON órfão no disco.
`addons-dir-invalid` é lançado no planejamento quando é preciso escrever `.maker/addons/<id>.json` e
`.maker/addons` existe sem ser diretório.

### Estados do install (acréscimos à tabela §2)

| Estado | Arquivos presentes | `inUse` | Mutantes | doctor |
|---|---|---|---|---|
| **pack com add-on** | `maker.lock` com unidade em `[addons]`; **sem** `.maker/addons/*.json` | pack | operam | verde |
| **pack + `.maker/addons/` sem `*.json`** | `maker.lock` + diretório vazio (ou só com alheios) | pack | operam; `init`/`update` removem o diretório **se vazio** | verde, sem aviso |
| **coexistência de add-on** | `maker.lock` + ≥ 1 `.maker/addons/*.json` | — | **abortam** antes de escrever | **fail** (`addon-coexistence`) |
| **seção `[addons]` ilegível/em conflito** | `maker.lock` | — | **abortam**; nunca "sem install"/"não aplicado" | **fail** (`addons-invalid`/`addons-conflict`); `list` sai com erro |
| **files com estado de add-on inválido ou não migrável + migração pendente** | `manifest.json` + `.maker/addons/<id>.json` inválido, `id` ≠ nome ou com chave fora da gramática | files | `update`/`init` que migrariam abortam (`addon-state-invalid`, com ação + opt-out); os demais como hoje | **warn** `addon-state-invalid`; JSON inválido também falha na verificação de add-ons (como hoje) |
| **JSON de add-on órfão** | `.maker/addons/*.json` sem `manifest.json` nem `maker.lock` | — | `init` aborta (`addon-coexistence`, variante órfã); `remove` "não está aplicado"; demais "nenhum install" | erro "nenhum install" + menção aos órfãos; `list` mostra `degraded` |
| **`.maker/addons` não-diretório** | arquivo/symlink em `.maker/addons` | qualquer | pack: tolerado; escrita de JSON de add-on (pack → files, `add` em files) aborta no planejamento (`addons-dir-invalid`) | sem achado em pack |

Transições (acréscimo): files → pack move cada `.maker/addons/<id>.json` para uma unidade `[addons]` e
remove `.maker/addons`; pack → files recria `.maker/addons/<id>.json` (`addonStateJson`) e remove o
lockfile — mesma transação da migração de manifest e bases.

### Invariantes (acréscimos)

- **INV-9** Em pack, nenhum comando do maker cria `.maker/addons/` nem `.maker/addons/*.json`; depois de
  qualquer comando bem-sucedido não existe `.maker/addons/*.json` (FR-006b).
- **INV-10** Estado de add-on só é escrito por `planStateWrite` dentro de `applyChangePlan`
  (`writeAddonState`/`deleteAddonState` não existem em `src/`).
- **INV-11** `serializeLockfile` com os mesmos `(manifest, bases, addons)` produz os mesmos bytes; a
  seção `[addons]` existe sempre (vazia sem add-ons); só recebe registros `isLockfileSerializable`, e
  para eles `parseLockfile(serializeLockfile(…)).addons` é profundamente igual à entrada.
- **INV-12** Round-trip files → pack → files de um estado de add-on preserva campos e valores
  (igualdade profunda) e a ordem de topo do JSON; o arquivo recriado valida no schema da 1.0.0.
