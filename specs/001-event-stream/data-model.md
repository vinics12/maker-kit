# Data Model — Event Stream

Sem banco. O modelo é **arquivos no target**. Fonte de verdade do formato: `src/runs/schema.ts` (zod).

## Entidades

### Run
Uma execução do pipeline `/run-spec`.

| Atributo | Tipo | Regra |
|---|---|---|
| `run_id` | string | `<timestamp>_<slug>` (ex.: `2026-09-07T14-32-10_evt-stream`). Único por run. |
| arquivo | path | `.maker/runs/<run-id>.jsonl` — uma linha JSONL por evento, append-only. |
| dir de diffs | path | `.maker/runs/<run-id>/` — companheiro, guarda os diffs de gate. |

Um run = um arquivo dedicado. Sem contenção entre runs concorrentes (arquivos distintos). Nunca sobrescrito (P3/P5).

### Event (contrato load-bearing)
Uma linha JSONL. Discriminated union por `type`.

**Campos base (todo evento)**
| Campo | Tipo | Presença |
|---|---|---|
| `run_id` | string | sempre |
| `ts` | string ISO-8601 UTC | sempre |
| `type` | `run.start`\|`agent.handoff`\|`gate.decision`\|`run.end` | sempre |
| `cost` | `{ tokens: int≥0, duration_ms: int≥0 }` | sempre |

**Por tipo**
| type | campos adicionais | proíbe |
|---|---|---|
| `run.start` | — | `phase`, `gate` (FR-007a: evento de nível de run não é atribuível a fase) |
| `run.end` | — | `phase`, `gate` |
| `agent.handoff` | `actor: string` (nome do agente), `phase: Phase` | `gate` |
| `gate.decision` | `gate: Phase`, `actor: string` (usualmente `"human"`), `decision: Decision`, `reason_inferred: string`, `artifact_diff_ref?: string` | `phase` |

**Enums**
- `Phase = spec | plan | dev | review`
- `Decision = approve | reject | edit`

**Invariantes**
- INV-1 (append-only, P3): anexar um evento nunca reescreve/reordena/remove linha anterior.
- INV-2 (validável, FR-008): toda linha parseia como JSON **e** valida contra o schema.
- INV-3 (atribuição de custo, FR-007a): todo evento de trabalho carrega exatamente um campo de fase (`phase` no handoff, `gate` no decision); eventos de run não carregam nenhum.
- INV-4 (fase estrita): o schema é `strict` — campos extras/errados por tipo reprovam a validação.

### Gate diff
Arquivo texto sob `.maker/runs/<run-id>/`. Antes/depois de um artefato de gate. Referenciado por `artifact_diff_ref` (path relativo). Fonte da narração de `reason_inferred`. Diff vazio ⇒ narração `"sem alterações"`, sem `artifact_diff_ref` obrigatório.

## Agregações (derivadas, não persistidas)

### Custo por gate (FR-011a) — determinístico
Para gate `G ∈ Phase`:
```
tokens(G)      = Σ e.cost.tokens      onde faseDe(e) == G
duration_ms(G) = Σ e.cost.duration_ms onde faseDe(e) == G
faseDe(agent.handoff) = e.phase ; faseDe(gate.decision) = e.gate ; faseDe(run.*) = ⊥
```
Total do run = Σ sobre todos os eventos do arquivo. Independe da ordem de leitura.

### L1 rejeição por gate (FR-021)
Para cada gate `G`: `N = #{ runs com ≥1 gate.decision onde gate==G e decision=="reject" }`, `M = #{ runs totais lidos }`. Saída `"N de M"`. Derivado só do stream (FR-022). Sem supressão por limiar (US4 AC2).
