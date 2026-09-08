# US-2 Brief — `maker runs`: histórico com custo/tempo por gate (P1) [backend]

## Objetivo
Consumidor A (observability): `maker runs` lê o stream e mostra os runs com **custo (tokens) e tempo
por gate** + total. Ganho rápido, muda comportamento antes de qualquer learning.

## ACs cobertos (spec US2)
AC1-6 + FR-009..015, FR-011a. Foco: agregação custo→gate determinística (US2 AC6), leitura pura
(FR-012), tolerância a linha truncada (FR-013), vazio ⇒ exit 0 (FR-014).

## Contexto necessário
- Depende de **US-1** concluída: importa tipos/`eventSchema` de `src/runs/schema.ts` (congelado — só leitura).
- Superfície de saída: `contracts/maker-runs-output.md`. Regra de agregação: `data-model.md` + FR-011a.
- Registro de subcomando no commander: seguir exatamente o padrão de `src/cli.ts` (blocos `program.command(...)`)
  e o estilo de handler de `src/commands/doctor.ts` (`opts.target ?? process.cwd()`, `picocolors`, `process.exitCode`).

## Decisões fixadas
- Custo do gate `G` = soma de `cost` de todo `agent.handoff` com `phase==G` **mais** o `gate.decision` com `gate==G` (FR-011a). Determinístico, independe da ordem.
- Parse tolerante: `split("\n")`, ignorar linha vazia/última-truncada/inválida sem throw.
- Leitura pura: nenhuma escrita em `.maker/runs/` (provado por hash em T207).
- Ordenação estável de runs (ex.: por `run_id`) para saída determinística.

## Runbook
1. `src/runs/read.ts` (list + read tolerante) → teste.
2. `src/runs/aggregate.ts` (`costByGate`, `runTotals`) → teste do caso AC6 (plan ⇒ 600 / 65).
3. `src/commands/runs.ts` (`runRuns`) + registrar em `src/cli.ts`.
4. Teste de comando (fixtures em tmpdir + hash antes/depois). Verify completo.

## Tocar SOMENTE:
- `src/runs/read.ts`
- `src/runs/aggregate.ts`
- `src/commands/runs.ts`
- `src/cli.ts`
- `test/runs/read.test.ts`
- `test/runs/aggregate.test.ts`
- `test/runs/runs.command.test.ts`

## NÃO tocar
`src/runs/schema.ts`, `src/runs/emit.ts` (US-1, congelados), `src/runs/diff.ts` (US-3),
`test/runs/schema.test.ts|emit.test.ts|append-only.test.ts|diff.test.ts|no-shellout.test.ts`.

> Nota de sequência: `src/runs/aggregate.ts` e `src/commands/runs.ts` serão **estendidos** por US-4.
> US-4 roda **depois** desta US (não paralela) — não há edição concorrente.
