# maker — Product Overview

> Preenchido para o próprio `maker` (dogfooding). O `spec-author` e o `architect` lêem este arquivo
> para ancorar specs e planos no domínio real.

## O que é

O `maker` é um **encapsulador do sistema de criação de produtos e desenvolvimento** — SpecKit +
orquestração multi-agente (brainstorm → spec → arquitetura → dev → review, com 4 gates humanos) —
**reinstalável em qualquer projeto**. Ele instala o **motor** (o processo), agnóstico de negócio:
banco, montagem de testes e observabilidade não vêm impostos, são declarados pelo projeto consumidor
em stubs. É uma CLI Node pura (roda em qualquer SO); o workflow que ela instala é POSIX (Windows via
WSL2).

## Personas / papéis

- **Contribuidor do motor** — evolui o CLI (`src/**`) e a metodologia (`templates/engine/**`).
  É quem usa este repositório (ver `CONTRIBUTING.md`).
- **Consumidor** — roda `maker init` no próprio projeto, preenche os stubs de memória e usa
  `/run-spec` / `/run-brainstorm` para construir features com os 4 gates.
- **Agentes do pipeline** — spec-author, spec-reviewer, architect, plan-reviewer, dev,
  code-reviewer, pm-validator, ux-designer, visual-reviewer, e2e-planner, e2e-runner,
  feature-cataloguer. Todos lêem a constitution do projeto.

## Domínio e conceitos-chave

- **Motor** (`templates/engine/`): a árvore instalada no alvo — `.specify/` (SpecKit + memória),
  `.claude/skills/` e `.claude/agents/` (o pipeline).
- **CLI** (`src/`): `init`, `doctor`, `update`, `add`, `remove`, `runs`.
- **Add-on**: pacote opcional de regras (ex.: `saas`) injetado de forma idempotente/reversível.
- **Manifest** (`.maker/manifest.json`): inventário sha256 que sustenta `doctor`/`update`.
- **Run / event-stream** (`.maker/runs/`): a telemetria append-only do pipeline (feature 001).
- **Gate**: ponto de aprovação humana obrigatória (1 spec · 2 plan · 3 código · 4 aceite).

## Roadmap / estado atual

Fase 1 (motor agnóstico + `init/doctor/update`) e Fase 2 (framework de add-ons + `saas`) prontas;
publicado no npm (v0.2.0). Backlog: add-ons `observability`/`i18n`, `maker list`, `update` com merge
3-way, `doctor` ciente de add-ons. O `feature-cataloguer` mantém `docs/features/` como registro
as-built das features prontas — **use-o como fonte de verdade**. A primeira feature integrada via
dogfooding foi `001-event-stream` (o `maker runs`).
