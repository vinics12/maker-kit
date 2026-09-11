# Brief US-1 (consolidado US1+US2+US3) — CI de PR via GitHub Actions

`[tooling/CI · single-file · non-parallel · 1 dev slot]`

> Brief autocontido. As três US da spec colapsam neste único deliverable porque tudo vive em
> `.github/workflows/ci.yml` + a decisão de build-scripts. Implemente T001→T004 em ordem.

## Objetivo

Adicionar um workflow de CI que reproduz **exatamente** a chain de verify do projeto em cada PR e em
cada push na `main`, tornando o veredito do verify um status check bloqueante — sem depender da
disciplina de rodar o verify local.

## Contexto necessário

- O repo **não tem `.github/`** hoje. Nenhuma automação valida PRs.
- Chain de verify canônica (a mesma do local, CONTRIBUTING §5): `pnpm build` → `pnpm typecheck` →
  `pnpm test` → `pnpm audit:coupling`.
- Scripts existentes em `package.json`: `build` (tsup), `typecheck` (tsc --noEmit), `test`
  (vitest run), `audit:coupling` (node scripts/audit-coupling.mjs). **Invoque sempre via `pnpm <script>`**
  (PR4) — nunca a ferramenta crua.
- `engines.node: ">=18"`. Ambiente de referência do dev: pnpm 11.1.2, Node 22.
- `pnpm-lock.yaml` existe e está sincronizado (pré-requisito do frozen-lockfile).

## Decisão de build-scripts (T001) — FIXADA, não reabrir

Existe hoje uma **contradição**: `package.json` tem `pnpm.onlyBuiltDependencies: ["esbuild"]` (permite
o build-script) e o worktree tem `pnpm-workspace.yaml` untracked com `allowBuilds: esbuild: false`
(nega). Forma canônica única a commitar:

1. Versionar `pnpm-workspace.yaml` com **exatamente**:
   ```yaml
   allowBuilds:
     esbuild: false
   ```
2. Remover de `package.json` o bloco inteiro:
   ```json
   "pnpm": {
     "onlyBuiltDependencies": [
       "esbuild"
     ]
   }
   ```

Por quê: sob pnpm 11 o `allowBuilds` do `pnpm-workspace.yaml` é a fonte de verdade da decisão de
build-scripts; declarar o oposto em dois lugares é não-determinístico. O binário do esbuild roda sem o
build-script (native binary via optional dep), então `esbuild: false` mantém `build/test/audit` verdes
e silencia `ERR_PNPM_IGNORED_BUILDS`. O `pnpm-lock.yaml` **não** codifica essa decisão (o `settings:`
só tem `autoInstallPeers`/`excludeLinksFromLockfile`), então a mudança **não suja o lockfile** e o
`--frozen-lockfile` continua válido. É config de build, **não** dependência de runtime nova (SC-005).

## `.github/workflows/ci.yml` (T002) — layout de referência

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  verify:
    name: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.2

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: build
        run: pnpm build

      - name: typecheck
        run: pnpm typecheck

      - name: test
        run: pnpm test

      - name: audit:coupling
        run: pnpm audit:coupling
```

Restrições que o layout satisfaz (não desviar sem retornar ao gate):
- **Nome de status check estável** = `verify` (job `name:` fixo, sem matriz, sem variáveis) → pode
  virar required check sem reconfiguração a cada run (FR-009/SC-006).
- **4 steps separados** na ordem `build → typecheck → test → audit:coupling`; a Action para no
  primeiro exit≠0 (fail-fast nativo) e marca os posteriores como não executados (FR-002/FR-003/SC-004).
  **Não** encadear com `&&` num step só (esconderia qual etapa falhou).
- **Cada etapa via `pnpm <script>`** (PR4/FR-004) — nunca tsup/tsc/vitest/node crus.
- `pnpm/action-setup` **antes** de `setup-node` (o `cache: pnpm` precisa do pnpm já disponível).
- Versão de pnpm **pinada** (`11.1.2`) e Node **único** (`22`, satisfaz `engines.node >=18`) — sem
  matriz (Assumption da spec: um único check estável > custo/instabilidade de nome de matriz).
- `--frozen-lockfile` (FR-007) + `cache: pnpm` (FR-008, não altera veredito).
- Concorrência: `cancel-in-progress` só em `pull_request`; pushes na `main` não se cancelam entre si
  (Assumption). O `group` por `github.ref` isola por branch/PR.
- Sem `secrets`, sem `env` externo, sem publish/deploy (FR-011); roda igual em fork PRs.

> Node 22 espelha o ambiente local do dev; 20 (LTS) também satisfaz `engines`. Mantenha **uma** versão.

## Runbook (T003 — verificação de determinismo local)

```bash
rm -rf node_modules
pnpm install --frozen-lockfile          # NÃO deve imprimir ERR_PNPM_IGNORED_BUILDS
git diff --exit-code pnpm-lock.yaml     # lockfile intacto (esperado: sem diff)
pnpm build && pnpm typecheck && pnpm test && pnpm audit:coupling   # 4 verdes
```

## Escopo de artefato do commit (T004) — FR-012 / CONTRIBUTING §4

O deliverable vive em `main` (Tier 3). Antes de commitar:
```bash
git status                # staged deve ser só os arquivos de "Tocar SOMENTE"
git ls-files | grep -E '^\.claude/(skills|agents)|^\.maker/' && echo "VAZOU PIPELINE" || echo "ok"
```
Não arrastar pipeline gitignorado (`.claude/skills`, `.claude/agents`, `.specify` stock, `.maker/`).

## Critérios de aceitação (ACs das 3 US)

**US1 — PR quebrado reprova (fail-fast):**
- AC1: PR com erro de tipos → step `typecheck` falha, job vermelho, check "failed" no PR.
- AC2: PR com teste vitest quebrado → step `test` falha, job vermelho.
- AC3: PR com vazamento de termo de negócio em `templates/engine/` → step `audit:coupling` falha.
- AC4: PR que quebra o `build` (tsup) → step `build` falha e **nenhum** step posterior roda.

**US2 — PR limpo aprova reproduzindo o verify local:**
- AC1: branch que passa no verify local → 4 steps concluem, job verde.
- AC2: install usa pnpm `--frozen-lockfile`; falha se o lockfile divergir do `package.json`.
- AC3: Node provisionado satisfaz `engines.node >=18`.
- AC4: `build`/`test`/`audit:coupling` rodam **sem** `ERR_PNPM_IGNORED_BUILDS` porque a decisão de
  build-scripts está em config versionada (T001).

**US3 — push na `main` é validado:**
- AC1: commit chegando à `main` (ex.: merge commit) dispara o mesmo workflow, mesma chain, mesma ordem.

> SC-001..SC-004 (100% dos PRs disparam; nenhuma combinação de quebra reporta verde; ordem observada
> no log; posteriores como "não executados") são provados por um **PR de teste real** com quebra
> deliberada em cada etapa — parte da validação de aceite (Gate 3/4), não commitável na feature.

## Adendo do Gate 1/2 (pedido do humano) — reminder de build + rulesets

**A) Reminder do erro de build (T001).** Ao versionar `pnpm-workspace.yaml`, incluir um comentário
explicando o PORQUÊ (PR5 — restrição não-óbvia justificada), para que ninguém "conserte" o arquivo no
futuro reintroduzindo o erro. Conteúdo exato:

```yaml
# esbuild traz seu binário nativo via optional dep de plataforma — não precisa do build-script
# (postinstall). Sob pnpm 11 o "deps status check" trata build-scripts ignorados como ERRO e derruba
# `pnpm build/test/audit` (e o CI) com ERR_PNPM_IGNORED_BUILDS. Declarar esbuild:false aqui é a decisão
# canônica: silencia o erro sem rodar o postinstall. NÃO reintroduza pnpm.onlyBuiltDependencies no
# package.json — declarar a decisão em dois lugares é contraditório sob pnpm 11.
allowBuilds:
  esbuild: false
```

**B) Ruleset versionado da `main` (T005 — novo).** Criar `.github/rulesets/main.json` — definição de
GitHub Repository Ruleset importável (Settings → Rules → Rulesets → Import), tornando o status check
`verify` um required check e protegendo a `main`. Regras **ideais alinhadas ao CONTRIBUTING §3**
(merge commit preservado ⇒ **sem** exigir linear history). Conteúdo exato:

```json
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "verify" }
        ]
      }
    }
  ],
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ]
}
```

Notas de decisão (não reabrir sem retornar ao gate):
- **`required_status_checks: verify`** casa com o `name:` do job do `ci.yml` (fonte única do nome estável, FR-009/SC-006).
- **`pull_request` com 0 aprovações**: exige que mudanças na `main` passem por PR (logo, pelo CI) sem
  travar um mantenedor solo (GitHub bloqueia auto-aprovação; exigir ≥1 review locaria o dono). Suba
  para 1 quando o repo tiver ≥2 mantenedores.
- **`deletion` + `non_fast_forward`**: proíbem apagar a `main` e force-push — proteções baratas e sem downside.
- **SEM linear history**: CONTRIBUTING §3 manda mergear por **merge commit** (preserva os commits da
  feature); `allowed_merge_methods` mantém os três, com merge disponível.
- **`bypass_actors` = RepositoryRole 5 (admin) `always`**: evita lockout do dono; o enforcement recai
  sobre o fluxo normal, não sobre a emergência do admin.
- Aplicar o ruleset no repo real é ação administrativa (Settings) — **fora** do commit; o arquivo é a
  fonte versionada e o `.github/rulesets/README.md` explica como importar/aplicar via `gh`.

Criar também `.github/rulesets/README.md` curto: o que o ruleset faz, como importar pela UI e como
aplicar por API:
```bash
gh api -X POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json
```

## Tocar SOMENTE

```
.github/workflows/ci.yml          (novo)
.github/rulesets/main.json        (novo — ruleset da main)
.github/rulesets/README.md        (novo — como aplicar o ruleset)
pnpm-workspace.yaml               (untracked → versionado; conteúdo + comentário fixados em T001/adendo)
package.json                      (remover apenas o bloco "pnpm")
```

Não tocar `pnpm-lock.yaml` (deve permanecer idêntico), `src/**`, `templates/**`, `test/**`, nem
qualquer script de verify (FR-005: o CI só orquestra, não altera a lógica).
