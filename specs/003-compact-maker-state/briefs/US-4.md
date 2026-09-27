# US-4 Brief — Skill maker-update, interop git e contagem de arquivos [backend]

## Objetivo
Provar com o binário git que os arquivos de controle gerenciados (entregues pela US-2) fazem o que
prometem: CRLF não corrompe bases, temporários não aparecem, bases aparecem como geradas, e duas branches
mesclam o lockfile sem conflito nos casos cobertos pelo desenho. Provar a meta de contagem de arquivos
(SC-001) e o tamanho do lockfile (SC-008), garantir que os templates saem no pacote e fazer a skill
`maker-update` proibir a edição do lockfile.

## ACs cobertos
- Spec US4: AC-20, AC-21, AC-22, AC-23 (update: edição local rastreada preservada/mesclada). Spec US1: AC-40.
- FR-027, FR-028, FR-029, FR-030; SC-001, SC-006, SC-008.

## Contexto necessário
- Depende de US-1 (estado), US-2 (pack por padrão, migração, templates `.maker/.gitattributes` e
  `.maker/.gitignore`, B1/B2) e US-3 (doctor completo — AC-20/AC-40 exigem doctor verde).
- Conteúdo dos arquivos e tabela de provas: `contracts/git-control-files.md`. Plano: `plan.md` §3 D1
  (casos de merge verificados empiricamente e riscos residuais), D3.
- `templates/engine/workflow/skills/maker-update/SKILL.md`, seção "Hard rules" (linha 23): hoje proíbe
  editar `.maker/manifest.json`, `.maker/bases/` e `.maker/addons/*.json`.
- O engine já instala um `.gitattributes` **na raiz** (`templates/engine/common/.gitattributes`) — não o
  altere (Q2 do plano; leitura atual: raiz intocada, nada novo fora de `.maker`).
- `test/helpers/state.ts` expõe `hasGit()`, `initInstall`, `snapshotTree`, `lockfileText`.
- Os testes podem usar `node:child_process` para chamar o git: P1 vale para `src/`
  (`test/runs/no-shellout.test.ts` só varre `src/`).

## Decisões fixadas
- SKILL.md: acrescentar `.maker/maker.lock` à regra "never edit" (mesma frase, sem reescrever o resto).
- Testes dependentes de git: `it.skipIf(!hasGit())("…", …)` com motivo no nome/descrição; repositório
  temporário com `user.name`/`user.email` locais e `core.autocrlf=true` onde o AC pede.
- AC-40, a partir de um commit comum com install em pack, um cenário por caso (todos: `git merge` sai 0,
  lockfile sem marcadores, `doctor` verde):
  1. branch A edita localmente o arquivo gerenciado X e roda `maker update`; branch B faz o mesmo com Y,
     X e Y **não adjacentes** na ordem de caminho;
  2. idem com X e Y **adjacentes** na ordem de caminho;
  3. A provoca um campo novo na entrada de X (ex.: `edited`, via o helper de estado) e B edita Y vizinho;
  4. A adiciona uma unidade `file` nova (ex.: add-on que cria arquivo) e B edita a entrada vizinha.
  Não dependa de posições de hash (bases) para os cenários. O caso "duas unidades novas diferentes no
  mesmo intervalo" é conflito documentado — não o teste como sucesso.
- SC-001: conte arquivos que o git versionaria em `.maker` (exclua o que o `.maker/.gitignore` ignora);
  install de referência = Claude + Codex + add-on `saas`, sem `state.bases`.
- FR-030: compare o `.gitattributes` de raiz com o template e confirme que nenhum `.gitignore` de raiz
  foi criado.

## Runbook
1. SKILL.md (T401) e `package-smoke` (T402).
2. `test/commands/update.gitcontrol.test.ts` (AC-23, FR-029, FR-030) (T404).
3. `test/state/git-interop.test.ts` (AC-20, AC-21, AC-22, AC-40) (T403).
4. `test/state/reference-install.test.ts` (SC-001, SC-008) (T405). Verify completo + `pnpm package:smoke`.

## Tocar SOMENTE:
- `templates/engine/workflow/skills/maker-update/SKILL.md`
- `scripts/package-smoke.mjs`
- `test/state/git-interop.test.ts`
- `test/state/reference-install.test.ts`
- `test/commands/update.gitcontrol.test.ts`

## NÃO tocar
`src/**` (se algo no código impedir um AC, pare e reporte — é retorno ao Gate 2),
`test/helpers/state.ts`, `templates/engine/common/**` (templates de controle são da US-2; o
`.gitattributes` de raiz não muda), `docs/**`, `dist/**`, arquivos da US-5 (`src/commands/agent.ts`,
`src/util/engine-scaffold.ts`, `src/addons/apply.ts`, `test/commands/agent.state.test.ts`,
`test/commands/add.state.test.ts`, `test/agent.integration.test.ts`, `test/addon.integration.test.ts`).
