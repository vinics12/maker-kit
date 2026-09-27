# Contrato — Arquivos de controle do git gerenciados (dentro de `.maker`)

Donos: US-2 (templates, B1, B2) e US-4 (skill `maker-update`, provas com git, contagem). Templates do engine (P3): viram arquivos gerenciados comuns no manifest, criados por
`init` e por `update` em installs existentes, com merge 3-way e preservação de customização
(FR-029, AC-23). Nenhum arquivo de controle do git fora de `.maker` é criado ou alterado (FR-030).

## `templates/engine/common/.maker/.gitattributes` → `.maker/.gitattributes`

```
# Bases de reconciliação do maker: sem conversão de fim de linha (o hash tem de conferir byte a byte)
# e marcadas como geradas (colapsadas no diff do PR).
maker.lock -text diff merge=text linguist-generated=true
bases/** -text linguist-generated=true
```

- `-text` → FR-027(a) e AC-20 (autocrlf não converte).
- `diff`, `merge=text` → o lockfile é sempre diffado/mesclado como texto, mesmo com bytes NUL em bases
  `utf8` (sem isso o git o trataria como binário e o merge viraria conflito de arquivo inteiro).
- `linguist-generated=true` → FR-027(b) e AC-22.

## `templates/engine/common/.maker/.gitignore.hbs` → `.maker/.gitignore`

```
# Temporários do maker: nunca versionar.
/transactions/
/transaction.lock
/mediation/
/runs/
```

- Nome `.gitignore.hbs` porque o `npm pack` não inclui arquivos chamados `.gitignore`; o `.hbs` é
  renderizado (sem placeholders) e perde a extensão.
- Cobre FR-028 e AC-21 (journal de transações, lock, exports de mediação no diretório padrão, runs).

## Mediação e arquivos pré-existentes (US-2)

- **B1**: `isMediablePath` (`src/commands/mediation.ts`) aceita exatamente `GIT_CONTROL_FILES`
  (`.maker/.gitattributes`, `.maker/.gitignore`), rastreados ou não. Continuam recusados
  `.maker/manifest.json`, `.maker/maker.lock`, `.maker/bases/**`, `.maker/addons/*.json` e qualquer outro
  `.maker/*` fora de `.maker/workflow/`.
- **B2**: no `update`, se um desses caminhos já existe **sem entrada no manifest**: conteúdo idêntico ao
  upstream → passa a ser rastreado (entrada + base); diferente → `preserve` +
  mediação `local-edit` com motivo `arquivo pré-existente não rastreado pelo maker` (base nula). Nunca
  sobrescrito. Aplicar a proposta mediada registra a entrada com `baseHash` do upstream.
- **Skill**: `templates/engine/workflow/skills/maker-update/SKILL.md` (Hard rules) passa a listar
  `.maker/maker.lock` entre os arquivos que o agente nunca edita (US-4).

## Provas (US-4)

| Prova | Teste |
|---|---|
| AC-20: autocrlf=true, commit, clone novo → bases conferem e doctor verde (files e pack) | `test/state/git-interop.test.ts` |
| AC-21: `git status --porcelain --untracked-files=all` não lista temporários | idem |
| AC-22: `git check-attr linguist-generated -- .maker/maker.lock .maker/bases/<h>` = `set` | idem |
| AC-40: merge de duas branches → sem conflito, doctor verde, para: entradas distintas não adjacentes; entradas **adjacentes** na ordem de caminho; inserção de campo novo numa entrada × edição da vizinha; inserção de unidade `file` nova × edição da vizinha | idem |
| AC-23 / FR-029: edição local no `.maker/.gitignore` preservada/mesclada pelo update; update cria os dois em install existente | `test/commands/update.gitcontrol.test.ts` |
| B1/B2: arquivo pré-existente não rastreado preservado + mediado; proposta via `--apply-resolutions` aplicada; metadados continuam recusados | `test/commands/mediation.pack.test.ts`, `test/commands/update.pack.test.ts` (US-2) |
| FR-030: `.gitattributes` de raiz com o mesmo conteúdo de antes; nenhum `.gitignore` de raiz criado | idem |
| Empacotamento: os dois templates presentes no tarball | `scripts/package-smoke.mjs` |
