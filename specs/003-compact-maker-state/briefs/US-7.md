# US-7 Brief — Estado de add-ons dentro do lockfile em pack (emenda, Clarification 23) [backend]

## Objetivo
Em pack, o estado de cada add-on aplicado passa a viver na seção `[addons]` do `.maker/maker.lock`, e
`.maker/addons/` deixa de existir. Assim o `maker remove` da 1.0.0 publicada (que decide o fluxo por
`.maker/addons/<id>.json` antes de ler o manifest) responde "não está aplicado" sem escrever nada. Em
files nada muda para o consumidor (`.maker/addons/<id>.json`, compatível com a 1.0.0). A migração leva o
estado de add-on junto, na mesma transação, nos dois sentidos. Documentação, números (≤ 15) e texto de
release corrigidos; `dist/cli.js` reconstruído no fim.

US-1..US-6 estão implementadas e aprovadas: **não reescreva** o que elas entregaram além do necessário
para esta emenda.

## ACs cobertos
- Novos: **AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47** (AC-47/FR-035 vêm da Clarification 24,
  aplicada à spec pelo spec-author em paralelo — confira o texto final na spec antes de T727–T730).
- Alterados pela emenda: **AC-01** (sem `.maker/addons/` após migrar), **AC-28** (taxonomia com add-ons
  no lockfile; toda contagem diz o install), **AC-36** (sem `.maker/addons/`; diretório vazio tolerado e
  removido no próximo update), **AC-37** (ordem de leitura real de cada comando da 1.0.0, inclusive
  `add` e `remove`), **AC-39** (seção de add-ons ilegível; `list` falha), **SC-001** (≤ 15).
- FR: FR-001, FR-002 (trade-off com add-ons), FR-006a, FR-006b, FR-006c, FR-007, FR-009, FR-009a, FR-010a,
  FR-015, FR-031..FR-035.

## Contexto necessário (leia antes de codar)
- Spec: `specs/003-compact-maker-state/spec.md` — Clarification 23, AC-36..AC-46, FR-006a..c,
  FR-031..FR-034, edge cases de versões misturadas/coexistência.
- Plano: `plan.md` **§10 (D9–D13)** — decisões fechadas; D1–D8 continuam valendo.
- Contratos: `contracts/lockfile-format.md` (§1 gramática, §3 parse, **§5 seção de add-ons**, L16–L22),
  `contracts/state-api.md` (**"Emenda US-7"** — assinaturas exatas), `contracts/cli-output.md` (§2
  códigos novos, §3 abortos novos, **§3a `list`**, **§5 texto de release corrigido**),
  `data-model.md` §4.
- Código atual: `src/state/{paths,lockfile,store,diagnose}.ts`, `src/addons/{state,apply,doctor}.ts`,
  `src/agents/migrate.ts` (`loadState`, fim de `planLegacyAddonAgents`), `src/commands/{add,remove,
  list,doctor,update,mediation}.ts`, `test/helpers/state.ts`.
- Referência 1.0.0 (para AC-37/AC-42, sem shell-out em `src/`): `git show v1.0.0:src/commands/remove.ts`
  (l. 11-16), `v1.0.0:src/addons/apply.ts` (l. 91-100 `applyAddon`, 218-226 `removeAddon`),
  `v1.0.0:src/addons/state.ts` (l. 7-41), `v1.0.0:src/render/manifest.ts` (l. 53-57),
  `v1.0.0:src/commands/{update.ts:113-114, agent.ts:21-22, doctor.ts:18-20, add.ts:53, list.ts:58-61}`.

## Decisões fixadas (não reabrir; divergência = parar e reportar)
1. **Formato**: continua `maker-lockfile 1`; `[addons]` **obrigatória**, entre `[manifest]` e `[bases]`,
   sempre emitida (vazia sem add-ons). Nenhuma normalização de lockfiles sem `[addons]` (viram
   `addons-invalid`). Primeira linha de comentário do cabeçalho passa a
   `# Estado do maker (manifest, add-ons e bases). Gerado pela CLI — não edite à mão.`
2. **Unidade**: `addon "<id>"` + um campo por linha `  <chave> <canonicalJson>`, campos em code unit,
   sem campo `id`; unidades por id em code unit; arrays na ordem do registro; `injectedBlocks` só se
   presente; extras desconhecidos preservados (`passthrough`).
3. **JSON em files**: `addonStateJson` = ordem de topo `id, version, appliedAt, knobs, createdFiles,
   injectedTargets, injectedBlocks`, extras depois; itens de `createdFiles` `{ path, hash }`;
   `JSON.stringify(…, null, 2) + "\n"`. Deve ser **byte a byte** o que `applyAddon` grava hoje
   (`src/addons/apply.ts:199-210`) — o teste compara com o JSON gerado pelo código atual antes da troca.
4. **Schema** movido para `src/state/addon-state.ts` sem mudança (idêntico à 1.0.0); `src/addons/state.ts`
   vira fachada. `writeAddonState`, `deleteAddonState` e `addonStatePath` **saem de `src/`**.
5. **Camada única**: `InstallState.addons`/`addonProblems`; `planStateWrite(next.addons?)` — omitido
   carrega `state.addons`. `init.ts`, `agent.ts` e `format.ts` **não mudam** (e não estão no Tocar
   SOMENTE): se precisarem mudar, pare e reporte.
6. **Idempotência em files**: só escreve `.maker/addons/<id>.json` quando o registro difere
   (`canonicalJson`) do lido; remove só ids que estavam em `state.addons` e saíram; nunca toca ids com
   problema de leitura.
7. **Coexistência**: lockfile + ≥ 1 `.maker/addons/*.json` regular → `StateError("addon-coexistence")`
   (depois da coexistência de manifest, que tem precedência). `.maker/addons` sem `*.json` ou
   não-diretório em pack: tolerado sem achado; `planStateWrite(pack, consolidate: true)` remove o
   diretório **só se vazio**.
8. **Migração bloqueada**: `planStateWrite` para pack a partir de files com `addonProblems` ou registro
   com `id` ≠ chave → `StateError("addon-state-invalid")` antes de planejar (mensagem em
   `cli-output.md` §3).
9. **Ordem transacional**: `isStateMetadata` também reconhece o diretório `ADDONS_DIR`. Esperado:
   files → pack = `maker.lock` criado → `.maker/addons` removido → `manifest.json` removido.
10. **`remove.ts`** sem pré-checagem; `removeAddon` abre o estado em `mutate`/`dry-run` (StateError
    propaga) e, sem install ou sem o id, lança `Add-on "<id>" não está aplicado em <dir>.`
11. **`list`**: `inspectState`; `snapshot.error` → lança o `StateError`; pack lê do lockfile e ignora
    `.maker/addons`; files mantém mensagens atuais montadas com `ADDONS_DIR`.
12. **AC-42/AC-37**: simuladores fiéis + fixture de controle (plan D10). **Não** adicione
    `@vinicius.cerqueira/maker@1.0.0` como dependência (avaliado e descartado em D10). Pino opcional da
    tag com `skipIf` quando não houver git/tag.
13. **AC-45**: add-ons sintéticos `alpha` e `zeta` em `fixtures/addons-synthetic/` (addon.json + 1
    fragmento de agente + 1 arquivo criado cada; alvos e caminhos **disjuntos** entre si e dos do
    `saas`), carregados por `vi.mock` parcial de `src/addons/loader.js` via `test/helpers/addons.ts`.
    Base do merge: install em pack com `saas` aplicado; branch A aplica `alpha`, branch B aplica `zeta`
    (unidades em intervalos distintos: `alpha` < `saas` < `zeta`); o teste **assere a pré-condição**
    (as unidades `file` novas e as `addon` novas não compartilham intervalo). Variante de remoção: base
    com os três; A remove `alpha`, B remove `zeta`. Caso do mesmo intervalo fica no proxy L22 (conflito
    documentado) — não tente "resolver".
14. **Docs**: números sempre com o install a que se referem: 1.0.0 real = **101** arquivos em `.maker`
    e **86** bases; referência desta versão: pack **15**, files **137**. Texto de release = §5 de
    `cli-output.md` (versão corrigida).
15. PR5: sem comentários com FR/AC em `src/`; comentário só para o porquê não óbvio (ex.: por que o
    diretório `.maker/addons` é metadado de estado; por que JSON de files só é reescrito se mudou).
16. **S1 (D13)**: registro de files válido com chave de topo fora de `[A-Za-z][A-Za-z0-9]*` ou `id` ≠
    nome continua funcionando em files, mas é **não migrável** (`unmigratableAddons`) →
    `addon-state-invalid` ao planejar pack; `serializeLockfile` nunca emite linha fora da gramática.
17. **S2/S4 (D9, D13)**: JSON órfão sem install nunca é "aplicado": `init` aborta (`addon-coexistence`
    variante órfã), `remove` "não está aplicado", `list` `degraded`, `doctor` "nenhum install" + menção.
18. **S3**: `.maker/addons` não-diretório + escrita de JSON necessária → `addons-dir-invalid` no
    planejamento (nunca `ENOTDIR` no meio da transação).
19. **FR-035**: doctor `addon-state-invalid` **warn** só com migração files → pack pendente.
20. **S7 (D10)**: reforço com o binário real da tag via `test/helpers/legacy-binary.ts`: extração
    **dentro** de `<repo>/node_modules/.cache/` (fora do repo os imports nus do bundle não resolvem —
    verificado); `skip` com motivo sem git/tag ou com `dependencies` divergentes. O simulador continua.
    Nenhuma dependência nova.

## Runbook
1. **Estado** (T701–T707): paths → addon-state → lockfile (+ L16–L22) → store (+ testes) → diagnose/
   doctor. `pnpm typecheck && pnpm test` pode ficar vermelho só nas suítes que T714 adapta; anote quais.
2. **Consumidores** (T708–T712): apply, add/remove, list, addons-doctor/doctor, migrate/update,
   mediation.
3. **Helpers e adaptação** (T713–T715): helpers novos, fixtures sintéticos, suítes legadas.
4. **Provas** (T716–T722): encapsulamento, AC-41/44, AC-43/36, list, legacy-reader (AC-37/42), git
   AC-45, paridade AC-46, referência ≤ 15. Suíte inteira verde:
   `pnpm typecheck && pnpm test && pnpm audit:coupling`.
5. **Docs** (T723–T725): `docs/maker-state.md`, `docs/MIGRATION.md`, `README.md`,
   `test/docs/maker-state.test.ts`, guia de aceite J1/J6/J7/J8 (+ "Achados" marcados como resolvidos pela
   Clarification 23).
6. **Revisão do plano** (T727–T731): S1, S2/S4, S3, FR-035, S7; acréscimo S8 em `docs/maker-state.md`.
7. **Entrega** (T726, **por último**): `pnpm build` (commitar `dist/cli.js` junto), `pnpm verify`,
   `pnpm package:smoke`. Commits por passo, prefixo `feat(003/us7):`/`test(003/us7):`/`docs(003/us7):`.
   Devolva ao orquestrador o texto final de release (`cli-output.md` §5) para o rodapé
   `BREAKING CHANGE:` do commit/PR de entrega.

## Tocar SOMENTE:
- `src/state/paths.ts`
- `src/state/addon-state.ts` (novo)
- `src/state/lockfile.ts`
- `src/state/store.ts`
- `src/state/diagnose.ts`
- `src/addons/state.ts`
- `src/addons/apply.ts`
- `src/addons/doctor.ts`
- `src/agents/migrate.ts`
- `src/commands/add.ts`
- `src/commands/remove.ts`
- `src/commands/list.ts`
- `src/commands/doctor.ts`
- `src/commands/update.ts`
- `src/commands/mediation.ts`
- `test/helpers/state.ts`
- `test/helpers/addons.ts` (novo)
- `fixtures/addons-synthetic/**` (novo)
- `test/state/addon-state.test.ts` (novo)
- `test/state/lockfile.test.ts`
- `test/state/store.test.ts`
- `test/state/diagnose.test.ts`
- `test/state/encapsulation.test.ts`
- `test/state/git-interop.test.ts`
- `test/state/reference-install.test.ts`
- `test/changes/transaction.test.ts`
- `test/commands/add.state.test.ts`
- `test/commands/agent.state.test.ts`
- `test/commands/doctor.state.test.ts`
- `test/commands/mediation.pack.test.ts`
- `test/commands/legacy-reader.test.ts`
- `test/commands/update.addons.test.ts` (novo)
- `test/commands/list.state.test.ts` (novo)
- `test/commands/addon.parity.test.ts` (novo)
- `test/commands/init.addons.test.ts` (novo)
- `test/helpers/legacy-binary.ts` (novo)
- `test/addon.integration.test.ts`
- `test/list.command.test.ts`
- `test/legacy-agent.integration.test.ts`
- `test/doctor.addon.test.ts`
- `test/docs/maker-state.test.ts`
- `docs/maker-state.md`
- `docs/MIGRATION.md`
- `README.md`
- `specs/003-compact-maker-state/acceptance-guide.md`
- `dist/cli.js`

> Suítes de US-2/US-3 fora da lista (`test/commands/update.{pack,reverse,dry-run,parity,rollback,
> gitcontrol}.test.ts`, `test/commands/init.pack.test.ts`, `test/update.integration.test.ts`,
> `test/mediation.integration.test.ts`, `test/init.integration.test.ts`, `test/engine.test.ts`) devem
> continuar verdes **sem edição**; se alguma quebrar, é sinal de que a mudança vazou comportamento —
> pare e reporte ao orquestrador antes de editar.

## NÃO tocar
`src/state/format.ts`, `src/commands/{init,agent,runs}.ts`, `src/addons/{loader,inject,schema}.ts`,
`src/changes/**`, `src/render/**`, `src/util/**`, `src/cli.ts`, `templates/**`, `addons/**` (catálogo
real), `scripts/**`, `package.json`, `pnpm-lock.yaml`, `CHANGELOG.md`, `release-please-config.json`,
`.release-please-manifest.json`, `docs/features/**`, `specs/**` exceto o guia de aceite, e todo `test/**`
fora da lista acima.
