# maker — Bases Técnicas & Regras do Projeto

> Preenchido para o próprio `maker` (dogfooding). Os agentes (architect, dev, code-reviewer) lêem
> este arquivo e ele complementa `constitution.md`. As regras não-negociáveis já estão promovidas
> para a constitution (P1–P4).

## Bases Técnicas

### Banco / persistência
N/A. O maker não tem banco. O único estado é em arquivos, no projeto-alvo: `.maker/manifest.json`
(inventário sha256) e `.maker/runs/<run-id>.jsonl` (event-stream, append-only). **Nunca**
ler-modificar-reescrever arquivo do usuário — releitura é pura (SC-005/P3 da feature 001).

### Montagem de testes
**vitest** (`pnpm test`). Casa com PR3: os testes ficam em `test/` espelhando `src/`
(`test/runs/schema.test.ts` ↔ `src/runs/schema.ts`). Provas arquiteturais citam IDs de requisito
(`no-shellout.test.ts` = FR-024/SC-004; `append-only.test.ts` = P3). Sem e2e (headless).
> Desvio consciente de PR3: o diretório é `test/` (singular), não `tests/`, e não há check de lint
> no CI ainda (ver "gaps conhecidos" no CONTRIBUTING).

### Observabilidade
N/A no motor. A observabilidade que o maker oferece (`maker runs`) é sobre o **pipeline gerado no
projeto consumidor**, não sobre o próprio CLI.

### Serviço local de dev
N/A — não há serviço. O ciclo de dev é: `pnpm build` → `node dist/cli.js <cmd> --target <tmpdir>`
contra um diretório-alvo isolado (nunca sujar o repo real). O preflight de backend do `/run-spec`
não se aplica (HAS_UI=false, sem backend a subir).

## Comandos do projeto

| Papel | Comando |
|---|---|
| verify (lint+types+test) | `pnpm typecheck && pnpm test && pnpm audit:coupling` |
| build | `pnpm build` |
| test | `pnpm test` |
| dev | `pnpm dev` |

## Layout (roteamento de dev)

- **Frontend globs**: _(nenhum — projeto headless, HAS_UI=false)_
- **Backend/dados globs**: `src/**`

Camada única: todo trabalho de código é backend/lógica em `src/**`, com testes em `test/**`.

## Regras de negócio / arquitetura

As regras não-negociáveis do motor estão na `constitution.md` como **P1 (sem shell-out)**,
**P2 (agnóstico de negócio)**, **P3 (templates espelham o alvo)** e **P4 (idempotência/reversibilidade)**.
Não reabrir aqui — a constitution é a fonte.
