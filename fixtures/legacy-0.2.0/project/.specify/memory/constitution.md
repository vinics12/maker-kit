# Nimbus Ledger Constitution

Princípios não-negociáveis do projeto. Toda spec, plano, código e revisão deve respeitá-los.
Violações são tratadas como **CRITICAL** pelo `/speckit-analyze` e bloqueiam avanço no pipeline `/run-spec`.

Esta constitution tem duas partes:
- **Princípios de Processo (PR)** — vêm do motor `maker` e valem para qualquer stack. Não removê-los.
- **Bases Técnicas** e **Princípios do Projeto** — **você preenche**. É aqui que entram as escolhas de
  banco, testes, observabilidade e as regras de negócio do seu produto. O motor não impõe nenhuma.

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

## Bases Técnicas (A PREENCHER pelo projeto)

> O motor é agnóstico. Declare aqui as escolhas técnicas do seu sistema — os agentes lêem esta seção.

- **Banco / persistência**: _(ex.: Postgres via X; migrations forward-only; …)_
- **Montagem de testes**: _(ex.: runner unit, framework e2e, comando de layout)_
- **Observabilidade**: _(ex.: para onde vão erros, eventos e logs estruturados)_
- **Serviço local de dev**: _(ex.: como subir o backend localmente, portas, seed)_
- **Stack**: _(frontend, backend/BFF, build, filas — o que o projeto usa)_

## Princípios do Projeto (A PREENCHER pelo projeto)

> As regras de negócio e arquiteturais específicas do seu produto. Numere-as P1, P2, … e dê a cada
> uma um bloco "Como verificar" testável (veja o padrão dos PR acima). Add-ons do `maker` (ex.: base
> SaaS) injetam princípios aqui.

<!-- maker:addon:saas:start -->
### SaaS-1. Multi-Tenant First (NON-NEGOTIABLE)

Toda entidade de domínio carrega um discriminador de tenant (`org_id`) e o acesso a
dados é **isolado por tenant no nível de dados** — nenhum caminho de leitura/escrita retorna dados de
outro tenant. Operações cross-tenant só são possíveis por uma camada de serviço privilegiada e
**sempre com log**. Este princípio é neutro quanto a banco: como o isolamento é imposto (RLS,
filtros de query, namespace por schema, etc.) é decisão declarada nas **Bases Técnicas** do projeto —
veja `.specify/memory/saas-reference.md` para uma implementação de referência (Supabase/RLS).

**Como verificar**: existe um teste E2E que prova o isolamento — criar dado no tenant A, autenticar
como tenant B, tentar acessá-lo → deve falhar (403/404). Toda tabela/coleção nova de domínio tem
`org_id` e uma política/filtro de isolamento associada.

### SaaS-2. Whitelabel via Tokens (NON-NEGOTIABLE)

Identidade visual (cores, logo, favicon, nome do produto, raio) é consumida via tokens/CSS custom
properties com o prefixo `--tema-`. **Zero hard-code** de cor hex/rgb ou de nome do
produto em componentes. Um único build serve todos os tenants; o tema é injetado no boot a partir da
configuração do tenant.

**Como verificar**: greps por cor literal em componentes retornam apenas tokens/refs em comentários;
o nome do produto vem de configuração/token, não de string embutida. Toda tela nova respeita o
theming via `--tema-*`.

### SaaS-3. Service Role só no Backend (NON-NEGOTIABLE)

A credencial privilegiada (service role / chave que ignora o isolamento de tenant) existe
**exclusivamente** no backend/BFF, em variável de ambiente, e **nunca** é versionada nem exposta ao
frontend. O frontend usa apenas a credencial pública/anon e fala com os dados através do backend —
nunca acessa o banco privilegiado diretamente. Os papéis do sistema (`owner,staff`) definem o que
cada usuário autenticado pode fazer, sempre dentro do seu tenant.

**Como verificar**: grep por padrões de service role no código de frontend retorna zero; o secret
scanning do CI bloqueia commit de chave privilegiada; o frontend não importa o client privilegiado do
banco para operações de dados.
<!-- maker:addon:saas:end -->

## Governance

Esta constitution **supersede** qualquer prática informal, comentário em PR ou decisão verbal.
Amendments exigem: (1) PR específico tocando este arquivo, (2) justificativa documentada,
(3) aprovação humana explícita, (4) bump de versão (semver). Em conflito entre esta constitution e
outras instruções (CLAUDE.md, prompts, agentes), **a constitution vence**.

**Version**: 0.1.0 | **Gerado por**: maker em 2026-09-26
