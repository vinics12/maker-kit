<!-- plan-depth: STANDARD -->
# Tasks — Event Stream do pipeline

Verify de cada task: `pnpm typecheck && pnpm test && pnpm audit:coupling`.
Testes MORAM em `test/` (não `tests/`) — decisão fixada na spec.
Ordem de fases e paralelismo em `plan.md §5`. Cada US tem um brief autocontido em `briefs/US-N.md`
com o bloco `Tocar SOMENTE:` (base do boundary check do orquestrador).

---

## Fase A — Substrato (1 slot, bloqueia tudo)

### [US-1 — backend] Schema do evento + emissão append-only (P1)

Brief: `briefs/US-1.md`

- [X] T101 — `src/runs/schema.ts`: zod discriminated-union do evento (`run.start`/`agent.handoff`/`gate.decision`/`run.end`), enums `phaseSchema`/`decisionSchema`, `costSchema`, tipos exportados. `.strict()` em cada variante para codificar FR-007a/INV-3/INV-4. Contrato em `contracts/event.schema.md`.
- [X] T102 — `test/runs/schema.test.ts`: valida os 4 exemplos válidos e os inválidos do contrato (run-level com `phase` reprova; handoff sem `phase` reprova; enum errado reprova; tokens negativo reprova). Fixtures com valores exatos (PR6).
- [X] T103 — `src/runs/emit.ts`: `runFilePath(target, runId)`, `runDir(target, runId)`, `appendEvent(target, event)` que valida contra `eventSchema` e faz `fs.appendFile` de `JSON.stringify(event)+"\n"`, criando `.maker/runs/` se ausente. Nunca reescreve/trunca (P3/P5).
- [X] T104 — `test/runs/emit.test.ts`: emitir a sequência `run.start→agent.handoff→gate.decision→run.end` num tmpdir; assegurar 4 linhas JSONL válidas, na ordem, cada uma casando o schema; emitir sobre arquivo existente só anexa.
- [X] T105 — `test/runs/append-only.test.ts` (prova P3): após cada `appendEvent`, o prefixo de bytes anterior é idêntico (nenhuma linha anterior muda); N emissões ⇒ arquivo só cresce. `append-only.test.ts` é **100% de US-1** (não é tocado por US-2). A prova de hash pós-`maker runs` (SC-005) é complementar e vive em `test/runs/runs.command.test.ts` (T207, US-2) — arquivos disjuntos, sem interseção.

---

## Fase B — Consumidores (2 slots, paralelos: US-2 ‖ US-3)

### [US-2 — backend] `maker runs`: histórico com custo/tempo por gate (P1)

Brief: `briefs/US-2.md` · depende de US-1 (importa `schema.ts`, congelado)

- [X] T201 — `src/runs/read.ts`: `listRunFiles(target)` e `readRun(path)` em `fs` puro; parse por-linha tolerante (última linha truncada / linha inválida ignorada, FR-013); sem mutação (FR-012/FR-015).
- [X] T202 — `test/runs/read.test.ts`: fixture com última linha truncada ⇒ linhas íntegras retornadas, truncada ignorada; `.maker/runs/` ausente ⇒ lista vazia sem throw.
- [X] T203 — `src/runs/aggregate.ts`: `costByGate(events)` por FR-011a (soma determinística `phase==G` + `gate==G`) e `runTotals(events)`. (L1 fica para US-4.)
- [X] T204 — `test/runs/aggregate.test.ts`: caso US2 AC6 (plan ⇒ tokens=600, duration_ms=65); independência de ordem de leitura.
- [X] T205 — `src/commands/runs.ts`: `runRuns(opts)` — lista runs por `run_id`, imprime bloco por-gate + total; `.maker/runs/` ausente/vazio ⇒ exit 0 + "nenhum run registrado" (FR-014). Superfície em `contracts/maker-runs-output.md`.
- [X] T206 — `src/cli.ts`: registrar `program.command("runs")` com `-t, --target`, delegando a `runRuns`.
- [X] T207 — `test/runs/runs.command.test.ts`: fixtures em tmpdir ⇒ saída lista N runs + custo/tempo por gate; caso vazio ⇒ exit 0 sem stack trace; **hash de `.maker/runs/**` antes/depois igual** (SC-005, completa a prova P3 de US-1/T105).

### [US-3 — backend] Captura de gate L0 via diff em JS puro (P2)

Brief: `briefs/US-3.md` · depende de US-1 (importa `schema.ts`/`emit` path helpers) · **arquivos disjuntos de US-2**

- [X] T301 — `src/runs/diff.ts`: LCS por linha (JS puro, sem subprocesso) → hunks; serialização unified-ish; `computeGateDiff(target, {runId, gate, before, after})` persiste sob `.maker/runs/<run-id>/<gate>.diff` e retorna `{ artifact_diff_ref, narration }`. Diff vazio ⇒ `narration="sem alterações"`, sem ref (FR-016/017/019).
- [X] T302 — narração-stub determinística derivada do delta (contagem +N/−M por artefato); documentar no cabeçalho do módulo o seam com o orquestrador (narração NL rica é do agente) — comentário só de PORQUÊ (PR5).
- [X] T303 — `test/runs/diff.test.ts`: before≠after ⇒ arquivo de diff persistido + `artifact_diff_ref` não-vazio + `narration` não-vazia derivada do conteúdo; before==after ⇒ "sem alterações" e nenhum motivo fabricado (FR-018/019/020, US3 AC1-3).
- [X] T304 — `test/runs/no-shellout.test.ts` (prova P1): assevera zero ocorrências de `child_process|execSync|spawn` em **todo o `src/`** — não só `src/runs/`, mas também `src/commands/runs.ts` e `src/cli.ts` da feature (FR-024/SC-004, espelhando `src/` inteiro). Varre `src/` recursivamente via `fs` (sem shell) e assegura zero matches.

---

## Fase C — L1 (1 slot, sequencial após US-2: intersecta aggregate.ts + runs.ts)

### [US-4 — backend] Agregação L1 de padrões de rejeição (P3)

Brief: `briefs/US-4.md` · depende de US-1+US-2+US-3 · **NÃO paralela com US-2**

- [X] T401 — `src/runs/aggregate.ts` (estende): `rejectionsByGate(runs)` → por gate, `{ n, m }` = runs com ≥1 `gate.decision` `reject` sobre M runs; derivado só do stream (FR-021/022).
- [X] T402 — `src/commands/runs.ts` (estende): imprime a seção L1 `"<gate> reprovou em N de M runs"` após a lista; sem supressão por limiar (US4 AC2).
- [X] T403 — `test/runs/aggregate.test.ts` (estende) + `test/runs/runs.command.test.ts` (estende): M runs de fixture com decisões variadas ⇒ contagem "N de M" exata por gate (SC-003, US4 AC1).

---

## Prova de isolamento/segurança

Não é E2E — ver `plan.md §4`. Invariantes provados em `test/`:
- **P1 zero shell-out** → `test/runs/no-shellout.test.ts` (T304, US-3).
- **P3 append-only** → `test/runs/append-only.test.ts` (T105, US-1) + hash pós-`runs` (T207, US-2).
`tests/e2e/001-event-stream/`: **não aplicável** — CLI headless, sem servidor nem regra de segurança multi-parte.
