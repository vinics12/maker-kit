# US-1 Brief — Schema do evento + emissão append-only (P1) [backend]

## Objetivo
Entregar o **substrato**: o contrato zod do evento (load-bearing) e a escrita append-only por run.
Sem isto nenhum consumidor existe. Toda US posterior importa `src/runs/schema.ts`.

## ACs cobertos (spec US1)
AC1-6 + FR-001..008, FR-007a, FR-023. Foco: append-only (P3/P5), validação por schema (FR-008),
atribuição de fase estrita (FR-007a).

## Contexto necessário
- Contrato normativo: `contracts/event.schema.md` (copie os enums/valores exatos — PR6).
- Modelo: `data-model.md` (INV-1..4).
- Stack: ESM, imports com sufixo `.js`; zod já é dependência; `fs/promises` + `node:path`.
- Padrão de módulo: ver `src/addons/schema.ts` (estilo zod do repo) e `src/render/manifest.ts` (I/O fs).

## Decisões fixadas (não reabrir)
- `.strict()` em cada variante da union — é o que impede `phase` em evento de run e campos extras.
- `appendEvent` = `fs.appendFile(path, JSON.stringify(event)+"\n")`. **Nunca** ler-modificar-reescrever.
- `run_id` = `<timestamp>_<slug>`; o arquivo é `.maker/runs/<run-id>.jsonl`; dir companheiro `.maker/runs/<run-id>/`.

## Runbook
1. `src/runs/schema.ts` conforme contrato → `pnpm typecheck`.
2. `src/runs/emit.ts` (`runFilePath`, `runDir`, `appendEvent` com validação prévia).
3. Testes em `test/runs/`. `pnpm test`.
4. Verify: `pnpm typecheck && pnpm test && pnpm audit:coupling`.

## Tocar SOMENTE:
- `src/runs/schema.ts`
- `src/runs/emit.ts`
- `test/runs/schema.test.ts`
- `test/runs/emit.test.ts`
- `test/runs/append-only.test.ts`

## NÃO tocar
`src/cli.ts`, `src/commands/**`, `src/runs/read.ts|aggregate.ts|diff.ts`, `templates/**`.
