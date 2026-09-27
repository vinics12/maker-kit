# Implementation Plan — Estado compacto em `.maker` (lockfile do estado)

**Feature Branch**: `003-compact-maker-state` · **Depth**: FULL · **Spec**: `specs/003-compact-maker-state/spec.md`
**Constitution**: `.specify/memory/constitution.md` · **Regras**: `.specify/memory/project-rules.md`
**Artefatos**: `data-model.md`, `contracts/*.md`, `tasks.md`, `briefs/US-1..6.md`

---

## 1. Resumo

O estado do install (manifest + bases de reconciliação) passa a ter **dois formatos** atrás de uma
**camada de estado única** (`src/state/`), que nenhum comando contorna:

- `"files"` (opt-out, compatível com 1.0.0): `.maker/manifest.json` + `.maker/bases/<sha256>`.
- `"pack"` (**default**): um único **lockfile** `.maker/maker.lock` — texto, determinístico, sem
  compressão, com cabeçalho versionado, seção de manifest legível e seção de bases, organizado em
  unidades estáveis para merge do git. Em pack **não existem** `.maker/manifest.json` nem `.maker/bases/`.

`init`/`update` resolvem o formato efetivo (config → manifest → `"pack"`) e migram numa transação
única; `agent add`/`add`/`remove`/`--apply-resolutions` operam no formato em uso. O `doctor` passa a
validar cada `baseHash` referenciado nos dois formatos. Dois arquivos de controle do git gerenciados
dentro de `.maker` protegem as bases de conversão de fim de linha e ignoram os temporários.

## 2. Bases técnicas ancoradas no projeto

- **Stack**: Node ≥18, TypeScript ESM (imports `.js`), `tsup` → `dist/cli.js` (versionado), `zod`,
  `commander`, `picocolors`, `node-diff3` (já dependência). **Nenhuma dependência nova.**
- **I/O**: só `node:fs`/`node:path`/`node:crypto` (P1). O CLI nunca invoca o git: a proteção de EOL
  e o ignore são **arquivos** gerenciados. Testes que dependem do binário git (AC-20, AC-21, AC-22,
  AC-40) vivem em `test/` (fora do escopo de P1, que varre `src/`) e fazem `skip` explícito sem git.
- **Persistência**: arquivos no projeto-alvo; leitura pura (doctor e `--dry-run` nunca escrevem);
  escrita só via `applyChangePlan` (journal + lock + rollback).
- **Testes**: vitest em `test/` espelhando `src/` (`test/state/*` ↔ `src/state/*`,
  `test/commands/*` ↔ `src/commands/*`). Suítes legadas planas (`test/*.integration.test.ts`) são
  adaptadas, não movidas. Verify por task: `pnpm typecheck && pnpm test && pnpm audit:coupling`.
  Verify final: `pnpm build && pnpm verify && pnpm package:smoke`.
- **Fixtures (PR6)**: valores exatos do contrato — `"files"`, `"pack"`, `utf8`, `base64`,
  `maker-lockfile 1`.

## 3. Decisões de arquitetura (resolvem os 5 pontos do spec-reviewer)

### D1 — Formato concreto do lockfile (FR-007..FR-009a, AC-04, AC-05, AC-40)

Contrato completo em `contracts/lockfile-format.md`. Resumo:

```
maker-lockfile 1
# Estado do maker (manifest + bases). Gerado pela CLI — não edite à mão.
# Formato: docs/maker-state.md

[manifest]
agents ["claude","codex"]
basesFormat "pack"
config {"agent":"claude","commands":{...},"layout":{...},"project":{...}}
installedAt "2026-09-27T12:00:00.000Z"
makerVersion "1.1.0"
project {"name":"Nimbus Ledger","slug":"nimbus-ledger"}
schemaVersion 3

file "AGENTS.md"
  baseHash "9f2c…"
  hash "9f2c…"
  source "engine:common"

file ".maker/workflow/agents/architect.md"
  …

[bases]

@base sha256=0a1b… size=1834 encoding=utf8
<exatamente 1834 bytes do conteúdo>
@end sha256=0a1b…

@base sha256=0c2d… size=12 encoding=base64
<base64 em linhas de 76 colunas>
@end sha256=0c2d…
```

- **Unidades estáveis**: cada metadado é uma linha `chave <JSON canônico>` (chaves ordenadas); cada
  arquivo gerenciado é um bloco iniciado por uma **linha-chave estável** `file "<path>"` seguida de uma
  linha indentada por campo (ordenados); cada base é um bloco `@base … / conteúdo / @end sha256=…`.
  Uma edição num campo de um arquivo nunca toca a linha-chave dele nem a do vizinho, então duas
  branches que alteram entradas **distintas** ficam separadas por ≥ 1 linha inalterada — condição
  verificada empiricamente com git: mudanças separadas por uma linha mesclam limpo, linhas adjacentes
  conflitam.
- **Ordenação**: arquivos por caminho e bases por hash em **ordem de code unit** (`a < b`), nunca
  `localeCompare` (dependente de locale → quebraria AC-04 entre máquinas). JSON canônico = chaves
  ordenadas recursivamente, sem espaços. Fim de linha `\n` fixo, UTF-8, uma quebra final.
- **Sem valores voláteis**: o lockfile só contém o manifest e as bases. Avaliação dos campos
  existentes: `installedAt` é fixado no primeiro `init` e nunca reescrito por `update`/`add`/`agent add`
  (estável); `makerVersion` só muda quando a versão do maker muda — duas branches na mesma versão
  produzem a mesma linha, e se só uma subiu a versão a mudança é unilateral (merge limpo). Nenhum
  timestamp de execução, id de transação ou caminho temporário entra no lockfile (`appliedAt` fica no
  estado do add-on, fora do lockfile). `config` só muda quando a config muda.
- **Codificação**: `utf8` para conteúdo UTF-8 válido (gravado bruto, inclusive `\r`), `base64` para o
  resto (FR-008). A leitura de `utf8` depende do `size` declarado, nunca de busca por delimitador
  (edge case "conteúdo que imita o delimitador"). `base64` é lido até a linha `@end` (o alfabeto
  base64 não produz `@end`) e verificado contra `size` e hash.
- **Git trata o lockfile como texto mesmo com bytes NUL em base `utf8`**: o `.gitattributes`
  gerenciado força `diff` e `merge=text` no lockfile (ver D3), então nenhuma base "binária aos olhos
  do git" degrada o merge a arquivo inteiro. Isso mantém FR-008 literal (sem desviar NUL para base64).
- **Casos verificados empiricamente com git (merge limpo)**: edição de campos em entradas `file`
  **adjacentes**; inserção de campo novo (no início ou no fim de uma unidade) × edição da unidade
  vizinha; inserção de unidade `file` nova × edição da unidade anterior ou seguinte; remoção de unidade
  × edição da anterior ou seguinte. Esses casos entram nos testes L12 (proxy) e AC-40 (git real).
- **Risco residual documentado**: (a) duas branches inserindo unidades `file` **novas diferentes no
  mesmo intervalo** conflitam (seção de manifest → aborto com ação, FR-010a); (b) inserção/remoção de
  bases **adjacentes na ordem de hash** vindas de branches diferentes pode conflitar na seção de bases.
  O caso (b) é contido (D2): quando o conflito cobre blocos inteiros, os dois lados são recuperados;
  quando o git refina os hunks para dentro do conteúdo de uma mesma base (conflito intercalado), as
  bases atingidas **não** são recuperadas — viram ausentes, o `doctor` falha apontando-as e o `update`
  segue com o tratamento de base ausente (preserva + mediação).

### D2 — Ressincronização do parser e detecção de conflito (FR-010, FR-010a, edge case de merge)

- **Cabeçalho** (linha 1 `maker-lockfile <n>`): ausente/ilegível → `unreadable`; `n ≠ 1` →
  `unknown-version` (FR-012). Verificado **antes** de qualquer outro parse.
- **Seção de manifest** (entre `[manifest]` e a **primeira** linha exatamente `[bases]` — nenhuma linha
  válida do manifest pode ser `[bases]`, e as bases só vêm depois): gramática estrita. Qualquer linha
  que case `^(<{7}|={7}|>{7}|\|{7})( |$)` → `manifest-conflict` (marcadores de conflito do git).
  Qualquer outra linha fora da gramática, chave duplicada, `file` duplicado, ausência de `[bases]`
  (truncamento) ou falha no schema zod do manifest → `manifest-invalid` com número da linha. Nos dois
  casos todo comando mutante aborta antes de escrever e o install **nunca** é tratado como ausente.
  Linhas estruturais toleram `\r` final na leitura (diagnóstico de conversão CRLF; ver contrato).
- **Seção de bases**: autômato por linha que **ressincroniza por unidade**, não só por tamanho:
  1. linha em branco → pula; linha de marcador de conflito → conta `conflictMarkers` e pula;
  2. linha que casa `^@base sha256=([0-9a-f]{64}) size=(\d+) encoding=(utf8|base64)$` → tenta o bloco:
     `utf8` lê exatamente `size` bytes e exige `\n@end sha256=<mesmo hash>` em seguida; `base64` lê
     linhas até `@end sha256=<mesmo hash>`, decodifica e confere `size`. Depois, `sha256(conteúdo)`
     tem de ser o hash declarado;
  3. estrutura ok e hash confere → base válida (duplicatas deduplicadas; conteúdo endereçado por hash);
  4. estrutura ok e hash não confere → problema `hash-mismatch` e segue após o `@end`;
  5. estrutura quebrada → procura a linha `@end sha256=<hash>` à frente: se achar, problema
     `size-mismatch` com o tamanho real; senão `truncated`. Em ambos, **retoma a varredura na linha
     seguinte ao cabeçalho quebrado** (não confia no `size`), tentando cada linha que case o padrão de
     cabeçalho;
  6. qualquer outra linha → problema `malformed` (uma vez por sequência) e segue. Linhas que estão
     dentro da extensão de um bloco já reportado como quebrado (até o `@end sha256=<hash>` dele, quando
     existe) **não** geram `malformed` redundante — continuam só sendo testadas como possíveis cabeçalhos.

  Como todo bloco aceito é verificado por hash, uma linha de conteúdo que imite um cabeçalho só vira
  base se trouxer o sha256 correto do que a segue — e, nesse caso, é um conteúdo correto para aquele
  hash. A ressincronização nunca aceita conteúdo não verificado; um conflito ou corrupção afeta só as
  entradas atingidas. Num conflito do git restrito à seção de bases:
  - **hunks em blocos inteiros** (caso típico de inserção/remoção de bases distintas): os dois lados
    aparecem como blocos completos entre marcadores e são **recuperados** (união verificada); o `doctor`
    avisa (`bases-conflict-markers`) e o `update` regrava o lockfile limpo;
  - **conflito intercalado** (o git refina os hunks para dentro do conteúdo de bases com linhas em
    comum): os marcadores caem no meio do conteúdo, `size`/hash não conferem e essas bases **não** são
    aceitas — contam como ausentes (`problems`), o `doctor` falha e o `update` aplica o tratamento de
    base ausente. Nenhum conteúdo misturado é usado como base de merge (FR-010).
- **Recuperação de fim de linha (ambos os formatos)**: quando o conteúdo lido não confere com o hash,
  o leitor tenta a variante com `\r\n` → `\n` e a aceita **somente se o sha256 conferir**. A base
  recuperada entra em `bases` (utilizável para merge) e fica registrada em `problems` com
  `recovered: true`; o `doctor` continua reportando `base-corrupt` como falha (AC-15: o armazenamento
  está corrompido), com a ação "rode `maker update` para regravá-la; confira `.maker/.gitattributes`", e
  o próximo `update` regrava a base correta (files: `force`; pack: lockfile regravado). Reduz o risco de
  um único arquivo (o lockfile) concentrar a perda por conversão CRLF.

### D3 — Nome/local do lockfile e arquivos de controle do git (FR-027..FR-030)

- Lockfile: **`.maker/maker.lock`** (convenção de lockfile: `Cargo.lock`, `pnpm-lock.yaml`).
  Distinto do mutex temporário `.maker/transaction.lock`, que é listado nominalmente no ignore.
- `.maker/.gitattributes` (gerenciado, conteúdo exato em `contracts/git-control-files.md`):
  `maker.lock -text diff merge=text linguist-generated=true` e
  `bases/** -text linguist-generated=true`. `-text` impede conversão de EOL (FR-027a); `diff` e
  `merge=text` garantem diff e merge textuais do lockfile; `linguist-generated` colapsa no PR
  (FR-027b, AC-22).
- `.maker/.gitignore` (gerenciado): `/transactions/`, `/transaction.lock`, `/mediation/`, `/runs/`
  (FR-028, AC-21).
- Os dois são templates do engine em `templates/engine/common/.maker/` (P3: espelham o alvo) e entram
  no manifest como qualquer arquivo gerenciado, com base, merge 3-way e preservação de customização
  (FR-029, AC-23). O ignore é versionado como **`.gitignore.hbs`**: o `npm pack` descarta arquivos
  chamados `.gitignore`; o `.hbs` é renderizado e perde a extensão (P3), sem placeholders.
- **Mediação dos dois arquivos (B1)**: `isMediablePath` (`src/commands/mediation.ts:393-399`) recusa
  hoje todo `.maker/*` fora de `.maker/workflow/`. Passa a aceitar **exatamente** `.maker/.gitignore` e
  `.maker/.gitattributes` (constante `GIT_CONTROL_FILES` de `src/state/paths.ts`), mesmo quando ainda
  não rastreados (caso B2). Continuam recusados `.maker/manifest.json`, `.maker/maker.lock`,
  `.maker/bases/**`, `.maker/addons/*.json` e qualquer outro `.maker/*` fora de `.maker/workflow/`
  (o teste `test/mediation.integration.test.ts:227` segue passando).
- **Arquivo pré-existente não rastreado (B2, P4)**: hoje o `update` sobrescreve um arquivo do engine
  sem entrada no manifest (`!recorded` + `force`, `src/commands/update.ts:196-199`). Para
  `GIT_CONTROL_FILES`: se o arquivo existe, não está no manifest e **difere** do upstream → preservado
  e encaminhado para mediação como `local-edit` "arquivo pré-existente não rastreado pelo maker" (sem
  base); se é **idêntico** ao upstream → só passa a ser rastreado (entrada + base). A regra é limitada
  aos dois caminhos novos: generalizá-la a todo arquivo não rastreado mudaria a semântica atual do
  update (fora do escopo). O `init` já recusa colisões sem `--force` (comportamento atual).
- **Skill `maker-update`**: `templates/engine/workflow/skills/maker-update/SKILL.md` (regra "never
  edit …", linha 23) passa a proibir também editar `.maker/maker.lock`.
- Nada é criado/alterado fora de `.maker` por esta feature (FR-030). Ver **Q2** (§9) sobre o
  `.gitattributes` de raiz que o engine já instala hoje.

### D4 — Abstração de estado que esconde o formato de todos os comandos

Novo módulo `src/state/` (API completa em `contracts/state-api.md`):

| Módulo | Papel |
|---|---|
| `src/state/paths.ts` | Constantes `MANIFEST_FILE`, `LOCKFILE`, `BASES_DIR`, `GIT_CONTROL_FILES` (`.maker/.gitignore`, `.maker/.gitattributes`), `basePath()`, `isStateMetadata()`. Sem imports (quebra ciclos). |
| `src/state/lockfile.ts` | Codec puro: `serializeLockfile`, `parseLockfile`, `canonicalJson`, `LockfileError`. |
| `src/state/store.ts` | `inspectState` (fatos, nunca lança por conteúdo), `openState(target, { mode })` → `InstallState \| null` (lança `StateError`), `readManifest` (fachada), `planStateWrite` (gera `PlannedChange[]` para o formato alvo, com `consolidate`/`prune`). |
| `src/state/format.ts` | `configuredBasesFormat`, `effectiveBasesFormat`, `planFormatTransition`, `pendingDefaultMigration`. |
| `src/state/diagnose.ts` | (US-3) achados do doctor sobre estado/bases a partir do snapshot. |

Regras que fecham o ponto 4:
- `readManifest`/`writeManifest`/`MANIFEST_FILE` **saem** de `src/render/manifest.ts` (que fica só com
  tipos, `sha256`, `manifestKey`, `verifyManifest`, `enabledAgents`).
- **Nenhum escritor de estado fora do plano transacional**: `writeManifest` deixa de existir em `src/`.
  O único chamador (`src/commands/agent.ts`) passa a planejar arquivos + bases + estado e aplicar via
  `applyChangePlan` (US-1 faz a troca mínima; US-5 torna o `agent add` inteiro transacional). Testes
  usam `test/helpers/state.ts`, que também grava via `planStateWrite` + `applyChangePlan`.
- `test/state/encapsulation.test.ts` (prova arquitetural): fora de `src/state/`, zero ocorrências de
  `manifest.json`, `maker.lock`, `.maker/bases` ou `"bases"`/`'bases'` como segmento de caminho.
- `openState` modes: `mutate` (adquire o lock, **recupera transações pendentes antes de ler** — FR-019,
  AC-10b — e libera), `dry-run` (`assertNoPendingTransactions`, comportamento atual), `read` (doctor:
  não recupera; o snapshot informa a transação pendente).
- `StateError.kind`: `coexistence` (manifest.json + lockfile, FR-006c), `unreadable`,
  `unknown-version` (FR-012), `manifest-invalid`, `manifest-conflict` (FR-010a) — cada um com `action`.
- Leitura de bases = **união verificada** dos dois formatos presentes (FR-006, FR-015); inválidas viram
  `problems` e contam como ausentes (FR-010).
- `planStateWrite` também normaliza: `manifest.config` nunca carrega `state` (o formato registrado vive
  só em `manifest.basesFormat`).
- **Ordem na transação**: os metadados de estado (`isStateMetadata`: `manifest.json`, `maker.lock`,
  `addons/*.json`) vão por último; entre eles, **criar/atualizar antes de remover** (depois por caminho).
  Numa migração files → pack a sequência é `bases/` removido → `maker.lock` criado → `manifest.json`
  removido; pack → files: bases criadas → `manifest.json` criado → `maker.lock` removido. Assim, um crash
  no meio deixa **coexistência** (detectável, com journal pendente) e nunca um instante sem nenhum
  estado autoritativo ("nenhum install"). O `doctor` checa transação pendente **antes** de concluir
  "nenhum install".

### D5 — Compatibilidade com a 1.0.0 (FR-006a, FR-006b, AC-37)

A 1.0.0 publicada não valida `schemaVersion`; todos os seus comandos mutantes e o `doctor` abortam
quando `.maker/manifest.json` não existe. Em pack esse arquivo não existe (FR-006b), o que faz a 1.0.0
parar sem escrever. **Para a 1.0.0, a única mitigação além dessa ausência é o CHANGELOG/release notes
(FR-006a)** — não há como fazer a versão publicada ler ou recusar o lockfile. Casos que só o CHANGELOG
cobre:
- `maker init --force` da 1.0.0 num install em pack reinstala por cima (limitação conhecida da spec);
- `maker init` **sem** `--force` da 1.0.0 num install em pack **sem customizações** não vê colisão e
  grava `.maker/manifest.json` + `.maker/bases/` ao lado do lockfile. A versão nova detecta isso como
  coexistência (FR-006c): aborta e o `doctor` falha, com ação "escolha um estado e remova o outro, ou
  restaure do git". Não há degradação silenciosa, mas o CHANGELOG deve orientar a atualizar o maker em
  todo o time/CI **antes** de migrar.

`schemaVersion` permanece `3`: o campo novo `basesFormat` é opcional e a 1.0.0 não valida versão; a
versão do formato pack vive no cabeçalho do lockfile.

### D6 — Configuração `state.bases` e resolução do formato (FR-003..FR-006)

- `configSchema` ganha `state: { bases?: "files" | "pack" }` **sem `.default()`** — ausência é
  distinguível de `"files"`. Valor inválido → erro zod com mensagem
  `state.bases deve ser "files" ou "pack"`.
- Fonte da config para o formato: `init` usa a config carregada (`--config` ou `maker.config.json`);
  `update`/`doctor` leem `state.bases` de `maker.config.json` do alvo (validando só a subárvore
  `state`). Hoje o `update` renderiza com a config gravada no manifest e ignora `maker.config.json`;
  por isso o formato é lido à parte, sem mudar a fonte da config de renderização.
- `maker.config.json` com JSON **malformado** não quebra installs que funcionam hoje: quando o manifest
  tem config gravada (o `update` atual nem lê o arquivo), o formato configurado conta como
  **desconhecido** e o formato é resolvido **sem migração**: efetivo = registrado no manifest ou, sem
  registro, o formato em uso. O `update` imprime aviso (`maker.config.json ilegível; formato das bases
  mantido (<formato>)`) e o `doctor` emite `config-unreadable` (aviso). Sem config no manifest (installs
  0.2.x), o comportamento atual se mantém (`resolveConfig` falha ao ler o arquivo).
- JSON válido com `state.bases` fora do enum → `update` e `init` abortam antes de escrever com a
  mensagem de validação (FR-003); o `doctor` reporta `config-invalid` (falha).
- Efetivo = config → `manifest.basesFormat` → `"pack"` (`reason`: `config|manifest|default`).
  Só `init`/`update` gravam `basesFormat` (sempre o efetivo, AC-35). `agent add`/`add`/`remove`/
  `--apply-resolutions` preservam o campo exatamente como estava (ausente continua ausente).
- `sentinelConfig` (update) passa `state` intacto (senão o enum rejeitaria o sentinela).

### D7 — Migração, consolidação e relatório (FR-013..FR-019)

- `planFormatTransition(state, effective)` → `{ from, to, reason, migrated, discarded[],
  consolidatesLoose }` ou `null`. Há transição quando `effective ≠ inUse` ou quando há bases soltas
  por arquivo junto ao lockfile.
- `update`: `planStateWrite({ format: effective, consolidate: true, prune: true })` — o resultado tem
  exatamente as bases referenciadas válidas (união verificada), remove o outro formato
  (`.maker/manifest.json` + `.maker/bases/` ou o lockfile) na **mesma transação** e registra
  `basesFormat`. Corrompidas não migram, vão para `discarded` e o arquivo dependente recebe o
  tratamento atual de base ausente (preservado + mediação).
- `init` sobre install existente: mesma regra com `consolidate: true, prune: false` (só o `update`
  poda órfãs, FR-011).
- Relatório destacado (dry-run e aplicado), texto exato em `contracts/cli-output.md`: origem → destino,
  N migradas, M descartadas (hash, origem, motivo, arquivos afetados) e, se `reason = default`, o
  opt-out `"state": { "bases": "files" }`. Códigos de saída inalterados (AC-09).
- Rollback: a migração é um plano comum do `applyChangePlan` (journal + backup + lock). Crash →
  próximo comando mutante recupera antes de ler (`openState({ mode: "mutate" })`), antes de qualquer
  verificação de coexistência.
- `.maker/bases/` é removido como **um** `remove` de diretório quando contém só arquivos com nome de
  hash; se houver algo alheio, só os arquivos de base são removidos e o diretório fica.

### D8 — `agent add` passa a registrar bases e a ser transacional (AC-30, AC-33, FR-022)

Hoje o `agent add` escreve arquivos direto (`applyAgentProvider(targetDir, …)`), não registra
`baseHash` e grava o manifest por `writeManifest` — contraria FR-022 e a Clarification 14 ("`agent
add` grava bases"). US-5 renderiza o provider em staging, planeja arquivos + entradas com
`baseHash = hash` + bases no formato em uso e aplica tudo numa transação. Informativo para o Gate 2:
é a única mudança de comportamento fora do armazenamento (arquivos adicionados por `agent add` passam
a ser mescláveis no próximo `update`).

## 4. Constitution Check

| Princípio | Como o plano cumpre | Prova |
|---|---|---|
| P1 sem shell-out | Estado e proteção git são arquivos; testes com git ficam em `test/` | `test/runs/no-shellout.test.ts` (inalterado, varre `src/`) |
| P2 agnóstico | Só estado mecânico; `state.bases` é knob mecânico; templates novos sem termo de negócio | `pnpm audit:coupling` |
| P3 templates espelham o alvo | `.maker/.gitattributes` e `.maker/.gitignore.hbs` em `templates/engine/common/.maker/` | `test/init.integration.test.ts`, `test/state/reference-install.test.ts` |
| P4 (arquivos do consumidor) | `.maker/.gitignore`/`.gitattributes` pré-existentes nunca sobrescritos (B2) | `test/commands/update.pack.test.ts` (T216) |
| P4 idempotência/reversibilidade | Migração transacional, idempotente, reversível nos dois sentidos; `agent add` passa a ser transacional | AC-03, AC-10, AC-11, AC-24, AC-25, FR-022 |
| PR3 testes espelhados | `test/state/*`, `test/commands/*`, `test/config/*`, `test/changes/*`. **Testes que não espelham um arquivo de `src/`** (provas arquiteturais/de aceite, mesmo padrão de `test/runs/no-shellout.test.ts`): `test/state/encapsulation.test.ts`, `test/state/git-interop.test.ts`, `test/state/reference-install.test.ts`, `test/commands/legacy-reader.test.ts`, `test/docs/maker-state.test.ts`, e os de comando com sufixo de cenário (`update.pack`, `update.parity`, …) que exercitam `src/commands/<cmd>.ts`; `test/helpers/state.ts` é helper, não teste | layout |
| PR5 comentários mínimos | Comentário só onde o porquê não é óbvio (ex.: `.gitignore.hbs`, ordem por code unit, `merge=text`) | code review |
| PR6 fixtures | Valores exatos `"files"`, `"pack"`, `utf8`, `base64`, `maker-lockfile 1` | testes |
| Bases técnicas: leitura pura | doctor/dry-run usam `openState` em modo `read`/`dry-run`; nenhum escreve | AC-08, AC-12 (hash da árvore antes/depois) |

**Teste de isolamento/segurança: não aplicável** — a constitution/project-rules não declaram regra de
isolamento de dados entre clientes nem controle de acesso; o maker é CLI headless sem e2e. Os
invariantes de integridade desta feature são provados por testes de nível Node em `test/`
(encapsulamento do estado, no-shellout, leitura pura por hash de árvore).

## 5. Impacto em código existente (mapa)

| Arquivo | Mudança | US |
|---|---|---|
| `src/render/manifest.ts` | + `basesFormat?`; − `readManifest`/`writeManifest`/`MANIFEST_FILE` | US-1 |
| `src/config/schema.ts` | + `state.bases` opcional sem default | US-1 |
| `src/changes/transaction.ts` | `isMetadata` → `isStateMetadata`; hook `crashAfter`; `recoverBeforeRead`; `hasPendingTransactions` | US-1 |
| `src/commands/init.ts` (134-152) | bases + manifest via `planStateWrite`; depois formato efetivo + migração | US-1 → US-2 |
| `src/commands/update.ts` (113, 207, 222, 236-243, 336-347, 404-423) | `readBase`/`listBases`/base writes → `InstallState` + `planStateWrite`; `sentinelConfig` ignora `state`; depois transição + relatório | US-1 → US-2 |
| `src/commands/mediation.ts` (229, 337, 369; 393-399 `isMediablePath`) | leitura/escrita via estado, formato em uso; aceita `GIT_CONTROL_FILES` (B1) | US-1 → US-2 |
| `src/commands/update.ts` (196-199) | arquivo de controle git pré-existente não rastreado: preserva + mediação (B2) | US-2 |
| `templates/engine/workflow/skills/maker-update/SKILL.md` (23) | proíbe editar `.maker/maker.lock` | US-4 |
| `src/agents/migrate.ts` (247 `planBase`) | acumula bases num `Map` devolvido ao `planUpdate` | US-1 |
| `src/addons/apply.ts` (98, 209, 226, 264) | leitura/escrita via estado, formato em uso | US-1 (verificação em US-5) |
| `src/commands/agent.ts` (21, 42, 51) | `openState` + persistência transacional; depois `agent add` inteiro transacional com bases | US-1 → US-5 |
| `src/util/engine-scaffold.ts` (`applyAgentProvider`) | opção `includeShared` para renderizar em staging | US-5 |
| `src/commands/doctor.ts` (18-20, 61) | `openState({mode:"read"})`, `hasBase`; depois achados completos | US-1 → US-3 |
| `src/addons/doctor.ts` (138) | base verificada via callback `hasBase` | US-1 → US-3 |
| `src/agents/validate.ts` (42-45) | fachada `readManifest`; mensagem genérica "estado do maker ilegível" | US-1 |
| `templates/engine/common/.maker/*` | novos arquivos de controle do git (junto com B1/B2, que precisam deles para teste) | US-2 |

## 6. Estratégia de testes (resumo)

- **Unit** (`test/state/`): codec do lockfile (determinismo, legibilidade, edge cases, ressincronização,
  marcadores, versão, truncamento, proxy de merge com `node-diff3`), store (coexistência, união
  verificada, `planStateWrite` nos dois formatos), format (resolução e transição), diagnose.
- **Integração por comando** (`test/commands/`): update/init/mediação em pack e files, paridade entre
  formatos (AC-09), dry-run determinístico, rollback em processo e por crash, doctor, agent/add/remove.
- **Interop git** (`test/state/git-interop.test.ts`): autocrlf + clone, ignore, `check-attr`, merge de
  branches — `it.skipIf(!git)` com motivo.
- **Arquiteturais**: `test/state/encapsulation.test.ts`, `test/runs/no-shellout.test.ts` (existente).
- **Helpers de teste**: `test/helpers/state.ts` (congelado depois de US-1) — `readManifest`,
  `writeManifest` (transacional, formato em uso), `putBase`, `corruptBase`, `lockfileText`,
  `snapshotTree`, `initInstall({ format })` (produz o formato pedido convertendo após o `init`, sem
  depender do default — US-3 roda em paralelo com a US-2, que troca o default), `hasGit()`.

## 7. Paralelismo (2 slots)

| Fase | Slot 1 | Slot 2 | Por que nessa ordem |
|---|---|---|---|
| A | **US-1** camada de estado + religação | — | Substrato; toca imports em quase todo `src/`/`test/` |
| B | **US-2** init/update/mediação: formato efetivo + migração + templates de controle git (B1/B2) | **US-3** doctor | Arquivos disjuntos; ambos só consomem `src/state/` congelado. Os templates entram na US-2 porque B1/B2 (em `update.ts`/`mediation.ts`) só são testáveis com eles, e os ajustes de contagem que eles provocam caem em testes da própria US-2 |
| C | **US-4** skill maker-update + interop git + contagem | **US-5** agent add/add/remove | Disjuntos; AC-20/AC-40/SC-001 dependem de pack, dos templates (US-2) e do doctor (US-3) |
| D | **US-6** docs, notas de release, `pnpm build` | — | Documenta o comportamento final; `dist/` só no fim |

Interseção de `Tocar SOMENTE:` — B: US-2 ∩ US-3 = ∅. C: US-4 ∩ US-5 = ∅. Detalhe em `tasks.md`.
`src/state/{paths,lockfile,store,format}.ts` e `test/helpers/state.ts` ficam **congelados** após US-1;
se uma US precisar mudar a API, é retorno ao Gate 2.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Conflito na seção de bases por inserção/remoção adjacente em ordem de hash | Hunks em blocos inteiros: parser recupera os dois lados (D2), doctor avisa, update consolida. Conflito intercalado: bases atingidas ficam ausentes (nunca usadas), doctor falha, update aplica tratamento de base ausente. Documentado em `docs/maker-state.md` |
| Duas branches adicionando unidades `file` novas no mesmo intervalo | Conflito na seção de manifest → aborto com ação (FR-010a); documentado |
| `linguist-generated` esconde no PR também as mudanças do manifest | Trade-off documentado com como expandir (FR-002) |
| Lockfile convertido para CRLF sem `.gitattributes` (antes do primeiro update) | Leitura tolera `\r` nas linhas estruturais; bases convertidas são recuperadas pela variante `\r\n`→`\n` quando o sha256 confere (usáveis no merge); o doctor ainda falha (AC-15) com ação de rodar `maker update`, que regrava |
| `.maker/.gitignore`/`.gitattributes` pré-existentes do consumidor | B2: preservados e encaminhados para mediação; mediação liberada para esses dois caminhos (B1) |
| Crash no meio de uma migração | Metadados create/update antes de remove → coexistência com journal (nunca "sem install"); recuperação antes de ler; doctor reporta transação pendente primeiro |
| `maker.config.json` malformado | Não quebra installs com config no manifest; formato mantido sem migração, com aviso |
| Versões misturadas (1.0.0) | D5: ausência de `manifest.json` + CHANGELOG; coexistência detectada |
| Troca de default quebra suítes legadas que leem `.maker/manifest.json` | US-1 migra testes para o helper agnóstico antes da troca (US-2) |

## 9. Pontos em aberto para o Gate 2

> **Decididos no Gate 2 (humano, 2026-09-27):** Q1 → opção A, `feat(state)!:` com rodapé
> `BREAKING CHANGE:` (bump para **2.0.0**); T604 usa só o texto da opção A. Q2 → raiz intocada
> (leitura abaixo confirmada).

- **Q1 (FR-006a, release)**: o CHANGELOG é gerado pelo Release Please a partir dos commits. Recomendação:
  o commit da feature usa `feat(state)!:` com rodapé `BREAKING CHANGE:` (texto em
  `contracts/cli-output.md` §5), o que coloca a mudança em "⚠ BREAKING CHANGES" do CHANGELOG e das
  release notes. **Consequência: bump major (2.0.0).** Alternativa sem major: `feat:` + nota manual nas
  release notes do Release PR (não persiste no `CHANGELOG.md`, cumpre só "release notes"). Decisão do
  humano, ainda pendente; T604 suporta as duas opções (textos para ambas em `contracts/cli-output.md` §5)
  e nenhuma outra task depende da escolha.
- **Q2 (FR-030)**: o engine já instala hoje um `.gitattributes` **na raiz** (`*.sh eol=lf`,
  `templates/engine/common/.gitattributes`). Lemos FR-030 como "esta feature não cria nem altera
  arquivos de controle do git fora de `.maker`": o arquivo de raiz existente segue intocado e o teste
  de FR-030 prova que o conteúdo dele não mudou e que nenhum `.gitignore` de raiz é criado. Se a
  intenção era remover o de raiz, é retorno ao Gate 1.
- **Q3 (informativo)**: D8 — `agent add` passa a registrar bases (a spec já assume que registra).
