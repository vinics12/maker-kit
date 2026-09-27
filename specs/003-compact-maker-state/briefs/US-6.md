# US-6 Brief — Taxonomia de `.maker`, notas de release e build final [backend]

## Objetivo
Documentar o que há em `.maker` (4 categorias, versionar ou não, nos dois formatos), os formatos de
bases com default, trade-offs, escolha/troca, diagnóstico e recuperação; registrar a mudança de default
nas notas de release; e entregar o `dist/` reconstruído com a suíte e o smoke de pacote verdes.

## ACs cobertos
- Spec US6: AC-28, AC-29. FR-001, FR-002, FR-006a.

## Contexto necessário
- Comportamento final das US-1..US-5. Plano: `plan.md` §3 (D1 formato, D3 arquivos git, D5 1.0.0,
  D6 config, D7 migração), §9 (Q1 release, Q2 raiz). Contratos: `contracts/lockfile-format.md`,
  `contracts/git-control-files.md`, `contracts/cli-output.md` (§2 ações do doctor; §5 rodapé).
- Itens de `.maker` a classificar (estado autoritativo, snapshots de base, arquivos gerenciados,
  temporários): `maker.lock` (pack: manifest + bases), `manifest.json` e `bases/` (files),
  `addons/<id>.json`, `workflow/agents/*.md`, `.gitattributes`, `.gitignore`, `transactions/`,
  `transaction.lock`, `mediation/`, `runs/`. O lockfile contém duas categorias (estado autoritativo e
  snapshots): a tabela deve deixar isso explícito sem classificar o mesmo item em duas linhas
  contraditórias (uma linha por item; o lockfile é "estado autoritativo (contém também os snapshots)").
- Release: CHANGELOG gerado pelo Release Please a partir do commit (`docs/releasing.md`); nunca editar
  `CHANGELOG.md` à mão nem fazer bump.

## Decisões fixadas
- Documento novo `docs/maker-state.md`; `README.md` troca a linha de `.maker/manifest.json` por um
  resumo + link; `docs/MIGRATION.md` ganha a seção "Bases no formato pack por padrão".
- Trade-offs obrigatórios (FR-002): legibilidade por arquivo × número de arquivos/ruído de diff;
  `linguist-generated` colapsa no PR também as mudanças de manifest — para revisar, "Load diff" na
  plataforma, `git diff -- .maker/maker.lock` local, ou override local
  `.maker/maker.lock -linguist-generated` em `.git/info/attributes`; risco residual de conflito na seção
  de bases e como ele se recupera (`maker update`).
- Recuperação: coexistência, lockfile ilegível/em conflito, versão desconhecida, base ausente/corrompida
  (restaurar do git), CRLF (conferir `.maker/.gitattributes`; base recuperável é regravada pelo
  `maker update`), conflito de merge no lockfile (manifest → resolver/restaurar; bases → `maker update`;
  conflito intercalado deixa bases ausentes → restaurar do git ou mediação), `maker.config.json`
  ilegível (formato mantido, sem migração) e arquivo `.maker/.gitignore`/`.gitattributes` pré-existente
  (preservado e encaminhado para mediação).
- Compatibilidade 1.0.0: única mitigação além da ausência de `.maker/manifest.json` é o
  CHANGELOG/release notes; citar `init --force` e `init` sem `--force` em install pristine (D5).
- T604: prepare os textos das **duas** opções de `contracts/cli-output.md` §5 — A: `feat(state)!:` +
  rodapé `BREAKING CHANGE:`; B: `feat(state):` + seção `## Notas de release` no corpo do PR para o
  mantenedor colar nas release notes do Release PR. O orquestrador usa a opção decidida no Gate 2 (Q1).

## Runbook
1. `docs/maker-state.md` → `test/docs/maker-state.test.ts` (AC-28 automatizado contra install de
   referência em pack e em files, com temporários criados; AC-29 por presença de termos/procedimentos).
2. `README.md`, `docs/MIGRATION.md`.
3. `pnpm build` (commitar `dist/cli.js` junto), `pnpm verify`, `pnpm package:smoke`.
4. Entregar ao orquestrador os textos de commit/PR das duas opções (T604).

## Tocar SOMENTE:
- `docs/maker-state.md`
- `docs/MIGRATION.md`
- `README.md`
- `test/docs/maker-state.test.ts`
- `dist/cli.js`

## NÃO tocar
`src/**`, `templates/**`, `test/**` fora de `test/docs/maker-state.test.ts`, `CHANGELOG.md`,
`package.json`, `release-please-config.json`, `.release-please-manifest.json`, `docs/features/**`
(do `feature-cataloguer`).
