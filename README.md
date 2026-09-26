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
| **Windows** | **Use o WSL2** — Linux real dentro do Windows. Ubuntu é a distro padrão (e a dos exemplos abaixo), mas **qualquer distro serve** (Debian, Fedora, Alpine…); o que importa é ter bash + git + Node. |

### Windows — passo a passo (WSL2)

O objetivo é ter o motor rodando **dentro de uma distro Linux**, não no PowerShell/CMD nativo (onde
os scripts `.sh` e o `grep` não existem).

1. Instale o WSL2 (PowerShell como admin, uma vez só). Ubuntu é a padrão; troque com `-d <distro>`
   (veja as opções com `wsl -l -o`):
   ```powershell
   wsl --install            # Ubuntu (padrão) — ou: wsl --install -d Debian
   ```
   Reinicie se pedir e abra a distro pelo menu Iniciar.
2. Dentro da distro, instale Node (via [nvm](https://github.com/nvm-sh/nvm)) e Git. No
   Ubuntu/Debian é `apt`; em outras troque pelo gerenciador da distro (`dnf`, `apk`…):
   ```bash
   sudo apt update && sudo apt install -y git curl
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source ~/.bashrc && nvm install --lts
   ```
3. **Trabalhe com os arquivos dentro do Linux** (ex.: `~/dev/meu-projeto`), não em `/mnt/c/...` — o
   filesystem nativo do WSL é muito mais rápido e evita problemas de fim-de-linha/permissão.
4. Use o Claude Code, o Codex e a CLI `maker` normalmente **de dentro da distro**.

5. Abra sua CLI agêntica **apontando para o WSL** (ou rode `claude`/`codex` dentro da distro) e trabalhe
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

### 1. npm (recomendado)

```bash
npm i -g @vinicius.cerqueira/maker
maker --version
```

### 2. Release tarball (GitHub-only, sem registry)

```bash
npm i -g https://github.com/vinics12/maker-kit/releases/latest/download/maker.tgz
```

URL **estável** — sempre aponta para a última [release](https://github.com/vinics12/maker-kit/releases),
sem versão no caminho. Instala o pacote já buildado, sem clonar nem compilar.

### 3. Clonar + link

```bash
git clone https://github.com/vinics12/maker-kit
cd maker-kit
pnpm install && pnpm build   # dist já vem versionado; o build só garante freshness
npm link                     # deixa `maker` no PATH; ou use `node dist/cli.js` direto
```

### 4. Plugin do Claude Code (o comando `/maker`)

Instalável do GitHub (ver *Wrapper de skill* abaixo) — porém o plugin **delega para a CLI**, então a
CLI ainda precisa estar no PATH (instale por 1, 2 ou 3 antes).

> ⚠️ **Evite `npm i -g github:vinics12/maker-kit`.** Em algumas versões do npm, o install global de
> uma dependência git cria um symlink quebrado para o cache (falha com `code 127` ou some depois). Use
> o **npm** (1) ou a **release tarball** (2). No Windows, rode qualquer uma dentro do WSL.

---

## Como usar (passo a passo)

### 1. Instalar o motor no seu projeto

No diretório do projeto-alvo:

```bash
maker init
```

Ele pergunta (interativo) os **knobs mecânicos** — nada de regra de negócio:

- **CLI agêntica inicial** (`claude`, padrão, ou `codex`)
- **Nome / slug** do projeto
- **Globs de layout** (o que é frontend vs backend, pro roteamento de dev)
- **Comandos** do projeto: `verify` (lint+types+test), `build`, `test`, `dev`

Prefere não-interativo? Crie um `maker.config.json` e aponte com `--config`:

```jsonc
{
  "agent": "codex",
  "project":  { "name": "Acme Platform", "slug": "acme-platform" },
  "layout":   { "frontendGlobs": ["apps/*/src/**"], "backendGlobs": ["services/**"] },
  "commands": { "verify": "pnpm verify", "build": "pnpm build", "test": "pnpm test", "dev": "make dev" }
}
```

```bash
maker init --target ./meu-projeto --config maker.config.json
# mínimo, sem prompts:
maker init --yes --name "Acme Platform"
# escolher explicitamente o Codex:
maker init --yes --name "Acme Platform" --agent codex
# reinstalar por cima de um install existente:
maker init --force
```

Antes de escrever, o `init` renderiza a instalação esperada e verifica **todas** as saídas. Arquivos
idênticos são aceitos; conteúdo diferente ou uma estrutura incompatível (por exemplo, um arquivo
onde deveria existir um diretório) faz o comando abortar com a lista completa de colisões, sem
alterar o projeto. Use `--force` somente quando quiser substituir explicitamente todos os caminhos
listados. Numa reinstalação sem nova configuração, o Maker reutiliza a configuração registrada no
manifest existente.

O init instala uma única integração. Para habilitar a outra depois, sem remover a atual:

```bash
maker agent add codex   # em um projeto inicialmente Claude
maker agent add claude  # em um projeto inicialmente Codex
maker agent list        # mostra integrações e integridade estrutural
```

### 2. Declarar as bases técnicas e regras (você preenche)

O motor é agnóstico. Depois do install, abra e preencha:

- `.specify/memory/project-rules.md` — **banco, montagem de testes, observabilidade, serviço local**
  e as regras de negócio do produto.
- `.specify/memory/constitution.md` — os princípios de **Processo** (PR1–PR6) já vêm prontos; preencha
  as seções **Bases Técnicas** e **Princípios do Projeto**.
- `.specify/memory/product-overview.md` — visão de produto.

### 3. Rodar o pipeline

No Claude Code:

```
/run-brainstorm "ideia difusa"   # exploração → design doc → handoff
/run-spec "feature bem definida" # spec → plan → dev → aceite (4 gates humanos)
```

No Codex:

```text
$run-brainstorm "ideia difusa"
$run-spec "feature bem definida"
```

### 4. Manter a instalação

```bash
maker doctor    # verifica integridade (manifest sha256): arquivos ausentes/modificados
maker update             # atualiza e mescla mudanças locais/upstream quando possível
maker update --dry-run   # mostra o plano completo sem escrever
maker update --no-merge  # preserva edições locais sem tentar merge
```

Ao atualizar um add-on legado, `maker update --dry-run` mostra a migração dos agentes Claude
para papéis compartilhados. O reparo preserva o corpo dos agentes e a constitution; conteúdo
divergente no destino é sinalizado para revisão. Veja
[migração de agentes legados](docs/features/transactional-update.md#migração-dos-agentes-legados).

---

## O que é instalado no projeto-alvo

- `.specify/` — base **SpecKit** stock (scripts, templates, workflows) + memória do motor.
- `AGENTS.md` — contexto compartilhado e fonte principal de instruções do projeto.
- Claude: `.claude/skills/`, `.claude/agents/` e um `CLAUDE.md` curto que referencia `AGENTS.md`.
- Codex: `.agents/skills/` e `.codex/agents/*.toml`.
- `.maker/workflow/agents/` — papéis canônicos do pipeline (`spec-author`, `spec-reviewer`, `architect`,
  `plan-reviewer`, `dev`, `code-reviewer`, `pm-validator`, `ux-designer`, `visual-reviewer`,
  `e2e-planner`, `e2e-runner`, `feature-cataloguer`), compartilhados pelos adaptadores. **Todos leem a
  constitution do projeto** — nenhuma regra de negócio é codificada no motor.
- `.specify/memory/` — `constitution.md` (Processo PR1–PR6 + seções vazias) e os stubs guiados
  `project-rules.md` / `product-overview.md`.
- `.maker/manifest.json` — inventário sha256 usado por `doctor`/`update`.

---

## Wrapper de skill (Claude Code e Codex)

Além da CLI, o `maker` inclui um **plugin do Claude Code** (em `wrapper/`) que expõe o comando
`/maker`, conduzindo a instalação pela conversa e delegando 100% para a CLI. Assim você opera o motor
sem sair do Claude Code.

### Pré-requisito

A CLI `maker` precisa estar no `PATH` (o plugin só a orquestra, não a substitui):

```bash
npm i -g @vinicius.cerqueira/maker
maker --version   # confirmar  ·  ver seção Instalação para outras formas
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
`agent add | agent list` (integrações), além de `add | remove` (add-ons).

### Wrapper no Codex

O diretório `wrapper/` também é um plugin portátil de Agent Skills (`plugin.json` + `skills/`). Para
uso imediato, instale a skill do repositório com o `$skill-installer` do Codex apontando para
`wrapper/skills/maker`; depois invoque `$maker init`, `$maker agent list`, `$maker doctor`, etc.
Se a skill recém-instalada não aparecer, reinicie o Codex para recarregar a descoberta de skills.

> No Windows, faça tudo isso dentro do WSL (ver a seção de requisitos por SO).

---

## Add-ons

Add-ons sobrepõem **pacotes de regras opcionais** a um projeto que já tem o motor — injetando
princípios na constitution, fragmentos nos papéis compartilhados e arquivos de referência, de forma **idempotente e
reversível** (rastreada por marcadores e por um estado em `.maker/addons/<id>.json`).

```bash
maker list
maker add saas --set tenantColumn=tenant_id --set brandVarPrefix=--brand- --set roles=admin,member
maker remove saas
```

`maker list` funciona mesmo fora de um projeto inicializado e mostra o catálogo local, versões,
knobs e o próximo comando. Dentro de um projeto, também classifica cada add-on como `available`,
`applied` ou `degraded` a partir do estado em `.maker/addons/`.

### `saas` — base multi-tenant / whitelabel / service-roles

O primeiro add-on injeta três princípios (SaaS-1 multi-tenant, SaaS-2 whitelabel, SaaS-3 service-role)
na seção **Princípios do Projeto** da constitution, mais fragmentos no `code-reviewer` e no `architect`,
e um `.specify/memory/saas-reference.md`. Os princípios são **neutros quanto a banco** — a implementação
Supabase/RLS entra só como referência; se seu projeto usa outra stack, o princípio continua valendo e o
teste E2E de isolamento é o que o prova.

Knobs: `tenantColumn` (discriminador de tenant), `brandVarPrefix` (prefixo das CSS vars) e `roles`.
`maker remove saas` reverte tudo e deixa o `doctor` verde; arquivos que você editou localmente são
preservados.

## Troubleshooting das integrações

- **Skill não aparece no Codex:** confirme `.agents/skills/<nome>/SKILL.md` e reinicie o Codex; a
  descoberta acontece a partir do diretório atual até a raiz do repositório.
- **Agente Codex não aparece:** rode `maker doctor` e `maker agent list`; os arquivos devem estar em
  `.codex/agents/*.toml` e apontar para um papel existente em `.maker/workflow/agents/`.
- **`maker agent add` encontrou colisões:** a CLI lista cada arquivo não gerenciado e não escreve
  nada. Mova/renomeie os arquivos indicados e tente novamente.
- **Integração degradada:** `maker doctor` valida frontmatter das skills, TOML dos agentes Codex,
  adaptadores Claude, arquivos compartilhados e hashes do manifest.
- **Browser/MCP indisponível:** o pipeline registra `NO_DRIVER` e transfere a validação visual/E2E
  para o gate humano; isso não deve bloquear o restante do fluxo.

## Desenvolvimento

> Contribuindo? Leia o **[CONTRIBUTING.md](CONTRIBUTING.md)** — os dois níveis de contribuição
> (motor × metodologia), o caminho de uma feature via `/run-spec` (dogfooding self-host), as
> convenções de branch/commit/release e a política de artefatos (combustível vs. documentação).

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
- `templates/engine/common` contém o núcleo, `workflow` as fontes únicas de skills/papéis e
  `providers` os adaptadores estáticos. O scaffolder materializa o layout Claude ou Codex.
- `scripts/extract-templates.mjs` — helper de authoring: copia + sanitiza a camada genérica de um projeto de origem.

---

### Cortar uma release

Releases são geradas pelo Release Please a partir dos Conventional Commits em `main`:

1. Commits `fix:` geram patch, `feat:` geram minor e `BREAKING CHANGE`/`!` geram major.
2. O workflow **Release Please** abre ou atualiza um Release PR com versão e changelog.
3. O merge desse PR cria a tag `vX.Y.Z` e a GitHub Release.
4. O workflow **Publish** valida o pacote, publica no npm via OIDC e anexa `maker.tgz` e
   `maker.tgz.sha256` à release.

O nome fixo `maker.tgz` mantém `releases/latest/download/maker.tgz` estável. Se a publicação falhar,
reexecute **Publish** para a mesma release; o job não tenta republicar uma versão que já existe no
npm e substitui os assets pelos artefatos novamente verificados.

Antes de abrir um PR, rode:

```bash
pnpm verify
pnpm package:smoke
```

`pnpm verify` também falha quando `dist/` não foi regenerado após uma mudança em `src/`.

## Roadmap

- **Fase 1 (feito):** o motor agnóstico + wrapper `init/doctor/update`. Cross-platform (Windows via WSL2).
- **Fase 2 (feito):** framework de add-ons (idempotente/reversível) + add-on `saas` (multi-tenant,
  whitelabel, service-roles) via `maker add saas` / `maker remove saas`; o wrapper cresce para
  `add`/`remove`.

### Backlog (próximos passos)

- [ ] **Novos add-ons sobre o mesmo framework:**
  - [ ] `observability` — princípios de logging/erros/eventos com contexto, neutros quanto a sink.
  - [ ] `i18n` — princípios de internacionalização (label maps, sem string hard-coded).
- [x] **`maker list`** — listar add-ons disponíveis e quais estão aplicados no projeto (via `.maker/addons/`).
- [x] **`maker update` com merge inteligente** — 3-way merge que preserva edições locais.
- [x] **`maker doctor` ciente de add-ons** — reportar add-ons aplicados e reconciliar as injeções.
- [x] **Publicação no npm** — `npm i -g @vinicius.cerqueira/maker` (v0.2.0 publicada).
- [x] **Release automatizada** — Release Please, npm Trusted Publishing e tarball com checksum.
- [ ] **Perfis de backend/stack opcionais** — abstrair o gancho já documentado para além do "clone fiel".
