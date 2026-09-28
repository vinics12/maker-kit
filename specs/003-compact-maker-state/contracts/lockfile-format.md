# Contrato — Lockfile do estado (`.maker/maker.lock`), formato v1

Dono: `src/state/lockfile.ts` (US-1). Cobre FR-007, FR-008, FR-009, FR-009a, FR-010, FR-010a, FR-012,
AC-04, AC-05, AC-16, AC-39, AC-40 e os edge cases de conteúdo. **Emenda US-7 (Clarification 23)**: seção
`[addons]` obrigatória (FR-007, FR-009, FR-009a, FR-010a, FR-031, AC-39, AC-45) — continua
`maker-lockfile 1` (o formato nunca foi publicado; lockfiles de desenvolvimento sem `[addons]` são
`addons-invalid`, sem normalização).

## 1. Gramática

Arquivo UTF-8. Toda linha estrutural termina em `\n` (LF). O arquivo termina com exatamente um `\n`.

```
lockfile     = header "\n" manifest-sec addons-sec bases-sec
header       = "maker-lockfile " version "\n" comment-lines
version      = 1*DIGIT                         ; v1 = "1"
comment-lines= *( "# " texto-fixo "\n" )       ; texto fixo, sem valores variáveis
manifest-sec = "[manifest]\n" *meta-line "\n" *( file-unit )
meta-line    = key " " json "\n"               ; toda chave de topo ≠ "files", ordenadas
file-unit    = "file " json-string "\n" *( "  " key " " json "\n" ) "\n"   ; campos ordenados
addons-sec   = "[addons]\n" "\n" *( addon-unit )                 ; US-7; sempre presente
addon-unit   = "addon " json-string "\n" 1*( "  " key " " json "\n" ) "\n"  ; id = json-string; campos ordenados; sem campo "id"
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
# Estado do maker (manifest, add-ons e bases). Gerado pela CLI — não edite à mão.
# Formato e recuperação: docs/maker-state.md do maker.
```

(US-7 troca a primeira linha de comentário; antes: `# Estado do maker (manifest + bases). …`.)

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
- Sem timestamps de execução, ids ou caminhos temporários: só manifest, add-ons e bases (o `appliedAt`
  do add-on é dado do estado, não da execução — só muda quando aquele add-on é reaplicado).
- **Add-ons** (US-7): unidades por id em code unit; campos da unidade por chave em code unit, cada
  um em uma linha com JSON canônico; arrays na ordem do registro (é parte do estado lógico).

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

[addons]

[bases]

```

## 3. Parse (`parseLockfile(raw: Buffer): ParsedLockfile`)

Ordem e resultado:

1. Linha 1 (sem `\r` final) não casa `^maker-lockfile (\d+)$` → `LockfileError("unreadable")`.
2. Versão ≠ `1` → `LockfileError("unknown-version")` — antes de olhar o resto (FR-012).
3. Seção de manifest: da linha `[manifest]` até a **primeira** linha exatamente `[addons]` (US-7;
   antes, `[bases]`).
   - `[manifest]` ausente → `manifest-invalid`. `[addons]` ausente: se também não há `[bases]`
     (truncamento dentro do manifest) → `manifest-invalid`; se há `[bases]` → `addons-invalid`
     ("seção [addons] ausente").
   - Linha que casa `^(<{7}|={7}|>{7}|\|{7})( |$)` → `manifest-conflict` (linha informada).
   - Linha fora da gramática, JSON inválido, meta-line duplicada, `file` duplicado, campo de file
     antes de qualquer `file` → `manifest-invalid` (linha informada).
   - Objeto montado falha no `manifestSchema` (zod, `passthrough`: `makerVersion`, `project{name,slug}`,
     `installedAt`, `files{hash,source,baseHash?,edited?}`, `basesFormat?` ∈ files|pack) →
     `manifest-invalid`.
   - `\r` final em linhas estruturais é tolerado na leitura e sinaliza `crlf: true`.
3a. Seção de add-ons (US-7): de `[addons]` até a primeira linha exatamente `[bases]`; sem `[bases]` →
   `addons-invalid` ("seção [bases] ausente (arquivo truncado)"). Regras em §5. Só depois dela o parse
   das bases roda (união verificada só com manifest e add-ons legíveis — FR-010a).
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
  addons: Map<string, AddonStateRecord>;   // US-7; ordenado por id
  bases: Map<string, Buffer>;      // só verificadas
  problems: BaseProblem[];          // origin "pack"
  conflictMarkers: number;          // na seção de bases
  crlf: boolean;
}
class LockfileError extends Error { kind: "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict" | "addons-invalid" | "addons-conflict"; line?: number }
function serializeLockfile(manifest: Manifest, bases: ReadonlyMap<string, Buffer>, addons?: ReadonlyMap<string, AddonStateRecord>): Buffer; // addons omitido = seção vazia
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
| L16 | (US-7) Seção `[addons]` sempre presente (vazia sem add-ons); unidades por id em code unit; campos da unidade ordenados; sem campo `id` repetido; mesmo `(manifest, bases, addons)` com ordens de inserção diferentes → bytes idênticos | FR-007, FR-009, AC-45 (determinismo) |
| L17 | (US-7) `parse(serialize(m, b, a))` devolve `a` com igualdade profunda (inclui `injectedBlocks` opcional ausente/presente e campos extras) | FR-031, INV-12 |
| L18 | (US-7) Marcador de conflito na seção `[addons]` → `addons-conflict` com a linha; nunca devolve manifest | FR-010a, AC-39 |
| L19 | (US-7) `[addons]` malformada → `addons-invalid` com linha: linha fora da gramática, JSON inválido, `addon` duplicado, campo duplicado, campo `id` explícito, id fora de `/^[a-z0-9-]+$/`, unidade que falha no schema (ex.: sem `version`), campo antes de qualquer `addon` | FR-010a, AC-39 |
| L20 | (US-7) Sem `[addons]` mas com `[bases]` → `addons-invalid` ("seção [addons] ausente"); sem `[addons]` e sem `[bases]` → `manifest-invalid`; `[addons]` sem `[bases]` → `addons-invalid` (truncado) | FR-010a, AC-39 |
| L21 | (US-7) Proxy de merge (`node-diff3`) sem conflito: edição de campos em unidades `addon` distintas (adjacentes e não adjacentes); inserção de unidade nova × edição da vizinha; inserção de unidades novas em **intervalos distintos** (separados por uma unidade inalterada); remoção de unidades não adjacentes | FR-009a, AC-45 |
| L22 | (US-7) Proxy de merge **com** conflito (documentado, risco residual): duas unidades `addon` novas diferentes no **mesmo** intervalo; o resultado com marcadores → `addons-conflict` | FR-009a, FR-010a |
| L23 | (US-7, S1) `serializeLockfile` com registro cuja chave de topo não casa `[A-Za-z][A-Za-z0-9]*` lança (erro de programação) em vez de gerar linha fora da gramática; `isLockfileSerializable` aponta a chave; para todo registro serializável vale L17 | INV-11, FR-035 |

## 5. Seção de add-ons (US-7)

Exemplo (install de referência com `saas`; hashes abreviados só aqui):

```
[addons]

addon "saas"
  appliedAt "2026-09-28T12:00:00.000Z"
  createdFiles [{"hash":"5c7b…","path":".specify/memory/saas-reference.md"}]
  injectedBlocks {".maker/workflow/agents/architect.md":"0b5c…",".maker/workflow/agents/code-reviewer.md":"2d29…",".specify/memory/constitution.md":"43c6…"}
  injectedTargets [".specify/memory/constitution.md",".maker/workflow/agents/code-reviewer.md",".maker/workflow/agents/architect.md"]
  knobs {"brandVarPrefix":"--brand-","roles":"admin,member","tenantColumn":"tenant_id"}
  version "0.1.0"

[bases]
```

- **Linha-chave** `addon <json-string>`: o id; `/^[a-z0-9-]+$/`; único na seção.
- **Campos**: `  <chave> <JSON canônico>`, chaves `[A-Za-z][A-Za-z0-9]*` (registro com chave de topo fora
  disso não é serializável: `addon-state-invalid` na migração — `plan.md` D13), ordenadas por code unit, sem
  duplicata; `id` é reservado (vem da linha-chave). Todo campo do registro entra, inclusive extras
  desconhecidos; `injectedBlocks` só aparece quando presente no registro.
- **Validação**: o objeto `{ id, ...campos }` passa por `addonStateSchema.passthrough()` (o schema da
  1.0.0); falha → `addons-invalid` com a linha da `addon`.
- **Linhas vazias**: exatamente uma depois de `[addons]` e uma depois de cada unidade (mesma regra das
  unidades `file`); outra linha vazia extra → `addons-invalid`.
- **Marcadores de conflito** (`^(<{7}|={7}|>{7}|\|{7})( |$)`) em qualquer linha da seção →
  `addons-conflict`. Sem recuperação automática (diferente das bases: o estado de add-on não é
  verificável pelo próprio conteúdo — Clarification 23).
- **Merge**: uma unidade por add-on, um campo por linha → mudanças em add-ons distintos ficam separadas
  por ≥ 1 linha inalterada (a linha-chave e a linha vazia da unidade vizinha), exceto inserções de
  unidades novas no **mesmo** intervalo (L22, risco residual documentado em `plan.md` §10).
- **Reconstrução em files** (pack → files): `addonStateJson(record)` — ordem de topo `id, version,
  appliedAt, knobs, createdFiles, injectedTargets, injectedBlocks`, extras depois; itens de
  `createdFiles` como `{ path, hash }`; `JSON.stringify(…, null, 2) + "\n"` (mesmo formato que o maker
  grava hoje). Chaves de `knobs`/`injectedBlocks` saem na ordem do registro (code unit, vindo do
  lockfile) — mesmos valores; ver `plan.md` D9.
