# US-3 Brief — Captura de gate L0 via diff em JS puro (P2) [backend]

## Objetivo
Consumidor B nível 0: em cada gate, computar o diff antes/depois do artefato **em Node/`fs` puro**,
persistir, e derivar uma narração do delta que vira `reason_inferred`. Fricção humana ≈ zero.

## ACs cobertos (spec US3)
AC1-5 + FR-016..020, FR-024. Foco: **zero shell-out** (P1, o ponto mais tentador do repo),
narração derivada do diff (não campo livre, não taxonomia fixa), diff vazio ⇒ "sem alterações".

## Contexto necessário
- Depende de **US-1**: usa tipos de `src/runs/schema.ts` e helpers de path de `src/runs/emit.ts` (`runDir`) — só leitura, não edita.
- Decisão de algoritmo (plan.md §2): **LCS por linha** em JS puro. Matriz de comprimento + backtrack, hunks add/del/ctx. Sem `git diff`/`diff`/subprocesso.
- Seam código↔orquestrador (plan.md §2): o código entrega diff persistido + narração-**stub** determinística; a narração NL rica é do agente do orquestrador ao emitir `gate.decision`.

## Decisões fixadas
- Persistir sob `.maker/runs/<run-id>/<gate>.diff`; `artifact_diff_ref` = path relativo (nunca inline na linha JSONL — edge "diff enorme").
- Diff vazio (before==after) ⇒ `narration="sem alterações"`, sem `artifact_diff_ref`, **nenhum motivo fabricado** (FR-019).
- Narração-stub = derivada do delta (ex.: contagem +N/−M por artefato). Determinística e não-vazia quando há delta.
- Comentário só de PORQUÊ (PR5) documentando o seam.

## Runbook
1. `src/runs/diff.ts` (LCS + serialização + `computeGateDiff` + narração-stub).
2. `test/runs/diff.test.ts` (delta ⇒ ref+narração; vazio ⇒ "sem alterações").
3. `test/runs/no-shellout.test.ts` (grep `child_process|execSync|spawn` sobre **todo o `src/`** = 0, via `fs`). Escopo = `src/` inteiro (inclui `src/commands/runs.ts` e `src/cli.ts` da feature), não só `src/runs/` — espelha SC-004/FR-024 fielmente.
4. Verify completo.

## Tocar SOMENTE:
- `src/runs/diff.ts`
- `test/runs/diff.test.ts`
- `test/runs/no-shellout.test.ts`

## NÃO tocar
`src/runs/schema.ts|emit.ts|read.ts|aggregate.ts`, `src/commands/**`, `src/cli.ts`, `templates/**`.
Disjunto de US-2 → paraleliza com ela.
