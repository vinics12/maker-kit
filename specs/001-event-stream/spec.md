# Feature Specification: Event Stream do pipeline

**Feature Branch**: `001-event-stream`
**Created**: 2026-09-08
**Status**: Draft
**Input**: One-pager `docs/one-pager-event-stream.md` (Fase 1 — substrato + observability). Descrição: o pipeline `/run-spec` do maker é fire-and-forget; não há audit trail do porquê uma feature ficou como ficou, nem visibilidade de custo/tempo, e as decisões de gate — o sinal mais rico do motor — são jogadas fora. Esta feature entrega **um substrato** (event stream append-only por run) e **dois consumidores**: observability (`maker runs`) e captura de decisão de gate (L0/L1).

---

## Contexto e princípio orientador

Não são duas features — é **um substrato e dois consumidores** (one-pager, "Insight que orienta o design"):

- **Substrato**: um event stream append-only por run em `.maker/runs/<run-id>.jsonl` (uma linha JSONL por evento) que o pipeline emite enquanto executa.
- **Consumidor A (observability)**: `maker runs` *lê* o stream e mostra histórico, custo (tokens) e tempo por gate.
- **Consumidor B (learning L0/L1)**: captura da decisão de gate inferida do diff do artefato, e agregação de padrões simples de rejeição.

**Consequência de ordem**: a entrega load-bearing é **o schema do evento** — todo o resto pendura nele.

Esta é observability **do pipeline** (`/run-spec`), **não** do app-alvo (isso é o add-on `observability` do backlog — ver Não-metas).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pipeline emite o event stream de um run (Priority: P1)

Enquanto o `/run-spec` executa, o pipeline grava eventos append-only em `.maker/runs/<run-id>.jsonl`, uma linha JSONL por evento, cobrindo o ciclo de vida do run: início, cada handoff entre agentes, cada decisão de gate e o fim. Cada evento carrega custo (tokens) e tempo (duração) como campos de primeira classe.

**Why this priority**: É o substrato. Sem o schema e a emissão, nenhum consumidor existe. Toda US posterior lê deste artefato. É a única US que, sozinha, já é MVP entregável (o stream vira audit trail mesmo sem `maker runs`).

**Independent Test**: Rodar (ou simular) um run que atravesse `run.start → agent.handoff → gate.decision → run.end`; verificar que `.maker/runs/<run-id>.jsonl` existe, tem uma linha JSONL válida por evento, cada linha valida contra o schema, e cada evento tem `cost.tokens` e `cost.duration_ms`.

**Acceptance Scenarios**:

1. **Given** um run do pipeline iniciando, **When** o run começa, **Then** existe uma linha `type: "run.start"` em `.maker/runs/<run-id>.jsonl` com `run_id`, `ts` (ISO-8601 UTC) e `cost`.
2. **Given** um handoff entre dois agentes, **When** o handoff ocorre, **Then** é anexada uma linha `type: "agent.handoff"` com `actor` (nome do agente), `phase` (∈ spec, plan, dev, review — a fase do pipeline em que aquele trabalho ocorre) e `cost` do trabalho daquele agente.
3. **Given** um gate humano com decisão, **When** o humano aprova/reprova/edita, **Then** é anexada uma linha `type: "gate.decision"` com `gate`, `actor: "human"` e `decision ∈ {approve, reject, edit}`.
4. **Given** um run que termina, **When** o run finaliza, **Then** a última linha é `type: "run.end"` com `cost` acumulado do run.
5. **Given** um arquivo de run já existente, **When** um novo evento é emitido, **Then** ele é **anexado** — nenhuma linha anterior é reescrita, reordenada ou removida (append-only).
6. **Given** cada linha do arquivo, **When** ela é parseada como JSON, **Then** o parse tem sucesso e o objeto valida contra o schema do evento.

---

### User Story 2 - `maker runs` mostra histórico com custo e tempo por gate (Priority: P1)

Um autor de feature roda `maker runs` e vê a lista dos runs registrados em `.maker/runs/`, com custo (tokens) e tempo agregados por run e **por gate visíveis**. É o ganho rápido: muda comportamento antes de qualquer learning.

**Why this priority**: É o consumidor A e o "sinal de sucesso" nº 1 do one-pager (custo/tempo sem instrumentação extra). Depende só do substrato (US1). Independentemente testável a partir de arquivos `.jsonl` de fixture.

**Independent Test**: Com um ou mais `.maker/runs/*.jsonl` de fixture, rodar o comando `runs` da CLI e asseverar que a saída lista cada run e exibe tokens e duração por gate.

**Acceptance Scenarios**:

1. **Given** `.maker/runs/` com N arquivos de run válidos, **When** o comando `runs` roda, **Then** a saída lista os N runs identificados por `run_id`.
2. **Given** um run com eventos em múltiplos gates, **When** o comando `runs` mostra esse run, **Then** exibe tokens e duração **por gate** (spec, plan, dev, review) além do total do run — onde o custo de cada gate é a **soma determinística** do `cost` de todos os eventos daquela fase (handoffs de `phase == <gate>` + a própria `gate.decision`), conforme a regra de agregação de FR-011a.
6. **Given** um `.maker/runs/<run-id>.jsonl` de fixture com três eventos `agent.handoff` de `phase: "plan"` (tokens 100, 200, 300; `duration_ms` 10, 20, 30) e a `gate.decision` do gate `plan` (tokens 0, `duration_ms` 5), **When** o comando `runs` mostra esse run, **Then** a linha do gate `plan` reporta `tokens = 600` e `duration_ms = 65` (soma exata dos eventos de fase `plan`).
3. **Given** `.maker/runs/` inexistente ou vazio, **When** o comando `runs` roda, **Then** sai com código 0 e uma mensagem de "nenhum run registrado" — nunca erro/stack trace.
4. **Given** um arquivo de run cuja última linha está truncada (crash mid-write), **When** o comando `runs` lê esse arquivo, **Then** as linhas íntegras são exibidas e a linha truncada é ignorada sem derrubar o comando.
5. **Given** o comando `runs`, **When** ele lê os arquivos, **Then** nenhuma escrita ou mutação ocorre em `.maker/runs/` (leitura pura).

---

### User Story 3 - Captura de decisão de gate inferida do diff (L0) (Priority: P2)

Em cada gate, o pipeline compara o artefato **antes** e **depois** da intervenção humana, persiste esse diff, e um agente **narra o delta** em linguagem natural. Essa narração vira o `reason_inferred` do evento `gate.decision`. A fricção humana é ≈ zero: o humano não preenche nenhum campo; o motivo é inferido, não digitado.

**Why this priority**: É o consumidor B nível 0 — o sinal de aprendizado do motor. Depende do substrato (US1) e enriquece o `gate.decision`, mas o histórico de custo/tempo (US2) já entrega valor sem ele. Por isso P2.

**Independent Test**: Dado um artefato antes e um depois de uma edição de gate, verificar que um diff é persistido, referenciado em `artifact_diff_ref`, e que `reason_inferred` contém uma narração do delta derivada do diff (não vazia, não campo livre digitado por humano).

**Acceptance Scenarios**:

1. **Given** um artefato de gate editado por um humano, **When** o gate resolve, **Then** um diff antes/depois é persistido sob `.maker/runs/<run-id>/` e o evento `gate.decision` referencia-o em `artifact_diff_ref`.
2. **Given** um diff de gate persistido, **When** o delta é narrado, **Then** `reason_inferred` é uma frase derivada do conteúdo do diff (ex.: "escopo do plano ampliado: +2 endpoints não pedidos na spec").
3. **Given** um gate `approve` sem nenhuma edição de artefato (diff vazio), **When** o gate resolve, **Then** `reason_inferred` reflete "sem alterações" (ou equivalente) e nenhum motivo é inventado.
4. **Given** a captura de gate, **When** o diff antes/depois é computado, **Then** ele é feito **em Node/`fs` puro** — nenhum `git diff`, `diff` ou qualquer subprocesso é invocado (Princípio P1).
5. **Given** `reason_inferred`, **When** ele é preenchido, **Then** vem exclusivamente da inferência sobre o diff — **não** de campo de texto livre digitado pelo humano nem de uma taxonomia fixa de categorias.

---

### User Story 4 - Agregação L1 de padrões de rejeição (Priority: P3)

`maker runs` mostra padrões simples agregados sobre o conjunto de runs — por exemplo, "gate `plan` reprovou em N de M runs". É a leitura de tendência sobre o stream, ainda sem propor mudanças (L2 é fora de escopo).

**Why this priority**: Só tem valor com volume de runs; com poucos runs é ruído (one-pager). Depende de US1+US3 (precisa de `gate.decision` com `decision`). Entrega o segundo sinal de sucesso ("apontar um padrão real após ~10 runs"), mas é o menos urgente.

**Independent Test**: Com M runs de fixture contendo decisões de gate variadas, rodar o comando `runs` e asseverar que ele reporta a contagem de rejeições por gate no formato "N de M".

**Acceptance Scenarios**:

1. **Given** M runs com decisões de gate, **When** o comando `runs` agrega, **Then** exibe, por gate, quantos runs tiveram ao menos uma decisão `reject` (ex.: "gate `plan` reprovou em 3 de 8 runs").
2. **Given** menos de um limiar mínimo de runs, **When** a agregação roda, **Then** ela ainda é exibida corretamente (a decisão de "quando confiar" é do leitor humano; L1 não suprime dados).
3. **Given** a agregação L1, **When** ela é computada, **Then** deriva-se apenas dos eventos já persistidos no stream — nenhuma nova fonte de dado é consultada.

---

### Edge Cases

- **Última linha truncada** (run crashou durante a escrita de um evento): a leitura ignora a linha inválida e não derruba o comando (US2 AC4). Escrita nunca corrompe linhas anteriores (US1 AC5).
- **`.maker/runs/` ausente ou vazio**: `maker runs` sai limpo com mensagem informativa (US2 AC3).
- **Colisão de `run-id`**: dois runs não podem compartilhar arquivo; o `run_id` é único por run e o arquivo é dedicado (ver Suposições). Nunca sobrescreve um run anterior (P3, P5).
- **Gate sem edição** (`approve` sem diff): `reason_inferred` = "sem alterações", nenhum motivo fabricado (US3 AC3).
- **Diff enorme**: o diff é persistido como arquivo referenciado por `artifact_diff_ref`, não embutido inline no evento (mantém a linha JSONL enxuta).
- **Primeiro run não observa a própria construção**: a instrumentação ainda não existe enquanto está sendo construída; esse run é logado **à mão** e vira o primeiro data point + validação do schema (ver Suposições). Isto é premissa/edge-case, **não** um AC de automação.

---

## Requirements *(mandatory)*

### Functional Requirements

**Substrato / schema (US1)**

- **FR-001**: O pipeline MUST gravar eventos em `.maker/runs/<run-id>.jsonl`, uma linha JSONL por evento.
- **FR-002**: A escrita MUST ser **append-only**: cada novo evento é anexado ao fim do arquivo; nenhuma linha existente é reescrita, reordenada ou removida (P3, P5).
- **FR-003**: O sistema MUST emitir os tipos de evento `run.start`, `agent.handoff`, `gate.decision` e `run.end` nos momentos correspondentes do ciclo de vida do run.
- **FR-004**: Cada evento MUST conter, no mínimo, `run_id`, `ts` (ISO-8601 UTC) e `type`.
- **FR-005**: Cada evento MUST conter `cost` com `tokens` (inteiro) e `duration_ms` (inteiro) — custo e tempo são cidadãos de primeira classe.
- **FR-006**: Eventos `gate.decision` MUST conter `gate` (∈ spec, plan, dev, review), `actor` e `decision` (∈ approve, reject, edit).
- **FR-007**: Eventos `agent.handoff` MUST conter `actor` (nome do agente responsável pelo trabalho reportado) e `phase` (∈ spec, plan, dev, review) — a fase do pipeline à qual o custo daquele trabalho é atribuído.
- **FR-007a**: Todo evento cujo `cost` é **atribuível a uma fase** (`agent.handoff` e `gate.decision`) MUST carregar o campo de fase — `phase` no `agent.handoff`, `gate` no `gate.decision` — de modo que o custo de qualquer evento de trabalho seja associável a exatamente um gate de forma determinística. Eventos de nível de run (`run.start`, `run.end`) não são atribuíveis a uma fase e MUST NOT carregar esse campo.
- **FR-008**: Toda linha do arquivo MUST ser JSON válido e MUST validar contra o schema do evento.

**Observability `maker runs` (US2)**

- **FR-009**: O maker MUST expor um subcomando `runs` da própria CLI (P4 / PR4) — nunca um binário externo.
- **FR-010**: `maker runs` MUST listar todos os runs presentes em `.maker/runs/`, identificados por `run_id`.
- **FR-011**: `maker runs` MUST exibir custo (tokens) e tempo (`duration_ms`) **por gate** e o total por run, computados pela regra de agregação de FR-011a.
- **FR-011a** (regra de agregação custo→gate): o custo de um gate `G` MUST ser a **soma** dos campos `cost.tokens` (e, separadamente, `cost.duration_ms`) de **todos** os eventos cuja fase é `G` — isto é, todo `agent.handoff` com `phase == G` mais a `gate.decision` com `gate == G`. A soma MUST ser determinística (independe da ordem de leitura) e derivável exclusivamente das linhas do `.jsonl`. O total do run é a soma sobre todos os eventos do arquivo.
- **FR-012**: `maker runs` MUST ser leitura pura — nenhuma escrita/mutação em `.maker/runs/`.
- **FR-013**: A leitura do stream MUST tolerar uma última linha truncada, ignorando-a sem falhar o comando.
- **FR-014**: Com `.maker/runs/` ausente ou vazio, `maker runs` MUST sair com código 0 e mensagem informativa (nunca stack trace).
- **FR-015**: A leitura do stream MUST ser feita em Node/`fs` puro — sem subprocesso (P1).

**Captura de gate L0 (US3)**

- **FR-016**: Em cada gate, o sistema MUST computar o diff do artefato antes/depois da intervenção humana usando apenas Node/`fs` — **sem** `git diff`/`diff`/subprocesso (P1).
- **FR-017**: O diff MUST ser persistido sob `.maker/runs/<run-id>/` e referenciado no evento `gate.decision` via `artifact_diff_ref`.
- **FR-018**: `reason_inferred` MUST ser derivado da narração do diff, **não** de campo de texto livre digitado pelo humano nem de taxonomia fixa de categorias.
- **FR-019**: Quando não há edição (diff vazio), `reason_inferred` MUST refletir "sem alterações" sem fabricar motivo.
- **FR-020**: A captura MUST impor fricção humana ≈ zero: o humano não preenche nenhum campo do evento.

**Agregação L1 (US4)**

- **FR-021**: `maker runs` MUST reportar, por gate, a contagem de runs com ao menos uma decisão `reject`, no formato "N de M runs".
- **FR-022**: A agregação L1 MUST derivar apenas dos eventos já persistidos no stream — nenhuma fonte externa.

**Integridade e princípios**

- **FR-023**: Nenhuma operação desta feature MUST sobrescrever ou corromper um run anterior (P3, P5).
- **FR-024**: Nenhum código desta feature MUST usar `child_process`/`exec`/`spawn` (P1, verificável por `grep -rE "child_process|execSync|spawn" src/` = 0).

### Key Entities

- **Run**: uma execução do pipeline `/run-spec`. Identificada por `run_id` único. Materializada como um arquivo `.maker/runs/<run-id>.jsonl` (uma linha por evento) e um diretório companheiro `.maker/runs/<run-id>/` para diffs de gate.

- **Event**: uma linha JSONL append-only. Contrato **load-bearing** (one-pager, "O artefato load-bearing"):

  | Campo | Presença | Descrição |
  |---|---|---|
  | `run_id` | sempre | id do run (ex.: `2026-09-07T14-32-10_evt-stream`) |
  | `ts` | sempre | timestamp ISO-8601 UTC do evento |
  | `type` | sempre | `run.start` \| `agent.handoff` \| `gate.decision` \| `run.end` |
  | `phase` | obrigatório em `agent.handoff` | `spec` \| `plan` \| `dev` \| `review` — fase do pipeline a que o `cost` do trabalho é atribuído (base da agregação custo→gate, FR-011a) |
  | `gate` | obrigatório em `gate.decision` | `spec` \| `plan` \| `dev` \| `review` — a fase da decisão (equivale a `phase` para efeito de agregação) |
  | `actor` | quando aplicável | `human` \| `<nome-do-agente>` |
  | `decision` | só em `gate.decision` | `approve` \| `reject` \| `edit` |
  | `reason_inferred` | em `gate.decision` | narração do delta derivada do diff |
  | `artifact_diff_ref` | em `gate.decision` com edição | caminho relativo do diff persistido |
  | `cost` | sempre | `{ tokens: int, duration_ms: int }` |

- **Gate diff**: arquivo persistido sob `.maker/runs/<run-id>/` com o antes/depois do artefato de um gate. Fonte do `reason_inferred`; referenciado por `artifact_diff_ref`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Após um run, `maker runs` mostra custo (tokens) e tempo de cada run e por gate — cada valor por gate igual à soma dos eventos daquela fase (FR-011a) — **sem instrumentação extra do consumidor** (one-pager, sinal de sucesso nº 1).
- **SC-002**: 100% das linhas emitidas em `.maker/runs/<run-id>.jsonl` parseiam como JSON e validam contra o schema do evento.
- **SC-003**: Dado um conjunto de M runs registrados (M ≥ 1), `maker runs` exibe, para cada gate, a contagem "N de M runs" de runs com ao menos uma decisão `reject` (mecanismo de US4 AC1) — o output é determinístico e derivado só do stream, sem juízo humano. (Verifica o sinal de sucesso nº 2 do one-pager de forma testável: dado um fixture com contagens conhecidas, a saída bate exatamente.)
- **SC-004**: `grep -rE "child_process|execSync|spawn" src/` retorna zero — a feature é 100% Node/`fs` puro (P1).
- **SC-005**: Reprocessar/reler qualquer run nunca altera bytes de arquivos existentes em `.maker/runs/` (append-only verificável por hash antes/depois de `maker runs`).
- **SC-006**: A fricção humana da captura L0 é zero campos preenchidos: o humano não digita nenhum valor de evento.

---

## Cobertura dos Princípios do Projeto (constitution)

| Princípio | Como esta spec o respeita |
|---|---|
| **P1 — zero shell-out (NON-NEGOTIABLE)** | Diff de gate (FR-016) e leitura do stream (FR-015) em Node/`fs` puro; FR-024/SC-004 verificam. |
| **P3 — mutação idempotente/reversível** | Escrita append-only (FR-002); reler não muta (SC-005). |
| **P5 — nunca destruir dado do usuário** | Nenhum run anterior é sobrescrito/corrompido (FR-023); `run_id` único por arquivo. |
| **PR4 / P4 — comando via script entry point** | `runs` é subcomando da própria CLI (FR-009). |
| **PR3 — organização de testes** | Testes unitários em `test/` (base técnica do projeto; divergência `tests/`↔`test/` já registrada na constitution). |
| **PR2 — gates obrigatórios** | A feature **observa** os 4 gates existentes; não os altera nem os pula. |

---

## Assumptions

- **Formato do `run_id`**: `<timestamp>_<slug-da-feature>` (ex.: `2026-09-07T14-32-10_evt-stream`), conforme o exemplo do one-pager — único por run, garantindo um arquivo dedicado por run e nenhuma colisão de escrita.
- **Um run = um arquivo** `.maker/runs/<run-id>.jsonl`; diffs de gate ficam no diretório companheiro `.maker/runs/<run-id>/`. Não há contenção entre runs concorrentes por serem arquivos distintos.
- **Fonte de custo/tempo**: `tokens` e `duration_ms` são reportados pelo próprio pipeline (agentes/gates) no momento da emissão; a spec não prescreve como o número é obtido, só que é emitido.
- **Superfície de `maker runs`**: nesta fase o comando entrega a **lista** com custo/tempo por gate e a agregação L1. Visão de detalhe por run (`maker runs <run-id>`) é aceitável mas não obrigatória nesta fase.
- **Primeiro run logado à mão** (risco do one-pager, suposição 2): a instrumentação não observa a própria construção; o run inaugural é registrado manualmente no formato do schema e serve como primeiro data point + validação. Isto é premissa, **não** AC de automação.
- **Qualidade da inferência de motivo** (risco do one-pager, suposição 1): assume-se que a narração do diff é boa o bastante para ser útil sem revisão humana; validada já no primeiro run à mão. Se ruim, o L1 agrega ruído — risco aceito para a Fase 1.
- **Projeto headless (HAS_UI=false)**: a feature é CLI pura, sem UI; nenhum passo de `visual-reviewer`/`e2e` de UI se aplica.
- **Diretório de testes**: todos os testes desta feature MORAM em `test/` (não `tests/`) — base técnica atual do maker; a constitution (PR3) reconhece a divergência `tests/`↔`test/`. Isto é decisão fixada aqui, **não** deixada para o plan.

---

## Não-metas (explícitas — one-pager)

- **L2 — propor emendas à constitution** a partir de rejeições recorrentes: **fora de escopo**. Precisa de volume; visão, não escopo.
- **Resumabilidade de pipeline**: **fora de escopo**. Exige serializar estado, não só logar eventos — Fase 2.
- **Telemetria remota / distribuição de add-ons**: **fora de escopo**. Nenhum dado sai da máquina de forma autônoma na Fase 1.
- **Export estruturado / programático** (flag `maker runs --json`, CSV, arquivo de relatório consolidado): **fora de escopo da Fase 1** (decisão de gate, 2026-09-08). O consumo na Fase 1 é: (a) `maker runs` no **terminal** para leitura humana, e (b) os próprios `.maker/runs/<run-id>.jsonl` como **substrato machine-readable cru** (uma linha JSON por evento, greppável/pipeável). Uma superfície de export estruturada é candidata a fase posterior, não escopo agora.
- **Observability do app-alvo**: **fora de escopo** — isto é observability do **pipeline** `/run-spec`, não do produto que o consumidor constrói (aquilo é o add-on `observability` do backlog).
- Um dogfood verde prova **usabilidade e generalidade** do motor, **não qualidade** do output. Não superinterpretar.
