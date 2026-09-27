# Contrato — Lockfile do estado (`.maker/maker.lock`), formato v1

Dono: `src/state/lockfile.ts` (US-1). Cobre FR-007, FR-008, FR-009, FR-009a, FR-010, FR-010a, FR-012,
AC-04, AC-05, AC-16, AC-39, AC-40 e os edge cases de conteúdo.

## 1. Gramática

Arquivo UTF-8. Toda linha estrutural termina em `\n` (LF). O arquivo termina com exatamente um `\n`.

```
lockfile     = header "\n" manifest-sec bases-sec
header       = "maker-lockfile " version "\n" comment-lines
version      = 1*DIGIT                         ; v1 = "1"
comment-lines= *( "# " texto-fixo "\n" )       ; texto fixo, sem valores variáveis
manifest-sec = "[manifest]\n" *meta-line "\n" *( file-unit )
meta-line    = key " " json "\n"               ; toda chave de topo ≠ "files", ordenadas
file-unit    = "file " json-string "\n" *( "  " key " " json "\n" ) "\n"   ; campos ordenados
bases-sec    = "[bases]\n" "\n" *( base-unit )
base-unit    = "@base sha256=" hex64 " size=" 1*DIGIT " encoding=" enc "\n"
               payload
               "@end sha256=" hex64 "\n" "\n"
enc          = "utf8" | "base64"
payload(utf8)   = <exatamente size bytes do conteúdo> "\n"
payload(base64) = *( <até 76 chars base64> "\n" )            ; zero linhas se size = 0
key          = [A-Za-z][A-Za-z0-9]*
json         = JSON canônico (ver §2), uma linha
```

Texto fixo do cabeçalho (v1), byte a byte:

```
maker-lockfile 1
# Estado do maker (manifest + bases). Gerado pela CLI — não edite à mão.
# Formato e recuperação: docs/maker-state.md do maker.
```

## 2. Serialização determinística

- **JSON canônico**: `canonicalJson(v)` = `JSON.stringify` com chaves de objeto ordenadas
  recursivamente (code unit), sem espaços; arrays na ordem original; strings com os escapes padrão.
- **Ordem**: meta-lines por chave; `file` por caminho; campos do file por chave; bases por hash.
  Comparação **por code unit** (`a < b ? -1 : a > b ? 1 : 0`), nunca `localeCompare`.
- **Manifest gravado**: todas as chaves de topo, exceto `files`, viram meta-lines (inclusive chaves
  desconhecidas — round trip sem perda). `config.state` é removido antes (normalização de
  `planStateWrite`).
- **Base `utf8`** se `new TextDecoder("utf-8", { fatal: true })` aceita o conteúdo; senão `base64`
  (`Buffer.toString("base64")`, quebrado em linhas de 76). Conteúdo `utf8` é gravado bruto (inclusive
  `\r`, NUL, texto que imita cabeçalho/delimitador).
- Sem timestamps, ids ou caminhos temporários: só manifest + bases.

Exemplo mínimo válido (install sem bases):

```
maker-lockfile 1
# Estado do maker (manifest + bases). Gerado pela CLI — não edite à mão.
# Formato e recuperação: docs/maker-state.md do maker.

[manifest]
basesFormat "pack"
installedAt "2026-09-27T12:00:00.000Z"
makerVersion "1.1.0"
project {"name":"X","slug":"x"}
schemaVersion 3

[bases]

```

## 3. Parse (`parseLockfile(raw: Buffer): ParsedLockfile`)

Ordem e resultado:

1. Linha 1 (sem `\r` final) não casa `^maker-lockfile (\d+)$` → `LockfileError("unreadable")`.
2. Versão ≠ `1` → `LockfileError("unknown-version")` — antes de olhar o resto (FR-012).
3. Seção de manifest: da linha `[manifest]` até a **primeira** linha exatamente `[bases]`.
   - `[manifest]` ausente, ou `[bases]` ausente (truncamento) → `manifest-invalid`.
   - Linha que casa `^(<{7}|={7}|>{7}|\|{7})( |$)` → `manifest-conflict` (linha informada).
   - Linha fora da gramática, JSON inválido, meta-line duplicada, `file` duplicado, campo de file
     antes de qualquer `file` → `manifest-invalid` (linha informada).
   - Objeto montado falha no `manifestSchema` (zod, `passthrough`: `makerVersion`, `project{name,slug}`,
     `installedAt`, `files{hash,source,baseHash?,edited?}`, `basesFormat?` ∈ files|pack) →
     `manifest-invalid`.
   - `\r` final em linhas estruturais é tolerado na leitura e sinaliza `crlf: true`.
4. Seção de bases — autômato com ressincronização por unidade (plan.md D2):

| Linha atual | Ação |
|---|---|
| vazia | pula |
| marcador de conflito (`<<<<<<<`, `=======`, `>>>>>>>`, `\|\|\|\|\|\|\|`) | `conflictMarkers++`, pula |
| cabeçalho `@base …` válido | tenta o bloco (abaixo) |
| qualquer outra | `malformed` (uma vez por sequência contígua), pula — exceto dentro da extensão de um bloco já reportado como quebrado (até o `@end sha256=<hash>` dele): aí não há `malformed` redundante |

Tentativa de bloco:
- `utf8`: exige `size` bytes após o `\n` do cabeçalho seguidos de `\n@end sha256=<hash>` + (`\n` | EOF).
- `base64`: consome linhas até `@end sha256=<hash>`; linha que não é base64 válido ou fim do arquivo →
  estrutura quebrada; decodificado com tamanho ≠ `size` → `size-mismatch`.
- Estrutura ok: `sha256(conteúdo) === hash` → base válida (duplicata idêntica deduplicada). Senão,
  tenta a variante `conteúdo` com `\r\n` → `\n`: se o sha256 conferir, a base entra em `bases` e o
  problema `hash-mismatch` é registrado com `recovered: true`; senão `hash-mismatch` sem recuperação.
  Em ambos continua depois do `@end`. (A mesma recuperação vale para `.maker/bases/<hash>` no store.)
- Estrutura quebrada: procura adiante a linha `@end sha256=<hash>`; achou → `size-mismatch` com
  `detail` "tamanho declarado N, conteúdo M"; não achou → `truncated`. **Retoma na linha seguinte ao
  cabeçalho quebrado**, testando cada linha como possível cabeçalho.

Resultado:

```ts
interface ParsedLockfile {
  version: 1;
  manifest: Manifest;
  bases: Map<string, Buffer>;      // só verificadas
  problems: BaseProblem[];          // origin "pack"
  conflictMarkers: number;          // na seção de bases
  crlf: boolean;
}
class LockfileError extends Error { kind: "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict"; line?: number }
```

## 4. Propriedades testáveis (US-1, `test/state/lockfile.test.ts`)

| # | Propriedade | AC/FR |
|---|---|---|
| L1 | `parse(serialize(m, b))` devolve `m` (sem `config.state`) e `b` | FR-010 |
| L2 | Mesmo estado lógico com ordens de inserção diferentes → bytes idênticos; sem `\r` estrutural | AC-04, FR-009 |
| L3 | Estrutura visível: cabeçalho, `[manifest]` com um `file` por caminho, `[bases]` com sha256/size/encoding; UTF-8 legível; não UTF-8 em base64 | AC-05, FR-007, FR-008 |
| L4 | Base de 0 bytes e lockfile sem bases são válidos | edge cases |
| L5 | Conteúdo `utf8` contendo `@end sha256=…`, `@base …`, `[bases]` e marcadores de conflito é recuperado intacto | edge case delimitador |
| L6 | Conteúdo com `\r\n` e com NUL é recuperado byte a byte | FR-010 |
| L7 | Bloco do meio com `size` errado/truncado → `size-mismatch`/`truncated`, e os blocos seguintes são recuperados | FR-010, AC-16 |
| L8 | Bloco com conteúdo alterado → `hash-mismatch`; nunca entra em `bases` | FR-010, AC-15 |
| L9a | Conflito do git na seção de bases com hunks em blocos inteiros (os dois lados entre marcadores) → todos os blocos verificados recuperados; `conflictMarkers > 0` | edge case merge |
| L9b | Conflito **intercalado** (marcadores dentro do conteúdo de bases com linhas em comum, como o git produz ao refinar hunks) → as bases atingidas geram `problems` e **nenhuma** delas entra em `bases`; blocos intactos fora do conflito continuam válidos | FR-010, edge case merge |
| L10 | Marcador na seção de manifest → `manifest-conflict`; manifest truncado (sem `[bases]`) → `manifest-invalid` | FR-010a, AC-39 |
| L11 | `maker-lockfile 2` → `unknown-version`; primeira linha inválida → `unreadable` | FR-012, AC-16 |
| L12 | Proxy de merge (`node-diff3`, sem git) — sem conflito para: edições de campos em entradas `file` distintas **adjacentes** e não adjacentes; inserção de campo novo numa unidade × edição da vizinha; inserção de unidade `file` nova × edição da anterior e da seguinte; remoção de unidade × edição da vizinha. Com conflito (documentado): duas unidades novas diferentes no mesmo intervalo | FR-009a |
| L13 | Linhas estruturais com `\r` → manifest lido, `crlf: true`; bases `utf8` cujo conteúdo ganhou `\r` recuperadas pela variante `\r\n`→`\n` com `recovered: true` | risco CRLF |
| L14 | Base cujo conteúdo original contém `\r\n` legítimo e foi alterado de outra forma → **não** recuperada (a variante não confere); base original com `\r\n` intacta → válida sem recuperação | FR-010 |
| L15 | Bloco quebrado seguido de linhas de conteúdo até o seu `@end` → um único problema, sem `malformed` por linha | ruído do doctor |
