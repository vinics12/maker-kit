# Acceptance Test Guide — Event Stream do pipeline (001-event-stream)

> **Escopo deste guia.** Gate 3 já passou: unit/integração/build verdes (54 testes), smoke
> end-to-end de `maker runs` OK, `grep` de shell-out = 0 (SC-004/FR-024 provados por
> `no-shellout.test.ts`), agregação exata de FR-011a/US2-AC6 provada por `aggregate.test.ts`,
> tolerância a linha truncada e append-only provados por `read.test.ts`/`append-only.test.ts`,
> validação de schema (válidos + inválidos) por `schema.test.ts`.
>
> **Aqui não se repete nada disso.** Este guia cobre só o que **um humano** confirma no
> terminal: as **jornadas de negócio end-to-end** (gerar stream → ler no terminal → ler a
> tendência) e as **decisões/premissas** que a automação não fecha sozinha (o "primeiro run
> logado à mão", a qualidade útil da inferência de motivo, a integridade percebida dos dados
> do usuário).
>
> **Projeto headless (HAS_UI=false).** Não há tela. A "jornada do usuário" é o terminal
> (`maker runs`) e a inspeção dos arquivos `.maker/runs/<run-id>.jsonl` + `.maker/runs/<run-id>/`.
> Estado é inspecionado via `cat`/`jq`/`node` sobre esses arquivos (project-rules → CLI headless,
> single-layer, backend/lógica em `src/**`).

## Pré-requisito comum (executar uma vez)

Todos os cenários assumem o build feito e um **diretório-alvo isolado** (`--target`) para não
sujar o repo real:

```bash
cd /Users/vinicius.cerqueira/dev/arruda-eng/maker-dogfood
pnpm build                              # gera dist/cli.js (tsup)
ACC=$(mktemp -d)                        # target isolado do teste de aceite
mkdir -p "$ACC/.maker/runs"
echo "target de aceite: $ACC"
```

O comando sob teste é sempre:

```bash
node dist/cli.js runs --target "$ACC"
```

Convenção de resultado: PASS se **todos** os "resultado esperado" batem; senão FAIL com o
run_id/arquivo e a divergência observada.

---

## Cenário 1 — Premissa do one-pager: o "primeiro run logado à mão" valida o schema

**Cobre:** Assumptions "primeiro run logado à mão" + SC-002 sob a ótica humana (a instrumentação
não observa a própria construção; o run inaugural é escrito à mão e é o primeiro data point +
validação de schema). Automação prova que o schema aceita/rejeita; **o humano prova que uma
pessoa consegue, à mão, escrever uma linha que o schema aceita** — que é a premissa da Fase 1.

**Pré-condições:** Pré-requisito comum feito. `$ACC` vazio de runs.

**Passos:**

1. Escreva à mão as 4 linhas do ciclo de vida (uma por evento) num arquivo de run. Use os
   exemplos canônicos do contrato `event.schema.md` como molde:

   ```bash
   RID="2026-09-08T09-00-00_evt-stream"
   cat > "$ACC/.maker/runs/$RID.jsonl" <<'EOF'
   {"type":"run.start","run_id":"2026-09-08T09-00-00_evt-stream","ts":"2026-09-08T09:00:00Z","cost":{"tokens":0,"duration_ms":0}}
   {"type":"agent.handoff","run_id":"2026-09-08T09-00-00_evt-stream","ts":"2026-09-08T09:05:00Z","actor":"architect","phase":"plan","cost":{"tokens":100,"duration_ms":10}}
   {"type":"gate.decision","run_id":"2026-09-08T09-00-00_evt-stream","ts":"2026-09-08T09:10:00Z","gate":"plan","actor":"human","decision":"approve","reason_inferred":"sem alterações","cost":{"tokens":0,"duration_ms":5}}
   {"type":"run.end","run_id":"2026-09-08T09-00-00_evt-stream","ts":"2026-09-08T09:11:00Z","cost":{"tokens":18422,"duration_ms":41000}}
   EOF
   ```

2. Valide **cada linha à mão** contra o schema real (o zod é a fonte de verdade), sem depender
   dos testes:

   ```bash
   node --input-type=module -e '
     import { eventSchema } from "./dist/index.js";
     import { readFileSync } from "node:fs";
     const f = process.argv[1];
     const lines = readFileSync(f,"utf8").split("\n").filter(Boolean);
     lines.forEach((l,i) => {
       const r = eventSchema.safeParse(JSON.parse(l));
       console.log(`linha ${i+1}: ${r.success ? "OK" : "INVÁLIDA — "+JSON.stringify(r.error.issues)}`);
     });
   ' "$ACC/.maker/runs/$RID.jsonl"
   ```

   > Se `dist/index.js` não exportar `eventSchema`, use o fonte via tsx/ts-node apontando para
   > `src/runs/schema.ts`, ou rode `node dist/cli.js runs --target "$ACC"` (passo 3) — um parse
   > tolerante que não derruba já indica linhas íntegras. A intenção do passo é: **um humano
   > consegue escrever JSONL válido só com o contrato na mão.**

**Resultado esperado:**
- As 4 linhas reportam `OK` (100% parseiam e validam — SC-002 na prática).
- Escrever a linha exigiu **apenas** consultar `event.schema.md`; nenhuma ferramenta gerou o
  evento. Confirma que a premissa "logar o primeiro run à mão" é executável por uma pessoa.
- Verificação negativa (edge da premissa): troque `"decision":"approve"` por `"approved"` numa
  cópia e revalide — o humano vê a linha marcada `INVÁLIDA`, confirmando que o schema é um guarda
  real para o data point inaugural (PR6: valor exato do enum).

---

## Cenário 2 — Jornada observability (US2): custo e tempo por gate + total no terminal

**Cobre:** US2 caminho feliz — SC-001/FR-010/FR-011/FR-011a lidos por um humano no terminal.
A soma exata já tem teste (US2-AC6); aqui o humano confirma a **jornada**: "rodei o run à mão,
rodei `maker runs`, e li custo/tempo por gate sem instrumentar nada".

**Pré-condições:** Cenário 1 executado (o run à mão existe em `$ACC`). Para exercitar a soma
por gate de forma visível, acrescente mais handoffs da mesma fase `plan` ao run:

```bash
cat >> "$ACC/.maker/runs/$RID.jsonl" <<'EOF'
{"type":"agent.handoff","run_id":"2026-09-08T09-00-00_evt-stream","ts":"2026-09-08T09:06:00Z","actor":"dev","phase":"plan","cost":{"tokens":200,"duration_ms":20}}
{"type":"agent.handoff","run_id":"2026-09-08T09-00-00_evt-stream","ts":"2026-09-08T09:07:00Z","actor":"dev","phase":"plan","cost":{"tokens":300,"duration_ms":30}}
EOF
```

Agora a fase `plan` tem handoffs 100+200+300 e a `gate.decision plan` com dur 5.

**Ações:**

```bash
node dist/cli.js runs --target "$ACC"
```

**Resultado esperado:**
- Sai o bloco do run `2026-09-08T09-00-00_evt-stream` (FR-010: identificado por `run_id`).
- Linha do gate `plan`: `plan: tokens=600 duration_ms=65` — soma exata dos eventos de fase
  `plan` (100+200+300+0 tokens; 10+20+30+5 ms), conforme FR-011a. **Humano confere na tela.**
- Linha `total: tokens=... duration_ms=...` = soma sobre **todos** os eventos do arquivo
  (inclui `run.start`/`run.end`; total de tokens ≥ 18422+600).
- Gates sem eventos (`spec`, `dev`, `review`) omitidos — saída enxuta.
- **Exit code 0** (`echo $?` = 0). Nenhuma instrumentação extra foi ligada: os números saíram
  só das linhas JSONL escritas à mão (SC-001).

---

## Cenário 3 — Jornada L1 (US4): tendência "N de M runs" com ≥2 runs contendo rejeições

**Cobre:** US4-AC1/AC2, SC-003, FR-021 — o segundo sinal de sucesso do one-pager, lido no
terminal sobre um conjunto de runs. A contagem exata tem teste; aqui o humano confirma a
**leitura de tendência** com contagens que ele mesmo montou, e que L1 **não suprime** por baixo
volume (a decisão de "confiar ou não" é do leitor).

**Pré-condições:** `$ACC` novo/limpo com 3 runs de contagem conhecida:

```bash
ACC=$(mktemp -d); mkdir -p "$ACC/.maker/runs"

# run A: gate plan REJECT
cat > "$ACC/.maker/runs/2026-09-08T10-00-00_a.jsonl" <<'EOF'
{"type":"run.start","run_id":"2026-09-08T10-00-00_a","ts":"2026-09-08T10:00:00Z","cost":{"tokens":0,"duration_ms":0}}
{"type":"gate.decision","run_id":"2026-09-08T10-00-00_a","ts":"2026-09-08T10:05:00Z","gate":"plan","actor":"human","decision":"reject","reason_inferred":"escopo ampliado","cost":{"tokens":0,"duration_ms":5}}
{"type":"run.end","run_id":"2026-09-08T10-00-00_a","ts":"2026-09-08T10:06:00Z","cost":{"tokens":10,"duration_ms":100}}
EOF

# run B: gate plan REJECT + gate spec APPROVE
cat > "$ACC/.maker/runs/2026-09-08T11-00-00_b.jsonl" <<'EOF'
{"type":"run.start","run_id":"2026-09-08T11-00-00_b","ts":"2026-09-08T11:00:00Z","cost":{"tokens":0,"duration_ms":0}}
{"type":"gate.decision","run_id":"2026-09-08T11-00-00_b","ts":"2026-09-08T11:02:00Z","gate":"spec","actor":"human","decision":"approve","reason_inferred":"sem alterações","cost":{"tokens":0,"duration_ms":5}}
{"type":"gate.decision","run_id":"2026-09-08T11-00-00_b","ts":"2026-09-08T11:05:00Z","gate":"plan","actor":"human","decision":"reject","reason_inferred":"faltou endpoint","cost":{"tokens":0,"duration_ms":5}}
{"type":"run.end","run_id":"2026-09-08T11-00-00_b","ts":"2026-09-08T11:06:00Z","cost":{"tokens":10,"duration_ms":100}}
EOF

# run C: gate plan APPROVE (nenhum reject)
cat > "$ACC/.maker/runs/2026-09-08T12-00-00_c.jsonl" <<'EOF'
{"type":"run.start","run_id":"2026-09-08T12-00-00_c","ts":"2026-09-08T12:00:00Z","cost":{"tokens":0,"duration_ms":0}}
{"type":"gate.decision","run_id":"2026-09-08T12-00-00_c","ts":"2026-09-08T12:05:00Z","gate":"plan","actor":"human","decision":"approve","reason_inferred":"sem alterações","cost":{"tokens":0,"duration_ms":5}}
{"type":"run.end","run_id":"2026-09-08T12-00-00_c","ts":"2026-09-08T12:06:00Z","cost":{"tokens":10,"duration_ms":100}}
EOF
```

Contagem esperada por construção: `plan` reprovou em **2 de 3**; `spec`/`dev`/`review` em **0 de 3**.

**Ações:**

```bash
node dist/cli.js runs --target "$ACC"
```

**Resultado esperado:**
- Os 3 runs listados (ordem determinística/estável por `run_id`).
- Seção de tendência (após a lista) contém exatamente:
  - `plan reprovou em 2 de 3 runs`
  - `spec reprovou em 0 de 3 runs`
  - `dev reprovou em 0 de 3 runs`
  - `review reprovou em 0 de 3 runs`
- `M = 3` em **todos** os gates (denominador = total de runs lidos), **inclusive** nos gates de
  N=0 — L1 não esconde gate por baixo volume (US4-AC2). O humano confirma que a leitura da
  tendência é dele, não do comando.

---

## Cenário 4 — Robustez (US2 AC3/AC4): dir vazio/ausente e última linha truncada

**Cobre:** FR-013/FR-014 na jornada real de um run que crashou no meio da escrita. Há teste
unitário; aqui o humano confirma que, **na frente do terminal**, o comando nunca cospe stack
trace e ainda mostra o que sobrou.

**Parte A — dir ausente e dir vazio:**

```bash
EMPTY=$(mktemp -d)                          # sem .maker/runs
node dist/cli.js runs --target "$EMPTY"; echo "exit=$?"

mkdir -p "$EMPTY/.maker/runs"               # existe mas vazio
node dist/cli.js runs --target "$EMPTY"; echo "exit=$?"
```

**Resultado esperado (A):** ambas as invocações imprimem `nenhum run registrado` e `exit=0`.
Nenhum stack trace, nenhum "ENOENT".

**Parte B — última linha truncada (crash mid-write):**

```bash
TRUNC=$(mktemp -d); mkdir -p "$TRUNC/.maker/runs"
# 3 linhas íntegras + uma 4ª cortada no meio (sem fechar o JSON, sem \n final)
printf '%s\n' \
'{"type":"run.start","run_id":"2026-09-08T13-00-00_t","ts":"2026-09-08T13:00:00Z","cost":{"tokens":0,"duration_ms":0}}' \
'{"type":"agent.handoff","run_id":"2026-09-08T13-00-00_t","ts":"2026-09-08T13:01:00Z","actor":"dev","phase":"dev","cost":{"tokens":50,"duration_ms":7}}' \
'{"type":"run.end","run_id":"2026-09-08T13-00-00_t","ts":"2026-09-08T13:09:00Z","cost":{"tokens":50,"duration_ms":7}}' \
> "$TRUNC/.maker/runs/2026-09-08T13-00-00_t.jsonl"
printf '{"type":"agent.handoff","run_id":"2026-09-08T13-00-00_t","ts":"2026-' \
>> "$TRUNC/.maker/runs/2026-09-08T13-00-00_t.jsonl"     # linha cortada, sem newline

node dist/cli.js runs --target "$TRUNC"; echo "exit=$?"
```

**Resultado esperado (B):**
- O comando lista o run `2026-09-08T13-00-00_t` com o gate `dev` (`tokens=50 duration_ms=7`) e o
  total, derivados **só das linhas íntegras**.
- A linha truncada é **silenciosamente ignorada** — não aparece, não vira erro.
- `exit=0`, sem stack trace. Confirma FR-013 na jornada de crash real.

---

## Cenário 5 — Integridade (SC-005): `maker runs` não altera bytes dos arquivos do usuário

**Cobre:** SC-005/FR-012/FR-023/P3/P5 — o invariante "reler nunca muta dado do usuário",
verificado por **hash antes/depois** por um humano. Há teste de hash; aqui o humano faz o gesto
de auditoria ele mesmo, sobre um alvo com múltiplos runs e diffs.

**Pré-condições:** use o `$ACC` do Cenário 3 (3 runs). Opcionalmente crie também um diretório
companheiro de diff para cobrir `.maker/runs/<run-id>/`:

```bash
mkdir -p "$ACC/.maker/runs/2026-09-08T10-00-00_a"
printf '+ linha nova\n- linha velha\n' > "$ACC/.maker/runs/2026-09-08T10-00-00_a/plan.diff"
```

**Ações:**

```bash
# hash de TODO o conteúdo de .maker/runs (arquivos + diffs), ordenado e estável
hash_tree() { find "$1/.maker/runs" -type f -print0 | sort -z | xargs -0 shasum | shasum; }

BEFORE=$(hash_tree "$ACC")
node dist/cli.js runs --target "$ACC" >/dev/null
AFTER=$(hash_tree "$ACC")

echo "before: $BEFORE"
echo "after:  $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "INTEGRIDADE OK (bytes idênticos)" || echo "FALHA: maker runs mutou arquivos"
```

**Resultado esperado:**
- `before` == `after` → imprime `INTEGRIDADE OK`. Nenhum `.jsonl` nem `.diff` teve um byte
  alterado, nenhum arquivo novo criado sob `.maker/runs/`. Confirma leitura pura (SC-005).
- (Verificação de reforço) `ls -la "$ACC/.maker/runs"` mostra os mesmos mtimes de antes do
  comando.

---

## Cenário 6 — Captura L0 (US3): diff persistido + narração deriva do delta; diff vazio ⇒ "sem alterações"

**Cobre:** US3-AC1/AC2/AC3, FR-016..FR-020, SC-006. A automação prova o algoritmo; o humano
confirma o **julgamento**: que a narração-stub realmente **deriva do conteúdo do diff** (não é
fabricada, não é campo digitado), que o diff fica **persistido e referenciável**, e que o caso
"aprovou sem editar" produz "sem alterações" sem inventar motivo. Este é o seam código→orquestrador
(o motivo NL rico é do agente; o código garante diff + resumo determinístico).

**Pré-condições:** Pré-requisito comum. Confirme se `dist/index.js` exporta `computeGateDiff`
(senão, aponte o snippet para o fonte via `pnpm tsx src/runs/diff.ts` equivalente).

**Parte A — gate COM edição (diff não vazio):**

```bash
L0=$(mktemp -d)
node --input-type=module -e '
  import { computeGateDiff } from "./dist/index.js";
  const target = process.argv[1];
  const before = "linha 1\nlinha 2\nlinha 3";
  const after  = "linha 1\nlinha 2 editada\nlinha 3\nlinha 4 nova";
  const r = await computeGateDiff(target, { runId:"run-l0", gate:"plan", before, after });
  console.log("narration        =", JSON.stringify(r.narration));
  console.log("artifact_diff_ref =", JSON.stringify(r.artifact_diff_ref));
' "$L0"

echo "--- conteúdo do diff persistido ---"
cat "$L0/.maker/runs/run-l0/plan.diff"
```

**Resultado esperado (A):**
- `artifact_diff_ref` = caminho **relativo** `.maker/runs/run-l0/plan.diff` (não absoluto, não
  inline na linha JSONL — mantém o stream portável; edge "diff enorme" fica em arquivo).
- O arquivo `plan.diff` **existe** e contém as linhas com prefixos `  `/`+ `/`- ` refletindo a
  edição real (`- linha 2` / `+ linha 2 editada` / `+ linha 4 nova`). O humano **confere que o
  conteúdo bate com o delta**.
- `narration` é derivada do delta (ex.: `+2/-1 linhas`) — **não vazia** e **não digitada por
  humano** (FR-018/FR-020, SC-006: zero campos preenchidos). Aqui é a narração-stub; a versão NL
  rica ("+1 endpoint não pedido") seria escrita pelo agente orquestrador ao emitir a
  `gate.decision`, lendo este mesmo diff.

**Parte B — gate SEM edição (diff vazio ⇒ "sem alterações"):**

```bash
node --input-type=module -e '
  import { computeGateDiff } from "./dist/index.js";
  const target = process.argv[1];
  const same = "linha 1\nlinha 2\nlinha 3";
  const r = await computeGateDiff(target, { runId:"run-l0b", gate:"spec", before:same, after:same });
  console.log("narration        =", JSON.stringify(r.narration));
  console.log("artifact_diff_ref =", JSON.stringify(r.artifact_diff_ref));
' "$L0"
ls "$L0/.maker/runs/run-l0b" 2>&1 || echo "(sem diretório de diff — esperado)"
```

**Resultado esperado (B):**
- `narration` = `"sem alterações"` — nenhum motivo fabricado (US3-AC3/FR-019).
- `artifact_diff_ref` = `undefined` e **nenhum** arquivo/dir de diff foi criado para `run-l0b`
  (nada a persistir quando não houve edição). Confirma que o caminho "approve sem editar" não
  inventa artefato nem motivo.

**Parte C — o motivo entra no evento sem fricção humana (jornada de emissão):**

Para fechar a jornada L0, mostre que a narração deriva **e** que o humano não digita nada:
emita uma `gate.decision` que carrega o `reason_inferred` derivado do diff da Parte A.

```bash
node --input-type=module -e '
  import { computeGateDiff } from "./dist/index.js";
  import { appendEvent } from "./dist/index.js";
  const target = process.argv[1];
  const before = "a\nb", after = "a\nB\nc";
  const d = await computeGateDiff(target, { runId:"run-l0", gate:"plan", before, after });
  await appendEvent(target, {
    type:"gate.decision", run_id:"run-l0", ts:"2026-09-08T14:00:00Z",
    gate:"plan", actor:"human", decision:"edit",
    reason_inferred: d.narration,          // <- vem do diff, NÃO digitado
    artifact_diff_ref: d.artifact_diff_ref,
    cost:{ tokens:0, duration_ms:5 }
  });
  console.log("evento emitido com reason_inferred derivado do diff");
' "$L0"
tail -n1 "$L0/.maker/runs/run-l0.jsonl"
```

**Resultado esperado (C):**
- A última linha do `.jsonl` é uma `gate.decision` válida cujo `reason_inferred` é **exatamente**
  a narração retornada pelo diff, e cujo `artifact_diff_ref` aponta o arquivo da Parte A.
- Em nenhum passo o operador digitou um "motivo" livre nem escolheu de uma lista de categorias —
  o campo saiu da inferência sobre o diff (FR-018/FR-020, SC-006).

---

## Sumário de rastreabilidade

| Cenário | ACs / SC de negócio cobertos | Jornada |
|---|---|---|
| 1 | Assumption "1º run à mão", SC-002 (ótica humana) | premissa Fase 1 |
| 2 | US2 caminho feliz: FR-010/011/011a, SC-001 | observability no terminal |
| 3 | US4 AC1/AC2, FR-021, SC-003 | L1 / tendência |
| 4 | US2 AC3/AC4, FR-013/FR-014 | robustez de leitura |
| 5 | SC-005, FR-012/FR-023 (P3/P5) | integridade dado do usuário |
| 6 | US3 AC1/AC2/AC3, FR-016..020, SC-006 | captura L0 + seam de motivo |
