# maker

Encapsulador do **sistema de criação de produtos e desenvolvimento** — SpecKit + orquestração
multi-agente (brainstorm → spec → arquitetura → dev → review, com 4 gates humanos) —
**reinstalável em qualquer projeto**.

O `maker` instala o **motor** (o processo), agnóstico de negócio. Banco, montagem de testes e
observabilidade **não vêm impostos** — são escolha do sistema consumidor, declarada em stubs. Regras
de base SaaS (multi-tenant, whitelabel, service-roles) chegam como **add-on** na Fase 2.

---

## Requisitos por sistema operacional

A **CLI** é Node puro e roda em qualquer SO. O **workflow que ela instala** (scripts do SpecKit em
bash + comandos POSIX como `grep`/`git` usados pelos agentes) espera um shell tipo-Unix. Por isso:

| SO | Como rodar |
|---|---|
| **macOS** | Nativo. Precisa de Node ≥ 18 e Git. (Ferramentas de linha já são POSIX.) |
| **Linux** | Nativo. Node ≥ 18 e Git. |
| **Windows** | **Use o WSL2** (Ubuntu) — Linux real dentro do Windows. É o caminho mais próximo do Linux e o recomendado. Veja abaixo. |

### Windows — passo a passo (WSL2)

O objetivo é ter o motor rodando **dentro de uma distro Linux**, não no PowerShell/CMD nativo (onde
os scripts `.sh` e o `grep` não existem).

1. Instale o WSL2 com Ubuntu (PowerShell como admin, uma vez só):
   ```powershell
   wsl --install -d Ubuntu
   ```
   Reinicie se pedir e abra o **Ubuntu** pelo menu Iniciar.
2. Dentro do Ubuntu, instale Node (via [nvm](https://github.com/nvm-sh/nvm)) e Git:
   ```bash
   sudo apt update && sudo apt install -y git curl
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source ~/.bashrc && nvm install --lts
   ```
3. **Trabalhe com os arquivos dentro do Linux** (ex.: `~/dev/meu-projeto`), não em `/mnt/c/...` — o
   filesystem nativo do WSL é muito mais rápido e evita problemas de fim-de-linha/permissão.
4. Use o Claude Code / a CLI `maker` normalmente **de dentro do Ubuntu**. Tudo se comporta como Linux.

5. Abra o Claude Code **apontando para o WSL** (ou rode o `claude` de dentro do Ubuntu) e trabalhe
   normalmente. `maker init` e o pipeline (`/run-spec`) se comportam exatamente como no Linux.

> **O que muda na instalação no Windows?** Nada no *comando* — a CLI `maker` é Node puro e roda igual
> em qualquer SO; `maker init` escreve os mesmos arquivos. O que muda é **onde você roda**: faça tudo
> dentro do WSL2, porque o workflow gerado (scripts `.sh` do SpecKit + `grep`/`git` dos agentes) é
> POSIX. Se você rodar `maker init` no Windows nativo, os arquivos são instalados e a CLI **avisa** para
> usar o WSL antes de rodar `/run-spec`.
>
> **Fim-de-linha (CRLF):** o motor já instala um `.gitattributes` que força **LF** nos scripts do
> pipeline, então o Git do Windows não os quebra. Mesmo assim, prefira manter o projeto no filesystem
> do WSL (`~/dev/...`), não em `/mnt/c/...`.
>
> Alternativa sem WSL: **Git Bash** roda os `.sh` e o `grep`, mas o suporte é parcial. Prefira o WSL2;
> o PowerShell/CMD nativo **não** é suportado para o workflow gerado.

---

## Instalação

Ainda **não é preciso publicar no npm** — dá para instalar direto do GitHub. Três formas:

### 1. Direto do GitHub (recomendado — sem clonar, sem npm registry)

O `npm` clona o repo, instala as deps e builda sozinho (via o script `prepare`):

```bash
# global (deixa o comando `maker` no PATH):
npm i -g github:vinics12/maker-kit

# ou sem instalar nada, rodando na hora:
npx github:vinics12/maker-kit init
```

### 2. Clonar + build + link

```bash
git clone https://github.com/vinics12/maker-kit
cd maker-kit
pnpm install && pnpm build
npm link          # deixa `maker` global; ou use `node dist/cli.js` direto
```

### 3. Plugin do Claude Code (o comando `/maker`)

Puro GitHub, sem npm — porém o plugin **delega para a CLI**, então a CLI ainda precisa estar no PATH
(instale por 1 ou 2 antes). Veja a seção *Wrapper de skill* abaixo.

> Publicar no npm (`@vinics12/maker`) fica como conveniência futura (`npm i -g @vinics12/maker`), não
> como requisito. No Windows, rode qualquer uma dessas dentro do WSL/Ubuntu — ver acima.

---

## Como usar (passo a passo)

### 1. Instalar o motor no seu projeto

No diretório do projeto-alvo:

```bash
maker init
```

Ele pergunta (interativo) os **knobs mecânicos** — nada de regra de negócio:

- **Nome / slug** do projeto
- **Globs de layout** (o que é frontend vs backend, pro roteamento de dev)
- **Comandos** do projeto: `verify` (lint+types+test), `build`, `test`, `dev`

Prefere não-interativo? Crie um `maker.config.json` e aponte com `--config`:

```jsonc
{
  "project":  { "name": "Acme Platform", "slug": "acme-platform" },
  "layout":   { "frontendGlobs": ["apps/*/src/**"], "backendGlobs": ["services/**"] },
  "commands": { "verify": "pnpm verify", "build": "pnpm build", "test": "pnpm test", "dev": "make dev" }
}
```

```bash
maker init --target ./meu-projeto --config maker.config.json
# mínimo, sem prompts:
maker init --yes --name "Acme Platform"
# reinstalar por cima de um install existente:
maker init --force
```

### 2. Declarar as bases técnicas e regras (você preenche)

O motor é agnóstico. Depois do install, abra e preencha:

- `.specify/memory/project-rules.md` — **banco, montagem de testes, observabilidade, serviço local**
  e as regras de negócio do produto.
- `.specify/memory/constitution.md` — os princípios de **Processo** (PR1–PR6) já vêm prontos; preencha
  as seções **Bases Técnicas** e **Princípios do Projeto**.
- `.specify/memory/product-overview.md` — visão de produto.

### 3. Rodar o pipeline no Claude Code

```
/run-brainstorm "ideia difusa"   # exploração → design doc → handoff
/run-spec "feature bem definida" # spec → plan → dev → aceite (4 gates humanos)
```

### 4. Manter a instalação

```bash
maker doctor    # verifica integridade (manifest sha256): arquivos ausentes/modificados
maker update    # atualiza arquivos do motor que você NÃO editou (edições locais são preservadas)
```

---

## O que é instalado no projeto-alvo

- `.specify/` — base **SpecKit** stock (scripts, templates, workflows) + memória do motor.
- `.claude/skills/` — `run-spec` (orquestrador de 4 gates), `run-brainstorm`, `brainstorming` e as
  skills `speckit-*`.
- `.claude/agents/` — papéis do pipeline (`spec-author`, `spec-reviewer`, `architect`,
  `plan-reviewer`, `dev`, `code-reviewer`, `pm-validator`, `ux-designer`, `visual-reviewer`,
  `e2e-planner`, `e2e-runner`, `feature-cataloguer`). **Todos lêem a constitution do projeto** — nenhuma
  regra de negócio é codificada no motor.
- `.specify/memory/` — `constitution.md` (Processo PR1–PR6 + seções vazias) e os stubs guiados
  `project-rules.md` / `product-overview.md`.
- `.maker/manifest.json` — inventário sha256 usado por `doctor`/`update`.

---

## Wrapper de skill (Claude Code)

Além da CLI, o `maker` inclui um **plugin do Claude Code** (em `wrapper/`) que expõe o comando
`/maker`, conduzindo a instalação pela conversa e delegando 100% para a CLI. Assim você opera o motor
sem sair do Claude Code.

### Pré-requisito

A CLI `maker` precisa estar no `PATH` (o plugin só a orquestra, não a substitui):

```bash
npm i -g github:vinics12/maker-kit   # ver seção Instalação para outras formas
maker --version                      # confirmar
```

### Instalar o plugin

O repositório é também um **marketplace** de plugin. Num terminal `claude` interativo:

```
/plugin marketplace add vinics12/maker-kit
/plugin install maker@maker-kit
```

(ou aponte para um clone local: `/plugin marketplace add /caminho/para/maker-kit`.)

### Usar

Dentro do Claude Code, no diretório do projeto-alvo:

```
/maker init      # coleta os knobs na conversa e roda `maker init`
/maker doctor    # verifica a integridade da instalação
/maker update    # atualiza arquivos do motor não editados localmente
```

O plugin nasce junto com o motor e **cresce por fase**: expõe `init | doctor | update` (motor) e
`add | remove` (add-ons).

> No Windows, faça tudo isso dentro do WSL/Ubuntu (ver a seção de requisitos por SO).

---

## Add-ons

Add-ons sobrepõem **pacotes de regras opcionais** a um projeto que já tem o motor — injetando
princípios na constitution, fragmentos nos agentes e arquivos de referência, de forma **idempotente e
reversível** (rastreada por marcadores e por um estado em `.maker/addons/<id>.json`).

```bash
maker add saas --set tenantColumn=tenant_id --set brandVarPrefix=--brand- --set roles=admin,member
maker remove saas
```

### `saas` — base multi-tenant / whitelabel / service-roles

O primeiro add-on injeta três princípios (SaaS-1 multi-tenant, SaaS-2 whitelabel, SaaS-3 service-role)
na seção **Princípios do Projeto** da constitution, mais fragmentos no `code-reviewer` e no `architect`,
e um `.specify/memory/saas-reference.md`. Os princípios são **neutros quanto a banco** — a implementação
Supabase/RLS entra só como referência; se seu projeto usa outra stack, o princípio continua valendo e o
teste E2E de isolamento é o que o prova.

Knobs: `tenantColumn` (discriminador de tenant), `brandVarPrefix` (prefixo das CSS vars) e `roles`.
`maker remove saas` reverte tudo e deixa o `doctor` verde; arquivos que você editou localmente são
preservados.

## Desenvolvimento

```bash
pnpm install
pnpm build            # tsup → dist/cli.js
pnpm test             # vitest (unit + integração: install em tmp, anti-acoplamento, doctor)
pnpm audit:coupling   # garante que templates/engine não tem regra de negócio
pnpm extract -- --from <projeto>   # re-extrai a camada custom de um projeto de origem (authoring)
```

### Arquitetura

- `src/` — CLI (`cli.ts`), comandos (`init`/`doctor`/`update`), `config/` (zod + prompts),
  `render/` (handlebars + manifest sha256), `util/scaffold` (aplica a árvore de templates). Sem
  shell-out — só `node:path`/fs, então a CLI é cross-platform por construção.
- `templates/engine/` — **espelha o layout-alvo**. Arquivos `.hbs` são renderizados (e perdem a
  extensão); o resto é copiado verbatim (a base stock do SpecKit nunca passa pelo engine).
- `scripts/extract-templates.mjs` — helper de authoring: copia + sanitiza a camada genérica de um projeto de origem.

---

## Roadmap

- **Fase 1 (feito):** o motor agnóstico + wrapper `init/doctor/update`. Cross-platform (Windows via WSL2).
- **Fase 2 (feito):** framework de add-ons (idempotente/reversível) + add-on `saas` (multi-tenant,
  whitelabel, service-roles) via `maker add saas` / `maker remove saas`; o wrapper cresce para
  `add`/`remove`.

### Backlog (próximos passos)

- [ ] **Novos add-ons sobre o mesmo framework:**
  - [ ] `observability` — princípios de logging/erros/eventos com contexto, neutros quanto a sink.
  - [ ] `i18n` — princípios de internacionalização (label maps, sem string hard-coded).
- [ ] **`maker list`** — listar add-ons disponíveis e quais estão aplicados no projeto (via `.maker/addons/`).
- [ ] **`maker update` com merge inteligente** — hoje só reescreve arquivos intocados por hash; evoluir
  para um 3-way merge que preserve edições locais em arquivos também atualizados pelo motor.
- [ ] **`maker doctor` ciente de add-ons** — reportar add-ons aplicados e reconciliar as injeções.
- [ ] **Publicação no npm** (`@vinics12/maker`) — hoje roda via `npx .` local / `npm link`.
- [ ] **Perfis de backend/stack opcionais** — abstrair o gancho já documentado para além do "clone fiel".
