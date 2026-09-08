# US-4 Brief — Agregação L1 de padrões de rejeição (P3) [backend]

## Objetivo
`maker runs` mostra padrões simples sobre o conjunto de runs: por gate, quantos runs tiveram ≥1
decisão `reject` ("gate `plan` reprovou em N de M runs"). Leitura de tendência, sem propor mudanças (L2 fora).

## ACs cobertos (spec US4)
AC1-3 + FR-021, FR-022, SC-003. Foco: contagem "N de M" exata por gate, derivada **só do stream**,
sem supressão por limiar mínimo.

## Contexto necessário
- Depende de **US-1 + US-2 + US-3** concluídas. **Sequencial após US-2** — estende os mesmos arquivos (`aggregate.ts`, `commands/runs.ts`). Não há edição concorrente.
- Precisa de `gate.decision` com `decision` no stream (US-1/US-3). Reusa `read.ts` (US-2).
- Superfície: `contracts/maker-runs-output.md` (seção L1).

## Decisões fixadas
- `rejectionsByGate(runs)` → por gate `{ n, m }`: `n` = # runs com ≥1 `gate.decision` `reject` naquele gate; `m` = total de runs lidos.
- Deriva só das linhas já persistidas (FR-022) — nenhuma fonte externa.
- Sem supressão por limiar: exibe mesmo com poucos runs (US4 AC2). O "quando confiar" é do leitor humano.

## Runbook
1. Estender `src/runs/aggregate.ts` com `rejectionsByGate`.
2. Estender `src/commands/runs.ts` para imprimir a seção L1.
3. Estender `test/runs/aggregate.test.ts` + `test/runs/runs.command.test.ts` (M runs fixture ⇒ "N de M" exato).
4. Verify completo.

## Tocar SOMENTE:
- `src/runs/aggregate.ts`
- `src/commands/runs.ts`
- `test/runs/aggregate.test.ts`
- `test/runs/runs.command.test.ts`

## NÃO tocar
`src/runs/schema.ts|emit.ts|read.ts|diff.ts`, `src/cli.ts`, `templates/**`.
