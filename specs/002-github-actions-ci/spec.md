# Feature Specification: CI de PR via GitHub Actions

**Feature Branch**: `002-github-actions-ci`
**Created**: 2026-09-11
**Status**: Draft
**Input**: User description: "CI de PR via GitHub Actions para o maker — todo PR (e push na branch default) dispara um workflow que roda a chain de verify do projeto e bloqueia o merge se qualquer etapa falhar."

## Contexto

Hoje o repositório do `maker` **não tem `.github/`** — nenhuma automação valida PRs. O único
enforcement da chain de verify (`pnpm build` → `pnpm typecheck` → `pnpm test` → `pnpm audit:coupling`)
é disciplina humana rodando o verify local antes de abrir PR. O gap está registrado em
`CONTRIBUTING.md §6` ("Gaps conhecidos") e no Backlog do README (`#roadmap`).

Esta feature adiciona um workflow de CI que reproduz **exatamente** a chain de verify em cada Pull
Request e em cada push na branch default, tornando o resultado do verify um sinal objetivo e
bloqueante do merge — sem depender da lembrança de cada contribuidor.

É uma feature de **infraestrutura/tooling, headless, sem UI**. O artefato entregue é o(s) arquivo(s)
de workflow (e, se necessário, ajuste mínimo de config já existente no worktree), não código de
runtime do CLI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - PR quebrado é reprovado e bloqueia merge (Priority: P1)

Um contribuidor abre um Pull Request cujo código quebra **qualquer** etapa do verify (build,
typecheck, testes ou auditoria de acoplamento). O workflow de CI dispara automaticamente, executa a
chain na ordem canônica, para na primeira etapa que falha e reporta o job como vermelho. O status
check fica visível no PR, permitindo que a branch protection rule bloqueie o merge.

**Why this priority**: É o coração da feature — sem reprovar o PR quebrado, o CI não agrega
enforcement algum sobre a disciplina humana que já existe. Entrega o valor central sozinha.

**Independent Test**: Abrir um PR contra `main` com uma quebra deliberada em cada uma das quatro
etapas (uma por vez) e observar que o workflow fica vermelho e que a etapa falha é a esperada,
enquanto as posteriores não chegam a rodar.

**Acceptance Scenarios**:

1. **Given** um PR com erro de compilação de tipos, **When** o workflow dispara, **Then** o step
   `pnpm typecheck` falha, o job termina vermelho e o status check aparece como "failed" no PR.
2. **Given** um PR com um teste vitest quebrado, **When** o workflow dispara, **Then** o step
   `pnpm test` falha e o job termina vermelho.
3. **Given** um PR que introduz vazamento de termo de negócio em `templates/engine/`, **When** o
   workflow dispara, **Then** o step `pnpm audit:coupling` falha e o job termina vermelho.
4. **Given** um PR com erro que quebra o `pnpm build` (tsup), **When** o workflow dispara, **Then** o
   step de build falha, o job termina vermelho e **nenhum step posterior** (`typecheck`, `test`,
   `audit:coupling`) é executado (fail-fast).

---

### User Story 2 - PR limpo é aprovado reproduzindo o verify local (Priority: P1)

Um contribuidor abre um PR cujo código passa no verify local. O workflow dispara, executa as quatro
etapas na ordem e todas passam, resultando em job verde. O resultado do CI reproduz **fielmente** o
que o contribuidor observou rodando o verify na própria máquina — mesmo package manager (pnpm),
versão de Node compatível com `engines.node` (>=18) e install com lockfile congelado.

**Why this priority**: A fidelidade ao verify local é o que dá confiança no sinal. Um CI que passa
quando o local falha (ou vice-versa) é pior que nenhum CI. É P1 junto com US1 — as duas formam o par
mínimo verde/vermelho.

**Independent Test**: Abrir um PR com a branch em estado limpo (verify local verde) e observar que o
workflow termina verde, com os quatro steps concluídos com sucesso na ordem canônica.

**Acceptance Scenarios**:

1. **Given** um PR cuja branch passa em `pnpm typecheck && pnpm test && pnpm audit:coupling` (mais
   `pnpm build`) localmente, **When** o workflow dispara, **Then** os quatro steps concluem com
   sucesso e o job termina verde.
2. **Given** o ambiente do runner, **When** o install de dependências roda, **Then** ele usa pnpm com
   lockfile congelado (frozen-lockfile) e falha se o lockfile estiver desatualizado em relação ao
   `package.json`.
3. **Given** o ambiente do runner, **When** o Node é provisionado, **Then** a versão satisfaz
   `engines.node` (>=18).
4. **Given** o build-script do esbuild sob pnpm, **When** os steps `build`/`test`/`audit:coupling`
   rodam, **Then** eles concluem sem erro `ERR_PNPM_IGNORED_BUILDS`, porque a decisão de build-scripts
   está declarada em config versionada no repo (ver Assumptions).

---

### User Story 3 - Push na branch default é validado (Priority: P2)

Além dos PRs, todo push na branch default (`main`) — por exemplo o merge commit de um PR — dispara o
mesmo workflow, produzindo um histórico verde/vermelho da própria `main`.

**Why this priority**: Garante que o estado de `main` permaneça validado mesmo após merges, e cobre o
caso de commits que cheguem à default por caminhos que não passam por PR. Complementar ao par P1.

**Independent Test**: Fazer um push (ou merge) na `main` e observar que o workflow dispara e reporta o
resultado da chain de verify para aquele commit.

**Acceptance Scenarios**:

1. **Given** um commit chegando à branch default, **When** o push ocorre, **Then** o workflow dispara
   e executa a mesma chain de verify na mesma ordem.

---

### Edge Cases

- **Lockfile desatualizado**: se o `pnpm-lock.yaml` não bate com `package.json`, o install com
  frozen-lockfile falha explicitamente — o PR fica vermelho antes mesmo do build (previne "funciona na
  minha máquina" com deps divergentes).
- **Cache de dependências frio vs. quente**: com cache vazio (primeira execução) ou cache válido, o
  resultado das quatro etapas deve ser idêntico — o cache afeta só o tempo, nunca o veredito.
- **Runs redundantes no mesmo PR**: novos pushes no mesmo PR não devem deixar execuções obsoletas
  competindo pelo status final (ver Assumptions sobre concorrência).
- **Falha de infraestrutura do runner** (indisponibilidade da rede de download de deps, etc.):
  distinta de falha do código; não é escopo desta feature "tratar" essas falhas além do
  comportamento padrão do provedor de CI — elas aparecem como job com erro, não como aprovação.
- **Ausência de secrets**: o workflow não consome secrets nem serviços externos; deve rodar
  identicamente em fork PRs onde secrets não estão disponíveis.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O repositório MUST conter um workflow de CI sob `.github/workflows/` que dispara
  automaticamente em eventos de `pull_request` e em `push` para a branch default (`main`).
- **FR-002**: O workflow MUST executar as quatro etapas de verify **na ordem canônica**: (1)
  `pnpm build`, (2) `pnpm typecheck`, (3) `pnpm test`, (4) `pnpm audit:coupling`.
- **FR-003**: O workflow MUST ser **fail-fast**: qualquer etapa que retorne código de erro reprova o
  job e **impede** a execução das etapas seguintes.
- **FR-004**: O workflow MUST invocar cada etapa por meio do **script de projeto correspondente**
  (`pnpm build`/`typecheck`/`test`/`audit:coupling`), nunca reimplementando ou chamando a ferramenta
  crua por baixo (tsup/tsc/vitest/node) diretamente no CI. (Constitution PR4.)
- **FR-005**: O workflow MUST NOT alterar a lógica dos scripts de verify — apenas orquestrá-los. O
  veredito do CI deve derivar exclusivamente do resultado desses scripts.
- **FR-006**: O ambiente do runner MUST usar **pnpm** como package manager e uma versão de **Node que
  satisfaça `engines.node` (>=18)**.
- **FR-007**: O install de dependências MUST usar **lockfile congelado** (frozen-lockfile), falhando se
  o lockfile divergir do `package.json`.
- **FR-008**: O workflow MUST habilitar **cache de dependências do pnpm** para reduzir tempo de
  execução, sem que o cache altere o veredito das etapas.
- **FR-009**: O workflow MUST expor um **status check com nome estável** no PR, adequado para ser
  configurado como *required check* nas branch protection rules do repositório.
- **FR-010**: A feature MUST NOT introduzir nenhuma **dependência de runtime nova**. A mudança se
  restringe ao(s) arquivo(s) de workflow e, se necessário, a ajuste mínimo de config já existente no
  worktree (decisão de build-scripts do pnpm).
- **FR-011**: O workflow MUST NOT depender de serviços externos, secrets, nem executar qualquer etapa
  de publish/deploy. O escopo é **validação de PR** apenas.
- **FR-012**: O(s) arquivo(s) `.github/workflows/*.yml` MUST viver em `main` como artefato durável
  (Tier 3 da política de artefatos, `CONTRIBUTING.md §4`) — diferente do pipeline regenerável em
  `.claude/` e `.specify/`, que é gitignorado.
- **FR-013**: A decisão de build-scripts do pnpm que evita `ERR_PNPM_IGNORED_BUILDS` no runner MUST
  estar declarada em config **versionada** no repo, commitada junto com o workflow, para que o CI
  reproduza deterministicamente o verify local.

### Key Entities

Não há entidades de dados. O artefato central é o **workflow de CI** (arquivo declarativo) e o
**status check** que ele expõe no PR.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos PRs abertos contra `main` disparam o workflow automaticamente (nenhum PR fica
  sem status check de CI).
- **SC-002**: Um PR que quebra qualquer uma das quatro etapas resulta em job vermelho em 100% dos
  casos — não existe combinação de quebra em que o CI reporte verde.
- **SC-003**: Um PR cuja branch passa no verify local (as quatro etapas verdes) resulta em job verde,
  reproduzindo o mesmo veredito observado localmente.
- **SC-004**: A ordem observada dos steps no log do CI é exatamente `build → typecheck → test →
  audit:coupling`, e uma falha em qualquer step deixa os posteriores como "não executados".
- **SC-005**: O diff da feature em `main` contém somente arquivo(s) de workflow e, no máximo, o ajuste
  mínimo de config de build-scripts — zero dependências de runtime novas em `package.json`.
- **SC-006**: O status check exposto tem nome estável entre execuções, permitindo selecioná-lo como
  required check nas branch protection rules sem reconfiguração a cada run.

## Assumptions

- **Clarificação — versão de Node**: o runner usa uma **única** versão de Node LTS que satisfaz
  `engines.node` (>=18), não uma matriz de versões. Um único status check estável é preferível ao
  custo e à instabilidade de nome de uma matriz; matriz fica como evolução futura fora deste escopo.
- **Clarificação — concorrência**: execuções redundantes no mesmo PR (pushes sucessivos na mesma
  ref) devem ser **canceladas em favor da mais recente**, para economizar minutos e evitar status
  obsoleto. Execuções da branch default não são canceladas entre si.
- **Clarificação — habilitar o required check**: **expor** o status check é escopo desta feature;
  **tornar** o check obrigatório é uma configuração de repositório (branch protection rules), ação
  administrativa que **não** é um arquivo commitável e fica **fora** do escopo de entrega — a feature
  apenas garante que o check exista e tenha nome estável para poder ser marcado como required.
- **Clarificação — decisão de build-scripts**: já existe no worktree um `pnpm-workspace.yaml`
  (untracked) com `allowBuilds: esbuild: false`, que neutraliza o `ERR_PNPM_IGNORED_BUILDS` observado
  com pnpm 11 (o "deps status check" derrubando `build/test/audit`). Esse arquivo será **commitado
  junto com o workflow** como o ajuste mínimo de config previsto — é config de build, não dependência
  de runtime nova. A forma exata de declarar essa decisão é decisão de implementação (architect).
- **Clarificação — fail-fast**: "falhar o job em qualquer erro" significa parar na primeira etapa que
  retornar código de erro; as etapas posteriores não rodam.
- A branch default do repositório é `main`.
- O CI roda em runner Linux padrão do provedor (GitHub-hosted), suficiente para uma CLI Node headless
  sem serviços a subir.
- O `pnpm-lock.yaml` versionado está sincronizado com o `package.json` no momento do merge desta
  feature (pré-requisito do frozen-lockfile).

## User Journey

Ordenada por dependência (do disparo à decisão de merge):

1. **Contribuidor abre PR** (ou faz push na `main`) → o evento `pull_request`/`push` dispara o
   workflow automaticamente.
2. **Provisionamento do ambiente** → runner com Node compatível (`engines.node` >=18) e pnpm.
3. **Install determinístico** → pnpm com frozen-lockfile + cache de dependências; falha aqui já
   reprova o job (lockfile divergente).
4. **Chain de verify fail-fast** → `pnpm build` → `pnpm typecheck` → `pnpm test` →
   `pnpm audit:coupling`, parando na primeira falha.
5. **Status check publicado no PR** → verde se todas as etapas passaram, vermelho caso contrário; nome
   estável.
6. **Decisão de merge** → com o status configurado como required (ação administrativa, fora do
   escopo), o merge é bloqueado enquanto o check estiver vermelho.

## Cobertura da Constitution & Regras do Projeto

- **PR4 — Comando via Script Entry Point (NON-NEGOTIABLE)**: honrado por **FR-004** — o CI invoca
  `pnpm build/typecheck/test/audit:coupling`, nunca a ferramenta crua (tsup/tsc/vitest). A superfície
  de contribuidor (os scripts) é a mesma no local e no CI.
- **PR1 / PR2 — Specs são verdade / Gates obrigatórios**: o CI é **complemento** de enforcement
  mecânico, não substituto dos 4 gates humanos. Não valida ACs de features (isso é do `pm-validator`
  no Gate 4); valida a chain de verify. A própria feature passa pelos 4 gates.
- **P1 — Sem shell-out**: aplica-se ao código do CLI (`src/`), não ao workflow declarativo; o CI
  apenas executa `test/runs/no-shellout.test.ts` (via `pnpm test`) e `pnpm audit:coupling`, reforçando
  P1/P2 em cada PR ao invés de introduzir shell-out no motor.
- **P2 — Motor agnóstico de negócio**: preservado — `pnpm audit:coupling` roda no CI e reprova
  vazamento de termos de negócio em `templates/engine/`.
- **Política de artefatos (`CONTRIBUTING.md §4`)**: honrado por **FR-012** — o workflow é Tier 3
  (durável, vive em `main`), distinto do pipeline regenerável gitignorado.
