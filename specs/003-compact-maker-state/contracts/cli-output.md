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
| `config-invalid` | fail | `maker.config.json: state.bases deve ser "files" ou "pack"` | `corrija state.bases em maker.config.json` |
| `config-unreadable` | warn | `maker.config.json ilegível` | `corrija o JSON de maker.config.json; o formato das bases segue o registrado` |
| `pending-default-migration` | info | `o próximo maker update migrará as bases para o formato "pack"` | `para manter bases por arquivo, declare "state": { "bases": "files" } em maker.config.json` |

- Qualquer `fail` → `process.exitCode = 1`. `warn`/`info` não degradam.
- `crlfSuspected` acrescenta à ação de `base-corrupt`: `o lockfile parece ter sido convertido para CRLF`.
- Base com `recovered: true` continua `base-corrupt` (**fail**, AC-15), com a mensagem acrescida de
  `(recuperável: fins de linha convertidos para CRLF)` e ação `rode maker update para regravá-la; confira .maker/.gitattributes`.
- Ordem: `pending-transaction` é checada **antes** de qualquer outra coisa, inclusive antes de concluir
  "nenhum install" (um crash no meio de uma migração é reportado como transação pendente).
- Mensagens que citam caminhos de estado são montadas com as constantes de `src/state/paths.ts`
  (`MANIFEST_FILE`, `LOCKFILE`, `BASES_DIR`) — `test/state/encapsulation.test.ts` proíbe os literais fora
  de `src/state/`.
- Com `unreadable`/`unknown-version`/`manifest-*`/`coexistence` não há manifest: o doctor reporta o
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

`.maker/manifest.json` com JSON inválido → `unreadable` com o caminho do manifest.

## 4. Sem install

Inalterado: `Nenhum install do maker em <dir>.` (update/agent/add) e, no doctor,
`Nenhum install do maker encontrado em <dir> (.maker/manifest.json e .maker/maker.lock ausentes).`
— exceto quando há transação pendente: o doctor reporta `pending-transaction` (fail) em vez de
"nenhum install", e os comandos mutantes recuperam a transação antes de ler.

## 5. Notas de release (FR-006a, AC-29) — duas opções (Q1 pendente no Gate 2)

O texto da mudança é o mesmo nas duas opções; muda só onde ele entra.

**Opção A (recomendada, bump major)** — assunto `feat(state)!: Compacta o estado de .maker num lockfile`
e o texto abaixo como rodapé `BREAKING CHANGE:` → entra em "⚠ BREAKING CHANGES" do `CHANGELOG.md` e das
release notes.

**Opção B (sem major)** — assunto `feat(state): Compacta o estado de .maker num lockfile`; o mesmo texto
(sem o prefixo `BREAKING CHANGE:`) vai no corpo do PR sob `## Notas de release` e é colado pelo
mantenedor nas release notes do Release PR antes do merge. Não persiste no `CHANGELOG.md`.

Texto (opção A mostrada com o prefixo):

```
BREAKING CHANGE: o formato padrão das bases passa a ser "pack": o manifest e as bases ficam num único
arquivo, .maker/maker.lock, e o próximo maker update migra installs existentes sem formato declarado
(.maker/manifest.json e .maker/bases/ deixam de existir). Para manter as bases por arquivo, declare
"state": { "bases": "files" } em maker.config.json antes do update. Atualize o maker em todo o time e
na CI antes de migrar: versões anteriores não leem o lockfile (param sem escrever), e
"maker init --force" de versões anteriores reinstalaria por cima.
```
