# Contribuindo com o `maker`

O `maker` se constrói com o próprio `maker` (**dogfooding**): uma feature nova nasce do pipeline
`/run-spec`, passa pelos 4 gates humanos e é catalogada em `docs/features/`. Este guia define o
caminho e as convenções.

> Pré-requisitos: Node ≥ 18, `pnpm`, Git. No Windows, faça tudo dentro do **WSL2** (o workflow gerado
> usa scripts POSIX). Veja a seção "Requisitos por sistema operacional" do [README](README.md).

---

## 1. Os dois níveis de contribuição

O repositório tem **duas superfícies** que se contribuem de formas diferentes. Saber em qual você
está mexendo é o primeiro passo.

| | **Motor** (o CLI) | **Metodologia** (o que é instalado) |
|---|---|---|
| Onde | `src/**` (TypeScript ESM) + `test/**` | `templates/engine/**` + `addons/**` |
| O que é | Os comandos `init/doctor/update/add/remove/runs` | O pipeline SpecKit + agentes + memória que o `maker init` copia para o projeto-alvo |
| Como testa | `vitest` (`pnpm test`) | Renderização/instalação em tmp (`test/*.integration.test.ts`) + `pnpm audit:coupling` |
| Guardrail | **P1 sem shell-out** (só `node:fs`/`path`) | **P2 agnóstico de negócio** (nenhuma regra vaza para `templates/engine/`) |

**Regras de ouro** (na `constitution.md`, P1–P4):
- **Sem shell-out** no motor: nada de `child_process`/`execSync`/`spawn`. Provado por
  `test/runs/no-shellout.test.ts`.
- **`templates/engine/` sem regra de negócio**: `pnpm audit:coupling`
  ([scripts/audit-coupling.mjs](scripts/audit-coupling.mjs)) falha se termos de negócio vazarem.
  Regras opcionais entram só como **add-on** (idempotente/reversível).
- `dist/` é **versionado** de propósito (instalação do GitHub sem build) — rode `pnpm build` antes de
  commitar mudanças de `src/`.

---

## 2. O caminho de uma feature (dogfooding com `/run-spec`)

### 2.1 Prepare o self-host (uma vez por clone)

O pipeline (`/run-spec`, skills, agentes) é um **artefato regenerável** — não é versionado. Os
inputs duráveis (`.specify/memory/` e `maker.config.json`) **estão** no repo. Materialize o resto:

```bash
pnpm install && pnpm build
node dist/cli.js init --force --config maker.config.json      # renderiza o pipeline (gitignorado)
git checkout -- .specify/memory docs/features/INDEX.md        # restaura os arquivos versionados que o init sobrescreveu
```

> ⚠️ **Por que o `git checkout`:** o `init` reescreve **toda** a árvore renderizada — inclusive os
> arquivos versionados que também são templates: `.specify/memory/*` (vira stub em branco) e
> `docs/features/INDEX.md` (vira o catálogo vazio). Restaure-os logo após o `init`. Todo o resto que
> o `init` escreveu (pipeline stock, `.claude/{skills,agents}`, `.maker/`, e os `CLAUDE.md`/`.mcp.json`/
> `.gitattributes` de raiz) é gitignorado.

Depois disso, ao evoluir `templates/engine/`, prefira `node dist/cli.js update` para regenerar o
pipeline: `update` reescreve só os arquivos do motor que você não editou e **preserva** a
`.specify/memory/` (ela aparece como "modificado/preservado" — é o esperado, memória é local).

> Tudo que o `init` gera além de `.specify/memory/` é ignorado pelo Git (ver [.gitignore](.gitignore)).
> O produto publicado no npm nunca inclui nada disso — `package.json` só empacota `dist/`,
> `templates/`, `addons/`.

### 2.2 Rode o pipeline

No Claude Code, no diretório do repo:

```
/run-brainstorm "ideia difusa"     # opcional — exploração → design doc
/run-spec "feature bem definida"   # spec → plan → dev → aceite
```

Os **4 gates humanos** (PR2, não-negociável):

| Gate | Depois de | O humano confirma |
|---|---|---|
| **1** | `spec.md` | O contrato (FR/SC/US) reflete a intenção |
| **2** | `plan.md` + `tasks.md` + `briefs/` | Arquitetura e decomposição |
| **3** | código + review | Diff correto antes do aceite |
| **4** | validação (`pm-validator`) | Cobertura de ACs + catálogo em `docs/features/` |

Em features **MINI**, Gate 1 e Gate 2 são fundidos (não removidos). A referência viva do fluxo é a
skill `run-spec`
([templates/engine/.claude/skills/run-spec/SKILL.md.hbs](templates/engine/.claude/skills/run-spec/SKILL.md.hbs));
o exemplo real ponta-a-ponta é [`specs/001-event-stream/`](specs/001-event-stream/) — **anterior a esta
política de artefatos** (§4), por isso mantido inteiro (com `tasks.md`, `briefs/`, `contracts/`,
`data-model.md`) como referência do fluxo completo.

---

## 3. Convenções (branch, commit, PR, release)

- **Branch**: `NNN-<slug>` sequencial (ex.: `001-event-stream`) ou `AAAAMMDD-HHMMSS-<slug>`.
  Validado pela skill `speckit-git-validate`. Cada branch sequencial tem um `specs/NNN-*/` casado.
- **Commit**: Conventional Commits com escopo SpecKit — `type(NNN/usN): TXXX — assunto`
  (ex.: `feat(001/us4): T401-T403 — agregação L1 rejeição por gate`). Assuntos em PT-BR.
  Tipos: `feat`/`fix`/`docs`/`chore`/`refactor`.
- **PR**: mergeado via **merge commit** (preserva os commits da feature).
- **Verify antes do PR**: `pnpm typecheck && pnpm test && pnpm audit:coupling` verdes.
- **Release** (mantém a URL estável `releases/latest/download/maker.tgz`): bump em
  `package.json` / `wrapper/.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` →
  `pnpm build && pnpm test` → commit → `npm pack` → `gh release create vX.Y.Z maker.tgz`
  (asset **sempre** nomeado `maker.tgz`). Detalhe no [README](README.md) §"Cortar uma release".

---

## 4. Política de artefatos — combustível vs. documentação

Nem todo artefato de `specs/NNN-*/` merece viver em `main`. Classifique por **valor após o merge**:

### Tier 1 — Combustível de execução (efêmero) → **podar no Gate 4**
Serve só durante o desenvolvimento; vira ruído/drift depois do merge.
- `tasks.md` — checklist de TODO; zero valor com todos os boxes marcados.
- `briefs/US-N.md` — handoff de dev + allowlist `Tocar SOMENTE` para o boundary-check de devs
  paralelos; puro andaime.
- Seções de **execução** do `plan.md` — paralelismo, dev slots, interseção de fronteiras (o código
  entregue já **é** a arquitetura).

O histórico de execução fica nos **commits** e no **PR** — não precisa dos arquivos em `main`.

### Tier 2 — Contrato / modelo (`contracts/*.md`, `data-model.md`) → **promover ao catálogo, depois podar**
A essência tem três lentes que vivem em lugares melhores:
- **executável** (zod, fórmulas, invariantes) já está em `src/` + `test/` — não duplicar em prosa;
- **as-built em linguagem de negócio** (invariantes, regras) → vai para `docs/features/*`;
- **intenção congelada** → é papel do `spec.md`.

Não mergear no `spec.md` (poluiria o registro de intenção). Promova o durável para o catálogo e pode
os arquivos junto com o Tier 1.

### Tier 3 — Durável → **fica em `main`**
- `spec.md` — o **único** artefato de spec que permanece: FR/SC/US, Given/When/Then, não-metas,
  assumptions. É o registro do que foi **pedido**.
- `docs/features/*.md` + `INDEX.md` — a verdade **as-built**, conceitual, que o `/run-brainstorm`
  relê. Mantida pelo `feature-cataloguer` no Gate 4.
- `acceptance-guide.md` — meio-termo: o que valer de forma durável **deve virar teste automatizado**;
  o resto é efêmero-de-gate.

**Estado final em `main` após o Gate 4:** `specs/NNN-*/spec.md` + `docs/features/*` + `src/`/`test/`
— nada de andaime de execução. O `feature-cataloguer` emite a lista de arquivos a podar; o
orquestrador/humano remove no commit do Gate 4.

> Exceção histórica: `specs/001-event-stream/` é **anterior** a esta política e foi mantida inteira
> como exemplo de referência do fluxo — não a tome como o estado-alvo de uma feature nova.

---

## 5. Checklist de PR

- [ ] `pnpm typecheck && pnpm test && pnpm audit:coupling` verdes
- [ ] `pnpm build` rodado (se mexeu em `src/` — `dist/` versionado atualizado)
- [ ] Branch `NNN-<slug>` + commits `type(NNN/usN): ...`
- [ ] `docs/features/` atualizado (Tier 3) e Tier 2 promovido ao catálogo
- [ ] Combustível (Tier 1 + arquivos Tier 2) podado da branch
- [ ] `git ls-files` não lista pipeline de dev (`.claude/skills`, `.claude/agents`, `.specify` stock, `.maker/`)

---

## 6. Gaps conhecidos (próximos passos, não bloqueiam contribuição)

Hoje as convenções vivem em skills de agente + disciplina humana. Automação ainda **não** existe e é
bem-vinda como contribuição:
- **CI** (GitHub Actions rodando `build` + `typecheck` + `test` + `audit:coupling` em PR) — não há
  `.github/` no repo.
- **Lint/format/commitlint/husky** — nenhum configurado; o único enforcement é `typecheck` + testes +
  `audit:coupling`.
- Alinhado ao Backlog do [README](README.md#roadmap).
