# Contrato — Saídas de CLI (mensagens, ações, códigos de saída)

Textos em PT-BR, estilo atual (`picocolors`). Testes comparam por substring estável (as partes entre
aspas abaixo), não pela linha inteira.

## 1. `maker update` / `maker init` — anúncio de migração (FR-018, AC-12, AC-31, AC-34)

Impresso **antes** do plano no `--dry-run` e antes do resumo no aplicado:

```
Migração do formato das bases: files → pack
  87 base(s) migrada(s), 1 descartada(s).
  descartada 3f9a…(64) [files] conteúdo não confere com o hash → afeta: AGENTS.md
  O formato "pack" é o padrão; para manter as bases por arquivo, declare "state": { "bases": "files" } em maker.config.json.
```

- A última linha só aparece quando `reason = "default"`.
- Consolidação (pack + bases soltas): `Consolidação das bases: bases por arquivo → pack` com as mesmas
  contagens.
- Aplicado: prefixo `✓ ` na primeira linha (`✓ Migração do formato das bases: files → pack`).
- Em pack sem migração, entradas inválidas descartadas ao regravar o lockfile:
  `N entrada(s) inválida(s) do lockfile descartada(s): <hash|linha> (<motivo>)`.
- `maker.config.json` com JSON malformado (manifest com config gravada): aviso
  `maker.config.json ilegível (<motivo>); formato das bases mantido (<formato>) — corrija o arquivo para escolher o formato`
  e nenhuma migração de formato; o update segue normalmente.
- `state.bases` inválido em `maker.config.json` (JSON válido): `update`/`init` abortam antes de escrever
  com `erro: maker.config.json: state.bases deve ser "files" ou "pack"` (FR-003).
- Códigos de saída: **inalterados** (0 / 1 conflito / 2 pendências). A migração nunca muda o código.

Formato do plano (`formatPlan`) inalterado. Em pack, o armazenamento aparece como uma linha
`update   .maker/maker.lock [metadata] — publicar estado (manifest + bases)`.

## 2. `maker doctor` — achados de estado (FR-023..FR-026, AC-14..AC-19, AC-35..AC-39)

Seção nova, depois das integrações e antes dos add-ons:

```
Estado (.maker):
  falha  base ausente 3f9a… (referenciada por AGENTS.md)
         ação: restaure .maker/maker.lock do histórico do git; sem a base, o próximo maker update preserva o arquivo e pede mediação
  aviso  2 base(s) órfã(s) no armazenamento
         ação: rode maker update para podá-las
  info   o próximo maker update migrará as bases para o formato "pack"
         ação: para manter bases por arquivo, declare "state": { "bases": "files" } em maker.config.json
```

| code | severidade | mensagem (substring estável) | ação (substring estável) |
|---|---|---|---|
| `pending-transaction` | fail | `transação pendente em .maker/transactions` | `rode um comando que altera o install (ex.: maker update) para recuperá-la` |
| `coexistence` | fail | `.maker/manifest.json e .maker/maker.lock coexistem` | `escolha um estado e remova o outro, ou restaure .maker do histórico do git` |
| `unreadable` | fail | `lockfile ilegível` | `restaure .maker/maker.lock do histórico do git` |
| `unknown-version` | fail | `versão de formato do lockfile desconhecida` | `atualize o maker` |
| `manifest-invalid` | fail | `seção de manifest do lockfile inválida (linha N)` | `restaure .maker/maker.lock do histórico do git` |
| `manifest-conflict` | fail | `marcadores de conflito do git na seção de manifest (linha N)` | `resolva o conflito em .maker/maker.lock ou restaure do histórico do git` |
| `base-missing` | fail | `base ausente <hash> (referenciada por <arquivos>)` | `restaure … do histórico do git; sem a base, o próximo maker update preserva o arquivo e pede mediação` |
| `base-corrupt` | fail | `base corrompida <hash> [pack\|files]: <detalhe>` | `restaure … do histórico do git; confira .maker/.gitattributes (fim de linha)` |
| `entry-truncated` | fail | `entrada truncada <hash>: tamanho declarado N, conteúdo M` (ou `sem @end`) | `restaure .maker/maker.lock do histórico do git` |
| `entry-malformed` | fail | `entrada malformada no lockfile (linha N)` | `restaure .maker/maker.lock do histórico do git` |
| `orphan-bases` | warn | `N base(s) órfã(s) no armazenamento` | `rode maker update para podá-las` |
| `loose-file-bases` | warn | `bases por arquivo em .maker/bases junto ao lockfile` | `rode maker update para consolidar no formato configurado` |
| `bases-conflict-markers` | warn | `marcadores de conflito do git na seção de bases` | `rode maker update para regravar o lockfile` |
| `addon-coexistence` (US-7) | fail | `.maker/addons/<id>.json e .maker/maker.lock coexistem (<ids>)` | `escolha um estado e remova o outro, ou restaure .maker do histórico do git` |
| `addons-invalid` (US-7) | fail | `seção de add-ons do lockfile inválida (linha N)` | `restaure .maker/maker.lock do histórico do git` |
| `addons-conflict` (US-7) | fail | `marcadores de conflito do git na seção de add-ons (linha N)` | `resolva o conflito em .maker/maker.lock ou restaure do histórico do git` |
| `addon-state-invalid` (US-7, FR-035) | warn | `estado de add-on não migrável em .maker/addons/<id>.json (<motivo>); a migração para "pack" está bloqueada` | `corrija ou restaure o arquivo do histórico do git, ou declare "state": { "bases": "files" } em maker.config.json` |
| `config-invalid` | fail | `maker.config.json: state.bases deve ser "files" ou "pack"` | `corrija state.bases em maker.config.json` |
| `config-unreadable` | warn | `maker.config.json ilegível` | `corrija o JSON de maker.config.json; o formato das bases segue o registrado` |
| `pending-default-migration` | info | `o próximo maker update migrará as bases para o formato "pack"` | `para manter bases por arquivo, declare "state": { "bases": "files" } em maker.config.json` |

- Qualquer `fail` → `process.exitCode = 1`. `warn`/`info` não degradam.
- (US-7) Em pack, `.maker/addons/` sem nenhum `*.json` (vazio, só com entradas alheias, ou não-diretório)
  **não** gera achado: o doctor segue `íntegro (pack)`. A verificação de add-ons ("Add-ons aplicados:")
  lê o estado de add-on do formato em uso — em pack, do lockfile; as mensagens por add-on não mudam.
- `crlfSuspected` acrescenta à ação de `base-corrupt`: `o lockfile parece ter sido convertido para CRLF`.
- Base com `recovered: true` continua `base-corrupt` (**fail**, AC-15), com a mensagem acrescida de
  `(recuperável: fins de linha convertidos para CRLF)` e ação `rode maker update para regravá-la; confira .maker/.gitattributes`.
- Ordem: `pending-transaction` é checada **antes** de qualquer outra coisa, inclusive antes de concluir
  "nenhum install" (um crash no meio de uma migração é reportado como transação pendente).
- Mensagens que citam caminhos de estado são montadas com as constantes de `src/state/paths.ts`
  (`MANIFEST_FILE`, `LOCKFILE`, `BASES_DIR`) — `test/state/encapsulation.test.ts` proíbe os literais fora
  de `src/state/`.
- Com `unreadable`/`unknown-version`/`manifest-*`/`coexistence` (e, US-7, `addon-coexistence`/`addons-*`) não há manifest: o doctor reporta o
  achado e sai com 1 sem as demais verificações (não lança).
- Em install íntegro (qualquer formato) a seção imprime só `Estado (.maker): íntegro (<formato>)` e o
  doctor termina com `✓ Install íntegro.` (AC-18, AC-36).

## 3. Abortos de comandos mutantes (`StateError`, AC-19, AC-38, AC-39)

`init` sobre install existente, `update` (inclusive `--apply-resolutions` e `--export`), `add`,
`remove`, `agent add` lançam **antes de qualquer escrita**; o `cli.ts` imprime `erro: <mensagem>` e sai 1:

| kind | mensagem |
|---|---|
| `coexistence` | `.maker/manifest.json e .maker/maker.lock coexistem; nenhuma alteração foi feita. Ação: escolha um estado e remova o outro, ou restaure .maker do histórico do git.` |
| `unknown-version` | `.maker/maker.lock usa um formato mais novo (versão N) que este maker entende (1); nenhuma alteração foi feita. Ação: atualize o maker.` |
| `unreadable` | `.maker/maker.lock ilegível; nenhuma alteração foi feita. Ação: restaure .maker/maker.lock do histórico do git.` |
| `manifest-invalid` | `seção de manifest de .maker/maker.lock inválida (linha N: <motivo>); nenhuma alteração foi feita. Ação: restaure .maker/maker.lock do histórico do git.` |
| `manifest-conflict` | `.maker/maker.lock contém marcadores de conflito do git na seção de manifest (linha N); nenhuma alteração foi feita. Ação: resolva o conflito ou restaure .maker/maker.lock do histórico do git.` |
| `addon-coexistence` (US-7) | `.maker/addons/<id>.json e .maker/maker.lock coexistem (<ids separados por vírgula>); nenhuma alteração foi feita. Ação: escolha um estado e remova o outro, ou restaure .maker do histórico do git.` |
| `addons-invalid` (US-7) | `seção de add-ons de .maker/maker.lock inválida (linha N: <motivo>); nenhuma alteração foi feita. Ação: restaure .maker/maker.lock do histórico do git.` |
| `addons-conflict` (US-7) | `.maker/maker.lock contém marcadores de conflito do git na seção de add-ons (linha N); nenhuma alteração foi feita. Ação: resolva o conflito ou restaure .maker/maker.lock do histórico do git.` |
| `addon-state-invalid` (US-7; `init`/`update` que migrariam files → pack) | `estado de add-on não migrável em .maker/addons/<id>.json (<motivo>); a migração para "pack" não foi feita e nenhuma alteração foi feita. Ação: corrija ou restaure o arquivo do histórico do git, ou declare "state": { "bases": "files" } em maker.config.json.` — `<motivo>` inclui `JSON inválido: …`, `schema: …`, `state declara id "<x>"`, `campo "<chave>" fora da gramática do lockfile` |
| `addon-coexistence`, variante órfã (US-7; `init` sem install) | `.maker/addons/<id>.json existe(m) sem install do maker (<ids>); nenhuma alteração foi feita. Ação: remova .maker/addons/ ou restaure .maker do histórico do git.` |
| `addons-dir-invalid` (US-7) | `.maker/addons existe e não é um diretório; nenhuma alteração foi feita. Ação: remova ou renomeie .maker/addons e rode o comando de novo.` |

`.maker/manifest.json` com JSON inválido → `unreadable` com o caminho do manifest.

(US-7) Os caminhos `.maker/addons/<id>.json` nas mensagens são montados com `addonStateFile(id)` de
`src/state/paths.ts`. `maker remove <id>` num install sem aquele add-on (qualquer formato, inclusive sem
install) mantém `Add-on "<id>" não está aplicado em <dir>.`; com estado ilegível/coexistência, o
`StateError` acima vem **antes** e o "não está aplicado" nunca é impresso.

### 3a. `maker list` (US-7)

- Só leitura; nunca escreve (hash da árvore igual antes/depois).
- Estado ilegível ou coexistência (`snapshot.error`): `erro: <mensagem do StateError de §3>` e saída 1 —
  nunca lista add-ons aplicados como `available`.
- Em pack: status de cada add-on vem da seção `[addons]`; `.maker/addons` é ignorado.
- Sem install com JSON órfão: cada órfão aparece `degraded` com `problema: estado de add-on sem install do maker (.maker/addons/<id>.json)`; os demais do catálogo `available`.
- Em files: comportamento e textos atuais (`degraded` com `problema: state inválido: …`,
  `problema: .maker/addons deveria ser um diretório`, `problema: não foi possível inspecionar
  .maker/addons: …`, `problema: não foi possível ler .maker/addons: …`), montados com `ADDONS_DIR`.

## 4. Sem install

Inalterado: `Nenhum install do maker em <dir>.` (update/agent/add) e, no doctor,
`Nenhum install do maker encontrado em <dir> (.maker/manifest.json e .maker/maker.lock ausentes).`
(US-7: com JSON de add-on órfão, o doctor acrescenta `; .maker/addons/<ids>.json órfão(s) sem install`; `remove` responde `Add-on "<id>" não está aplicado em <dir>.`)
— exceto quando há transação pendente: o doctor reporta `pending-transaction` (fail) em vez de
"nenhum install", e os comandos mutantes recuperam a transação antes de ler.

## 5. Notas de release (FR-006a, AC-29) — duas opções (Q1 decidida no Gate 2: opção A)

> **Texto corrigido pela US-7** (Clarification 23 e correções do aceite): o formato padrão passa a
> incluir o estado de add-ons; o comportamento das versões 1.x num install em pack é descrito de forma
> condicional (`init` sem `--force` recusa por colisão enquanto houver arquivos que diferem; `remove`
> para porque não encontra o estado do add-on). O texto anterior ("`init` sem `--force` … não vê colisão
> e grava um segundo estado") está **superado** e não deve ser usado.

O texto da mudança é o mesmo nas duas opções; muda só onde ele entra.

**Opção A (recomendada, bump major)** — assunto `feat(state)!: Compacta o estado de .maker num lockfile`
e o texto abaixo como rodapé `BREAKING CHANGE:` → entra em "⚠ BREAKING CHANGES" do `CHANGELOG.md` e das
release notes.

**Opção B (sem major)** — assunto `feat(state): Compacta o estado de .maker num lockfile`; o mesmo texto
(sem o prefixo `BREAKING CHANGE:`) vai no corpo do PR sob `## Notas de release` e é colado pelo
mantenedor nas release notes do Release PR antes do merge. Não persiste no `CHANGELOG.md`.

Texto (opção A mostrada com o prefixo):

```
BREAKING CHANGE: o formato padrão do estado passa a ser "pack": o manifest, o estado dos add-ons e as
bases ficam num único arquivo, .maker/maker.lock, e o próximo maker update migra installs existentes
sem formato declarado (.maker/manifest.json, .maker/bases/ e .maker/addons/ deixam de existir). Para
manter o formato por arquivo, declare "state": { "bases": "files" } em maker.config.json antes do
update. Atualize o maker em todo o time e na CI antes de migrar: num install em pack, os comandos
update, add, remove, agent add e a mediação das versões 1.x não encontram o estado que leem primeiro
(.maker/manifest.json ou .maker/addons/<id>.json) e param sem escrever, e o list das versões 1.x mostra
os add-ons como não aplicados. "maker init" sem "--force" de uma versão 1.x recusa por colisão enquanto
houver arquivos gerados que diferem do que ela renderizaria (caso de um install feito por esta versão)
e, recusando, não grava nada. "maker init --force" de uma versão 1.x reinstala por cima
independentemente do formato (limitação conhecida); o estado duplicado resultante é detectado por esta
versão, que recusa operar até que ele seja resolvido manualmente.
```
