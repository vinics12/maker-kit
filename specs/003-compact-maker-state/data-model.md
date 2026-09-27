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
