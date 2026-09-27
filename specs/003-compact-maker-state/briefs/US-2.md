# US-2 Brief — init/update/mediação: formato efetivo, migração transacional e relatório [backend]

## Objetivo
Tornar `"pack"` o padrão: `init` e `update` resolvem o formato efetivo (config → manifest → `"pack"`),
migram nos dois sentidos numa única transação com rollback, consolidam formatos misturados pela união
verificada, podam órfãs (só o update), registram `basesFormat` e anunciam a migração. A mediação
(`--apply-resolutions`) opera no formato em uso. Também entrega os templates `.maker/.gitattributes` e
`.maker/.gitignore` e as duas correções que eles exigem no código: mediação desses caminhos (B1) e
preservação de um arquivo pré-existente não rastreado (B2). Reconciliação, dry-run e códigos de saída ficam
idênticos nos dois formatos.

## ACs cobertos
- Spec US1: AC-01, AC-02, AC-03, AC-06, AC-07, AC-30 (parte `--apply-resolutions`), AC-31, AC-32,
  AC-34, AC-36 (init/update), AC-37; AC-19/AC-38/AC-39 para `init` sobre install existente, `update` e
  `--apply-resolutions`.
- Spec US2: AC-08, AC-09, AC-10, AC-11, AC-12, AC-13.
- Spec US3: AC-35 (parte do update: registra `"files"`, não migra).
- Spec US5: AC-24, AC-25, AC-26, AC-27.
- Spec US4: AC-23 (parte de código: mediação dos arquivos de controle e arquivo pré-existente não
  rastreado preservado — P4); FR-027/FR-028 (conteúdo dos templates), FR-029.
- FR-003 lido de `maker.config.json` pelo update (inválido → aborta; JSON malformado → sem migração).
- FR-005, FR-006, FR-006b, FR-006c, FR-011, FR-013..FR-022; SC-002, SC-003, SC-004, SC-007.

## Contexto necessário
- Depende de **US-1** (API congelada em `contracts/state-api.md`): `openState`, `planStateWrite`,
  `configuredBasesFormat`, `effectiveBasesFormat`, `planFormatTransition`, `InstallState.readBase`,
  hook `crashAfter`, `test/helpers/state.ts`.
- Plano: `plan.md` §3 D5, D6, D7. Saídas: `contracts/cli-output.md` §1, §3.
- `planUpdate` (`src/commands/update.ts`) já recebe/abre o estado depois da US-1 e acumula as bases
  referenciadas num `Map`; o doctor também chama `planUpdate` (modo `read`) — não quebre essa chamada.
- A mediação exportada fica em `.maker/mediation` (fora do estado); `applyResolutions` grava bases das
  propostas.
- `isMediablePath` (`src/commands/mediation.ts:393-399`) recusa todo `.maker/*` fora de
  `.maker/workflow/` e exige que o caminho esteja no manifest; `test/mediation.integration.test.ts:227`
  prova que `.maker/manifest.json` é recusado.
- `planUpdate` sobrescreve arquivo do engine sem entrada no manifest (`!recorded` + `force`,
  `src/commands/update.ts:196-199`).
- Conteúdo exato dos templates e regras B1/B2: `contracts/git-control-files.md`.

## Decisões fixadas
- `update`: `planStateWrite({ format: efetivo, consolidate: true, prune: true })`; `basesFormat` =
  efetivo sempre (AC-35). `init` sobre install existente: `consolidate: true, prune: false`. `init`
  novo: formato da config carregada ou `"pack"` (AC-06).
- Transição (`planFormatTransition`) anunciada no dry-run e no aplicado, com opt-out só quando
  `reason = "default"`; relatório lista cada base descartada com hash, origem, motivo e arquivos
  afetados. Base corrompida não migra e recebe o tratamento atual de base ausente (preserva + mediação).
- `--apply-resolutions`: formato em uso, sem consolidar nem podar, `basesFormat` preservado.
- Códigos de saída do update inalterados; migração não altera código.
- **B1**: `isMediablePath` aceita exatamente `GIT_CONTROL_FILES` (de `src/state/paths.ts`), rastreados ou
  não; `.maker/manifest.json`, `.maker/maker.lock`, `.maker/bases/**`, `.maker/addons/*.json` e todo outro
  `.maker/*` fora de `.maker/workflow/` continuam recusados.
- **B2** (só para `GIT_CONTROL_FILES`): existente sem entrada no manifest e idêntico ao upstream → passa a
  ser rastreado; diferente → `preserve` + mediação `local-edit` "arquivo pré-existente não rastreado pelo
  maker" (base nula), nunca sobrescrito. Não generalize para outros caminhos.
- Templates: `.gitignore` versionado como `.gitignore.hbs` (o `npm pack` descarta `.gitignore`).
- `maker.config.json` malformado com config no manifest → update segue como hoje, sem migração, com aviso;
  `state.bases` inválido → aborta antes de escrever (`cli-output.md` §1).
- Paridade (AC-09): compare só entradas do plano com `source ≠ "metadata"`.
- Crash (AC-10b): `applyChangePlan(plan, { crashAfter })`, depois um comando mutante (ou
  `openState({ mode: "mutate" })`) recupera antes de ler; compare com `snapshotTree` do estado anterior.
- AC-37: implemente no teste um leitor mínimo do contrato 1.0.0 (install ⇔ `existsSync(".maker/manifest.json")`);
  não execute o binário antigo.

## Runbook
1. `planUpdate`: formato efetivo, transição, `planStateWrite` com consolidate/prune, `basesFormat`,
   `UpdatePlanning.transition`.
2. `runUpdate`: anúncio (dry-run e aplicado), descartadas, opt-out.
3. `init`: formato efetivo novo/existente; anúncio.
4. `mediation.ts`: formato em uso.
5. Templates (T214), B1 (T215), B2 (T216).
6. Testes T205–T212 (incluindo B1 em T211 e B2 em T205); depois adapte as suítes legadas do escopo e
   as contagens que os templates novos mudam (T213). Verify completo.

## Tocar SOMENTE:
- `src/commands/update.ts`
- `src/commands/init.ts`
- `src/commands/mediation.ts`
- `test/commands/update.pack.test.ts`
- `test/commands/update.reverse.test.ts`
- `test/commands/update.dry-run.test.ts`
- `test/commands/update.parity.test.ts`
- `test/commands/update.rollback.test.ts`
- `test/commands/init.pack.test.ts`
- `test/commands/mediation.pack.test.ts`
- `test/commands/legacy-reader.test.ts`
- `test/update.integration.test.ts`
- `test/mediation.integration.test.ts`
- `test/init.integration.test.ts`
- `test/legacy-agent.integration.test.ts`
- `test/engine.test.ts` (só contagens/listas)
- `templates/engine/common/.maker/.gitattributes`
- `templates/engine/common/.maker/.gitignore.hbs`

## NÃO tocar
`src/state/**` e `test/helpers/state.ts` (congelados — US-1), `src/commands/doctor.ts`,
`src/addons/doctor.ts`, `src/state/diagnose.ts` (US-3), `src/commands/agent.ts`,
`src/util/engine-scaffold.ts`, `src/addons/apply.ts` (US-5), outros `templates/**` (a skill
`maker-update` é da US-4; o `.gitattributes` de raiz não muda), `scripts/**`, `docs/**`, `dist/**`.

> Paralela com US-3 (doctor). Seus testes de AC-36 chamam `runDoctor`; mantenha a asserção no que o
> contrato garante (`✓ Install íntegro.` e exit 0), não em linhas intermediárias do doctor.
