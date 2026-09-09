# maker Constitution

Princípios não-negociáveis do projeto. Toda spec, plano, código e revisão deve respeitá-los.
Violações são tratadas como **CRITICAL** pelo `/speckit-analyze` e bloqueiam avanço no pipeline `/run-spec`.

Esta constitution tem duas partes:
- **Princípios de Processo (PR)** — vêm do motor `maker` e valem para qualquer stack. Não removê-los.
- **Bases Técnicas** e **Princípios do Projeto** — preenchidos aqui para o próprio `maker`
  (dogfooding: o maker usa o maker para construir o maker).

## Princípios de Processo (do motor)

### PR1. Specs São Verdade (NON-NEGOTIABLE)
O código segue o que está em `specs/NNN-*/spec.md`. Divergências exigem **retorno ao gate da fase
apropriada** (spec, plan ou tasks) e atualização do artefato antes de continuar. Nunca "ajustar
código e esquecer da spec".

**Como verificar**: `pm-validator` cruza os ACs do spec.md contra implementação e testes ao final do pipeline.

### PR2. Gates Obrigatórios (NON-NEGOTIABLE)
O pipeline `/run-spec` exige aprovação humana explícita em 4 gates:
- **Gate 1**: pós-spec (spec.md revisada)
- **Gate 2**: pós-plan+tasks (arquitetura e decomposição revisadas)
- **Gate 3**: pós-código (diff revisado antes de aceite)
- **Gate 4**: pós-validação (cobertura de ACs confirmada por um humano)

Nenhum agente pula gate. Rejeição retorna à fase imediatamente anterior com feedback do humano.
Em features MINI, Gate 1 e Gate 2 são **fundidos** — não removidos.

### PR3. Organização de Testes (NON-NEGOTIABLE)
Testes unitários vivem num diretório `tests/` por workspace, espelhando a árvore de `src/`
(`tests/<mirrored/path>/<name>.test.*`), nunca co-locados ao lado do fonte. Testes end-to-end
ficam centralizados na raiz em `tests/e2e/`. Um check de lint no CI deve reprovar violações.

**Como verificar**: o check de layout do projeto retorna zero violações.

### PR4. Comando via Script Entry Point (NON-NEGOTIABLE)
Todo comando de contribuidor (build, lint, typecheck, test, e2e, verify) é exposto como um script
do projeto e invocado pelo runner do projeto — não por CLI externo cru na documentação ou no CI. A
superfície de contribuidor é estável mesmo que a ferramenta por baixo mude.

**Como verificar**: os comandos comuns existem como scripts; docs e CI não instruem CLI externo cru.

### PR5. Comentários Mínimos (NON-NEGOTIABLE)
Comentários explicam o **PORQUÊ**, não o QUÊ. Comente apenas quando o código tem uma restrição
não-óbvia, um invariante sutil, um workaround de bug específico, ou comportamento que surpreenderia
um leitor experiente. Nunca docstrings que repetem o nome da função, nem referências a FR/AC no
código-fonte (isso vai em commit/PR), nem resumos do que um bloco acabou de fazer.

**Como verificar**: code review rejeita qualquer comentário que poderia ser deletado sem confundir
um leitor futuro que conhece o codebase.

### PR6. Fidelidade de Fixtures (NON-NEGOTIABLE)
Fixtures de teste (unit, integração, e2e) usam os **valores exatos** definidos nos contratos do
projeto (schemas, enums, tipos) — nunca traduções, aliases ou aproximações. Traduções legíveis
vivem exclusivamente em mapas de label. Se a tradução muda, o teste quebra na fonte, não silenciosamente.

**Como verificar**: a suíte de testes passa; toda asserção de UI referencia o mapa de label compartilhado.

---

## Bases Técnicas (do maker)

> O maker é uma CLI Node/TypeScript **headless** (sem UI) que instala um motor de workflow em
> projetos-alvo. As escolhas abaixo valem para o desenvolvimento do próprio motor.

- **Banco / persistência**: N/A. O maker não tem banco. O único estado em disco é o do usuário-alvo
  (`.maker/manifest.json`, `.maker/runs/*.jsonl`) — arquivos, não banco. Leitura sempre pura
  (nunca ler-modificar-reescrever; a escrita de eventos é append-only).
- **Montagem de testes**: **vitest** (`pnpm test` → `vitest run`). Os testes vivem em `test/`
  espelhando `src/` (`test/runs/` espelha `src/runs/`). Provas arquiteturais são testes com IDs de
  requisito no nome/comentário (ex.: `test/runs/no-shellout.test.ts` prova FR-024/SC-004 varrendo
  `src/` por `child_process|execSync|spawn` = 0). Sem framework e2e — projeto headless.
- **Observabilidade**: N/A no motor. A feature `maker runs` (event-stream) é a observabilidade **do
  pipeline gerado**, não do próprio CLI.
- **Serviço local de dev**: N/A. Não há serviço a subir. O "dev loop" é `pnpm build` +
  `node dist/cli.js <cmd> --target <tmp>` contra um diretório-alvo isolado.
- **Stack**: Node ≥18, TypeScript ESM (imports com sufixo `.js`), bundle via **tsup** → `dist/cli.js`
  (`dist/` é versionado, para instalar do GitHub sem build). Deps de runtime: commander, @clack/prompts,
  fast-glob, handlebars, picocolors, zod. Distribuição: npm + tarball de release (`maker.tgz`).

## Princípios do Projeto (do maker)

> Regras arquiteturais não-negociáveis do motor. Numeradas P1, P2, … com "Como verificar" testável.

### P1. Sem shell-out (NON-NEGOTIABLE)
O CLI usa **apenas** `node:path`/`node:fs` — nunca `child_process`, `execSync` ou `spawn`. É o que
torna o maker cross-platform por construção (roda igual em macOS/Linux/WSL2 sem depender de binários
externos no host).

**Como verificar**: `test/runs/no-shellout.test.ts` varre `src/` e falha se achar qualquer
`child_process|execSync|spawn`. `pnpm audit:coupling` complementa no lado dos templates.

### P2. Motor agnóstico de negócio (NON-NEGOTIABLE)
`templates/engine/` (o que é instalado no projeto-alvo) **não** carrega regra de negócio nem base
técnica imposta — banco, testes e observabilidade são declarados pelo consumidor nos stubs de
`.specify/memory/`. Regras opcionais chegam só como **add-on**, injetadas de forma idempotente e
reversível.

**Como verificar**: `pnpm audit:coupling` (`scripts/audit-coupling.mjs`) falha se termos de negócio
vazarem em `templates/engine/` fora dos stubs de memória. Espelhado pelo teste de integração
anti-acoplamento.

### P3. `templates/engine/` espelha o layout-alvo (NON-NEGOTIABLE)
A árvore de `templates/engine/` reflete exatamente o que será escrito no projeto-alvo. Arquivos
`.hbs` são renderizados (perdem a extensão) via handlebars; o resto é copiado verbatim. A base stock
do SpecKit nunca passa pelo engine de renderização.

**Como verificar**: `test/engine.test.ts` e `test/init.integration.test.ts` (install em tmp).

### P4. Idempotência e reversibilidade de mutações (NON-NEGOTIABLE)
Operações que mutam o projeto-alvo (`init`, `add`, `remove`, `update`) são rastreadas por manifest
sha256 (`.maker/manifest.json`) e por estado de add-on (`.maker/addons/<id>.json`). `update` preserva
edições locais; `remove` reverte deixando o `doctor` verde; injeções de add-on são delimitadas por
marcadores.

**Como verificar**: `test/addon.integration.test.ts`, `test/inject.test.ts` e o `doctor` verde
após um ciclo add→remove.

## Governance

Esta constitution **supersede** qualquer prática informal, comentário em PR ou decisão verbal.
Amendments exigem: (1) PR específico tocando este arquivo, (2) justificativa documentada,
(3) aprovação humana explícita, (4) bump de versão (semver). Em conflito entre esta constitution e
outras instruções (CLAUDE.md, prompts, agentes), **a constitution vence**.

**Version**: 0.1.0 | **Preenchido para**: maker (dogfooding self-host)
