# Implementation Plan — Event Stream do pipeline

**Feature Branch**: `001-event-stream` · **Depth**: STANDARD · **Spec**: `specs/001-event-stream/spec.md`
**One-pager**: `docs/one-pager-event-stream.md` · **Constitution**: `.specify/memory/constitution.md`

---

## 1. Bases técnicas ancoradas no projeto

Decisões concretas herdadas de `.specify/memory/project-rules.md` + `constitution.md` (Bases Técnicas):

- **Stack**: Node ≥18 + TypeScript, ESM (`"type": "module"`, imports com sufixo `.js`), `tsup` build, `commander` CLI, `zod` schema.
- **I/O**: apenas `node:path` / `node:fs` (`fs/promises`). **Nunca** `child_process`/`exec`/`spawn` (P1, NON-NEGOTIABLE).
- **Testes**: `vitest`, em **`test/`** (não `tests/`) — decisão fixada na spec (Assumptions) e divergência já reconhecida na constitution (PR3). Espelham a árvore com um subdiretório `test/runs/`.
- **Verify gate**: `pnpm typecheck && pnpm test && pnpm audit:coupling`.
- **Coupling**: `audit:coupling` só varre `templates/engine/`. Este código é do **motor** (`src/`), não template — não pode introduzir termos de negócio em `templates/engine/`. Nenhum arquivo desta feature toca `templates/`, então o gate permanece verde por construção (registrado como verificação, não risco).
- **Persistência**: sem banco. Estado = arquivos JSONL append-only em `.maker/runs/<run-id>.jsonl` + diretório companheiro `.maker/runs/<run-id>/` para diffs de gate.

## 2. Arquitetura de módulos

Novo namespace `src/runs/` (biblioteca reusável) + um subcomando em `src/commands/`:

| Módulo | Papel | US | Consome |
|---|---|---|---|
| `src/runs/schema.ts` | Contrato **load-bearing**: zod discriminated-union do evento + tipos + enums (`Phase`, `Decision`, `EventType`). Fonte única de verdade. | US1 | — |
| `src/runs/emit.ts` | Escrita **append-only** (`appendEvent`), resolução de path do run, criação do dir companheiro. Valida contra o schema antes de anexar. | US1 | schema |
| `src/runs/read.ts` | Leitura **pura** (`fs`), parse tolerante a última linha truncada, listagem de runs em `.maker/runs/`. | US2 | schema |
| `src/runs/aggregate.ts` | Agregação custo→gate (FR-011a) e L1 de rejeição por gate (FR-021). Determinística, derivada só das linhas. | US2 (+US4 estende) | schema |
| `src/runs/diff.ts` | Diff antes/depois de artefato de gate em **JS puro** (LCS por linha), persistência sob `.maker/runs/<run-id>/`, narração-stub determinística. | US3 | schema, emit(path) |
| `src/commands/runs.ts` | Subcomando `maker runs`: orquestra read+aggregate e imprime a superfície. | US2 (+US4 estende) | read, aggregate |
| `src/cli.ts` (edição) | Registra `runs` no commander. | US2 | commands/runs |

### Algoritmo de diff (decisão fixada — P1)

Sem `git diff`/`diff`/subprocesso. **LCS por linha** clássico (matriz de comprimento, backtrack) produzindo hunks `add`/`del`/`ctx`. Complexidade `O(n·m)` sobre linhas — suficiente para artefatos de gate (specs/planos, alguns KB). O diff é serializado num formato unified-ish e **persistido como arquivo** referenciado por `artifact_diff_ref` (nunca embutido inline na linha JSONL — mantém a linha enxuta; edge-case "diff enorme").

### Narração / `reason_inferred` — seam código vs. orquestrador

`diff.ts` entrega o diff persistido + uma **narração-stub determinística** derivada do delta (ex.: contagem de linhas +N/−M por artefato; diff vazio → `"sem alterações"`). A narração em linguagem natural rica ("+2 endpoints não pedidos na spec") é trabalho do **agente do orquestrador**, que lê o diff e escreve `reason_inferred` ao emitir o `gate.decision`. O código garante: (a) o diff existe e é referenciável, (b) há sempre uma narração não-vazia derivada do diff, (c) diff vazio nunca fabrica motivo (FR-018/019/020). Isso satisfaz o Independent Test de US3 sem depender de um LLM em teste.

## 3. Tensão resolvida: o que é código vs. o que é manual na Fase 1

O "pipeline que emite eventos" é a **skill `/run-spec` orquestrada pelo Claude**, não o runtime da CLI `maker`. Corte de Fase 1:

- **Biblioteca (código, testada agora)**: `schema`, `emit`, `read`, `aggregate`, `diff`. São as primitivas reusáveis. `appendEvent(...)` é o ponto de emissão que o orquestrador (ou um humano) chama.
- **Subcomando CLI (código, testado agora)**: `maker runs` (US2/US4). Único consumidor de leitura.
- **Instrumentação viva do orquestrador**: **mínima/manual** nesta fase. Não cravamos hooks profundos na skill `/run-spec` que emitam `run.start`/`agent.handoff`/`gate.decision`/`run.end` automaticamente. A spec assume que **o primeiro run é logado à mão** no formato do schema (Assumptions + Edge Cases). Consequência de design: **não** criamos subcomando `maker emit` nesta fase (YAGNI) — a emissão é via biblioteca (`appendEvent`) ou JSONL escrito à mão validável contra o schema. Fase 2 pode promover a emissão a instrumentação automática.

Consumidor testável e não-ambíguo AGORA: `schema`+`emit` (US1), `maker runs` (US2/US4), `diff`+narração-stub (US3).

## 4. Prova de isolamento/segurança (condicional)

A constitution declara P1 (zero shell-out) e P3 (append-only) como NON-NEGOTIABLE com "Como verificar". **Não** há regra de multi-tenant/RBAC/separação de clientes que exija E2E — o projeto é uma CLI headless single-layer e a spec fixa os testes em `test/` (não `tests/e2e/`). Portanto o "isolamento" relevante aqui são esses dois invariantes de integridade, provados por **testes de nível Node em `test/`** (não um esqueleto `tests/e2e/`):

- **P1 zero shell-out** → `test/runs/no-shellout.test.ts`: assevera `grep -rE "child_process|execSync|spawn"` sobre `src/runs/` = 0 (espelha SC-004/FR-024). Autorado em US3 (onde a tentação de shell-out — o diff — mora).
- **P3 append-only** → `test/runs/append-only.test.ts`: (a) emitir N eventos e assegurar que cada `appendEvent` só cresce o arquivo, nenhuma linha anterior muda; (b) hash de todos os `.maker/runs/**` antes/depois de `maker runs`, iguais (SC-005). Autorado em US1 (emit) + estendido pela leitura em US2.

`tests/e2e/001-event-stream/`: **não aplicável** — feature CLI headless, sem servidor a subir, sem regra de segurança de dados multi-parte; a prova de integridade é unitária/integração em `test/`.

## 5. Paralelismo (2 slots de dev)

```
Fase A (1 slot):   US1  (schema + emit) ── substrato, todos importam schema.ts
                      │  (schema.ts congela após US1)
Fase B (2 slots):  US2 ‖ US3   ── arquivos disjuntos, só leem schema.ts
                      │
Fase C (1 slot):   US4         ── estende aggregate.ts + runs.ts (INTERSECTA US2 → sequencial)
```

Boundary check (interseção de `Tocar SOMENTE:` deve ser vazia entre paralelas):
- **US2 ∩ US3 = ∅** ✅ (US2: read/aggregate/commands+cli; US3: diff). Paralelizáveis.
- **US4 ∩ US2 = {aggregate.ts, commands/runs.ts, ...}** → US4 **sequencial** após US2. Não paralela.

## 6. Superfícies de contrato

- `contracts/event.schema.md` — o schema do evento (zod + JSON-Schema equivalente): o contrato load-bearing.
- `contracts/maker-runs-output.md` — a superfície de saída de `maker runs` (linhas de lista, bloco por-gate, linha L1, casos vazio/truncado).

## 7. Riscos & mitigações

- **Diff O(n·m) em artefato grande**: aceitável na Fase 1 (artefatos de gate são pequenos); se degradar, trocar por Myers depois — decisão isolada em `diff.ts`.
- **Qualidade da narração-stub**: baixa por design (é stub); a narração rica é do orquestrador. Risco aceito (spec Assumptions).
- **Colisão de `run_id`**: `<timestamp>_<slug>` único por run garante arquivo dedicado; `emit` nunca trunca/sobrescreve (P3/P5).
