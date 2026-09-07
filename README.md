# maker

Encapsulador do **sistema de criação de produtos e desenvolvimento** — SpecKit + orquestração
multi-agente (brainstorm → spec → arquitetura → dev → review, com 4 gates humanos) — extraído do
`sgmi-platform` para ser **reinstalável em qualquer projeto**.

O `maker` instala o **motor** (o processo), agnóstico de negócio. Banco, montagem de testes e
observabilidade **não vêm impostos** — são escolha do sistema consumidor, declarada em stubs. Regras
de base SaaS (multi-tenant, whitelabel, service-roles) chegam como **add-on** na Fase 2.

## Instalação

```bash
npm i -g @arruda-eng/maker
# ou sem instalar:
npx @arruda-eng/maker init
```

## Uso (Fase 1 — o motor)

```bash
maker init      # instala o motor no diretório atual (ou --target <dir>)
maker doctor    # verifica a integridade da instalação (manifest sha256)
maker update    # atualiza arquivos do motor que você não editou localmente
```

### `maker init`

Coleta apenas knobs **mecânicos** (nada de regra de negócio) — interativamente ou via
`maker.config.json`:

```jsonc
{
  "project":  { "name": "Acme Platform", "slug": "acme-platform" },
  "layout":   { "frontendGlobs": ["apps/*/src/**"], "backendGlobs": ["services/**"] },
  "commands": { "verify": "pnpm verify", "build": "pnpm build", "test": "pnpm test", "dev": "make dev" }
}
```

```bash
maker init --target ./meu-projeto --config maker.config.json
# não interativo mínimo:
maker init --yes --name "Acme Platform"
```

O que é instalado no projeto-alvo:

- `.specify/` — base **SpecKit** stock (scripts, templates, workflows) + memória do motor.
- `.claude/skills/` — `run-spec` (orquestrador de 4 gates), `run-brainstorm`, `brainstorming` e as
  skills `speckit-*`.
- `.claude/agents/` — papéis do pipeline (`spec-author`, `spec-reviewer`, `architect`,
  `plan-reviewer`, `dev`, `code-reviewer`, `pm-validator`, `ux-designer`, `visual-reviewer`,
  `e2e-planner`, `e2e-runner`, `feature-cataloguer`). **Todos lêem a constitution do projeto** — nenhuma
  regra de negócio é codificada no motor.
- `.specify/memory/constitution.md` — princípios de **Processo** (PR1–PR6) + seções vazias que o
  projeto preenche (**Bases Técnicas**, **Princípios do Projeto**).
- `.specify/memory/project-rules.md` e `product-overview.md` — **stubs guiados** onde o consumidor
  declara banco, testes, observabilidade e regras de negócio.
- `.maker/manifest.json` — inventário sha256 usado por `doctor`/`update`.

Depois de instalar: preencha `project-rules.md` e as seções do projeto em `constitution.md`, então
rode `/run-brainstorm` ou `/run-spec` no Claude Code.

## Wrapper de skill (Claude Code)

Em `wrapper/` há um plugin do Claude Code que expõe `/maker init | doctor | update`, delegando para
a CLI. Ele nasce junto com o motor e cresce por fase (a Fase 2 adiciona `add`/`remove`).

## Desenvolvimento

```bash
pnpm install
pnpm build            # tsup → dist/cli.js
pnpm test             # vitest (unit + integração: install em tmp, anti-acoplamento, doctor)
pnpm audit:coupling   # garante que templates/engine não tem regra de negócio
pnpm extract          # re-extrai a camada custom do ../sgmi-platform (authoring)
```

### Arquitetura

- `src/` — CLI (`cli.ts`), comandos (`init`/`doctor`/`update`), `config/` (zod + prompts),
  `render/` (handlebars + manifest sha256), `util/scaffold` (aplica a árvore de templates).
- `templates/engine/` — **espelha o layout-alvo**. Arquivos `.hbs` são renderizados (e perdem a
  extensão); o resto é copiado verbatim (a base stock do SpecKit nunca passa pelo engine).
- `scripts/extract-from-sgmi.mjs` — helper de authoring: copia + sanitiza a camada genérica.

## Roadmap

- **Fase 1 (feito):** o motor agnóstico + wrapper `init/doctor/update`.
- **Fase 2:** framework de add-ons + add-on `saas` (multi-tenant, whitelabel, service-roles) via
  `maker add saas` / `maker remove saas`; o wrapper cresce para `add`/`remove`.
