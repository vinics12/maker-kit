# Contrato — Superfície de saída de `maker runs`

Subcomando da própria CLI (FR-009, PR4). Leitura **pura** (FR-012). Não prescreve pixels exatos, mas fixa o **conteúdo obrigatório** e os invariantes de exit code — o que os testes asseveram.

## Comando

```
maker runs [-t, --target <dir>]   # default: cwd; lê <target>/.maker/runs/
```

## Caso feliz (≥1 run válido)

Para cada run, a saída DEVE conter:
1. O `run_id` do run (FR-010).
2. Um bloco **por gate** (`spec`, `plan`, `dev`, `review`) exibindo `tokens` e `duration_ms` daquele gate, computados por FR-011a (soma dos eventos daquela fase). Gates sem eventos podem ser omitidos ou zerados — mas um gate com eventos DEVE reportar a soma exata.
3. O **total** do run (soma sobre todos os eventos).

Exemplo de asserção (US2 AC6): fixture com 3 `agent.handoff` `phase:"plan"` (tokens 100/200/300, dur 10/20/30) + `gate.decision` `gate:"plan"` (tokens 0, dur 5) ⇒ a linha do gate `plan` reporta **tokens=600, duration_ms=65**.

## Bloco L1 (US4)

Após a lista, uma seção de padrões: para cada gate, `"<gate> reprovou em N de M runs"` (FR-021), onde `N` = runs com ≥1 `gate.decision` `reject` naquele gate e `M` = total de runs lidos. Sem supressão por limiar (US4 AC2).

## Casos de borda (exit code 0, nunca stack trace)

| Situação | Comportamento |
|---|---|
| `.maker/runs/` ausente ou vazio | exit 0 + mensagem "nenhum run registrado" (FR-014). |
| Última linha de um `.jsonl` truncada | linhas íntegras exibidas; a truncada é ignorada; comando não falha (FR-013). |
| Linha não-truncada mas inválida | ignorada com a mesma tolerância; não derruba o comando. |
| Qualquer execução | zero escrita/mutação em `.maker/runs/` (FR-012; provado por hash em `append-only.test.ts`). |

## Determinismo

Toda a saída é derivada exclusivamente das linhas dos `.jsonl` (FR-011a/FR-022). Mesma entrada ⇒ mesma saída (ordenação estável de runs, ex.: por `run_id`).
