<!-- plan-depth: MINI -->

# Tasks — CI de PR via GitHub Actions (`002-github-actions-ci`)

> **MINI** (Gate 1 e Gate 2 fundidos, PR2). Sem `plan.md`/`data-model.md`/`contracts/` — feature de
> infraestrutura/tooling headless. O deliverable é **um** arquivo de workflow declarativo + a decisão
> de build-scripts do pnpm em config versionada.
>
> **Teste de isolamento/segurança: não aplicável** — o maker é uma CLI headless sem separação de
> dados por cliente nem controle de acesso por papel; a constitution/`project-rules` não declara
> regra de isolamento que exija prova E2E. (Constitution: sem base de "banco"/multi-tenant.)

## Decomposição e paralelismo

As três US da spec (US1 P1, US2 P1, US3 P2) são **facetas do mesmo arquivo único**
(`.github/workflows/ci.yml`) mais a decisão de build-scripts. **Não são paralelizáveis** — compartilham
100% dos arquivos. Colapsam num único deliverable atômico, **1 dev slot, sequencial**. Um único brief
consolidado cobre os ACs das três US: `briefs/US-1.md`.

## Decisão de arquitetura fixada (build-scripts / `ERR_PNPM_IGNORED_BUILDS`)

Forma canônica **única** (elimina a contradição hoje existente entre os dois arquivos):

1. **Commitar** `pnpm-workspace.yaml` (hoje untracked) com:
   ```yaml
   allowBuilds:
     esbuild: false
   ```
2. **Remover** o bloco `pnpm.onlyBuiltDependencies: ["esbuild"]` de `package.json` — sob pnpm 11 o
   `allowBuilds` do `pnpm-workspace.yaml` é a fonte de verdade; manter os dois é declaração
   contraditória (um permite, o outro nega) e config morta/enganosa.

Verificações que sustentam a decisão (rodadas neste worktree, pnpm 11.1.2 / Node 22):
- `pnpm build/test/audit:coupling` verdes com `allowBuilds: esbuild: false`; o binário do esbuild
  (0.27.7) roda **sem** precisar do build-script (a native binary vem via optional dep de plataforma).
- `pnpm-lock.yaml` (`settings:` só tem `autoInstallPeers`/`excludeLinksFromLockfile`) **não** codifica
  a decisão de build-scripts → mexer em `onlyBuiltDependencies`/`allowBuilds` **não suja o lockfile**
  → `--frozen-lockfile` permanece válido no runner.

## Tasks (dependency-ordered — 1 dev slot, sequencial)

`[US-1+2+3 — tooling/CI · single-file · non-parallel]`

- [ ] **T001 — Fixar a decisão de build-scripts em config versionada** (FR-013, FR-010, US2-AC4)
  - Adicionar `pnpm-workspace.yaml` ao versionamento com `allowBuilds: esbuild: false` (conteúdo exato acima).
  - Remover o bloco `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }` de `package.json`.
  - **Depende de nada.** Precede T002: o install do CI depende dessa decisão ser determinística.
  - Verificar: `git diff --exit-code pnpm-lock.yaml` (lockfile intacto após a mudança).

- [ ] **T002 — Criar `.github/workflows/ci.yml`** (FR-001..FR-009, FR-011, US1, US2, US3)
  - Gatilhos: `pull_request` (todos) + `push` em `main`.
  - Concorrência: `cancel-in-progress` **só** para `pull_request`; runs da `main` não se cancelam.
  - Job único `name: verify` (nome de status check ESTÁVEL, não derivado de matriz — SC-006/FR-009).
  - `runs-on: ubuntu-latest`; sem secrets, sem publish/deploy.
  - Setup: `pnpm/action-setup` com versão **pinada** → `actions/setup-node` (Node único ≥18) com
    `cache: pnpm` → `pnpm install --frozen-lockfile`.
  - 4 steps **separados**, ordem canônica fail-fast: `build` → `typecheck` → `test` → `audit:coupling`.
    Cada um `run: pnpm <script>` — **nunca** `&&` num step só, nunca tsup/tsc/vitest/node crus (PR4/FR-004).
  - Layout exato no brief `briefs/US-1.md`.

- [ ] **T003 — Verificar determinismo local (fidelidade ao verify)** (SC-002..SC-005, US2-AC2/3/4)
  - `rm -rf node_modules && pnpm install --frozen-lockfile` → **sem** `ERR_PNPM_IGNORED_BUILDS`.
  - `git diff --exit-code pnpm-lock.yaml` (lockfile não sujo pelo install).
  - `pnpm build && pnpm typecheck && pnpm test && pnpm audit:coupling` → 4 verdes.

- [ ] **T005 — Ruleset versionado da `main` + reminder de build** (pedido do Gate 1/2; FR-009)
  - Criar `.github/rulesets/main.json` (conteúdo exato no brief §Adendo B): required check `verify`,
    PR obrigatório (0 aprovações), bloqueio de deletion/force-push, **sem** linear history (CONTRIBUTING §3),
    bypass do admin.
  - Criar `.github/rulesets/README.md` (como importar/aplicar via UI ou `gh api`).
  - Incluir o comentário-reminder do `ERR_PNPM_IGNORED_BUILDS` no `pnpm-workspace.yaml` (brief §Adendo A).
  - Aplicar no repo real é ação administrativa fora do commit — o arquivo é a fonte versionada.

- [ ] **T004 — Checar escopo de artefato do commit** (FR-012, CONTRIBUTING §4)
  - `git status` / `git add` conscientes: staged = **apenas** `.github/workflows/ci.yml`,
    `.github/rulesets/main.json`, `.github/rulesets/README.md`, `pnpm-workspace.yaml`,
    `package.json` (edit) e `specs/002-github-actions-ci/spec.md` (Tier 3).
  - Confirmar que o commit **não** arrasta pipeline gitignorado: `git ls-files` não deve listar
    `.claude/skills`, `.claude/agents`, `.specify` stock, nem `.maker/`.

## Rastreabilidade FR/SC → task

| Requisito | Task |
|---|---|
| FR-001 gatilhos PR+push main | T002 |
| FR-002 ordem canônica / FR-003 fail-fast | T002 |
| FR-004 via script de projeto (PR4) | T002 |
| FR-005 não altera lógica dos scripts | T002 |
| FR-006 pnpm + Node ≥18 (versão única) | T002 |
| FR-007 frozen-lockfile | T002, T003 |
| FR-008 cache pnpm | T002 |
| FR-009 / SC-006 status check nome estável | T002 |
| FR-010 zero deps runtime novas | T001 |
| FR-011 sem secrets/serviços/publish | T002 |
| FR-012 artefato Tier 3 em `main` | T004 |
| FR-013 build-scripts em config versionada | T001 |
| SC-001..SC-004 verde/vermelho + ordem | T002, T003 (prova final: PR real de teste) |
| SC-005 diff mínimo | T001, T004 |
