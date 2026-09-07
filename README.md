# maker

Encapsulador do **sistema de criação de produtos e desenvolvimento** — SpecKit + orquestração
multi-agente (brainstorm → spec → arquitetura → dev → review, com 4 gates humanos) — extraído do
`sgmi-platform` para ser **reinstalável em qualquer projeto**.

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

> Alternativa sem WSL: **Git Bash** roda os `.sh` e o `grep`, mas o suporte é parcial (algumas
> ferramentas POSIX faltam). Prefira o WSL2. O PowerShell/CMD nativo **não** é suportado para o
> workflow gerado.
>
> Se você rodar `maker init` no Windows nativo, a CLI instala os arquivos normalmente e **avisa** para
> usar o WSL antes de rodar o pipeline.

---

## Instalação

```bash
npm i -g @arruda-eng/maker
# ou sem instalar:
npx @arruda-eng/maker init
```

(No Windows, rode isso dentro do WSL/Ubuntu — ver acima.)

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

Em `wrapper/` há um plugin do Claude Code que expõe `/maker init | doctor | update`, delegando para
a CLI. Ele nasce junto com o motor e cresce por fase (a Fase 2 adiciona `add`/`remove`).

---

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
  `render/` (handlebars + manifest sha256), `util/scaffold` (aplica a árvore de templates). Sem
  shell-out — só `node:path`/fs, então a CLI é cross-platform por construção.
- `templates/engine/` — **espelha o layout-alvo**. Arquivos `.hbs` são renderizados (e perdem a
  extensão); o resto é copiado verbatim (a base stock do SpecKit nunca passa pelo engine).
- `scripts/extract-from-sgmi.mjs` — helper de authoring: copia + sanitiza a camada genérica.

---

## Roadmap

- **Fase 1 (feito):** o motor agnóstico + wrapper `init/doctor/update`. Cross-platform (Windows via WSL2).
- **Fase 2:** framework de add-ons + add-on `saas` (multi-tenant, whitelabel, service-roles) via
  `maker add saas` / `maker remove saas`; o wrapper cresce para `add`/`remove`.
