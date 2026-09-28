<!-- plan-depth: FULL -->
# Tasks — Estado compacto em `.maker` (lockfile do estado)

Verify de cada task: `pnpm typecheck && pnpm test && pnpm audit:coupling`.
Verify final (T605): `pnpm build && pnpm verify && pnpm package:smoke`.
Testes em `test/` espelhando `src/` (`test/state/*` ↔ `src/state/*`, `test/commands/*` ↔
`src/commands/*`). Suítes legadas planas (`test/*.integration.test.ts`) são adaptadas no lugar. Testes
que não espelham um arquivo de `src/` estão listados em `plan.md §4` (padrão de `no-shellout.test.ts`).
Sem shell-out em `src/` (P1). Cada US tem brief autocontido em `briefs/US-N.md` com `Tocar SOMENTE:`.
Contratos: `contracts/lockfile-format.md`, `contracts/state-api.md`, `contracts/cli-output.md`,
`contracts/git-control-files.md`. **Congelados após US-1**: `src/state/{paths,lockfile,store,format}.ts`
e `test/helpers/state.ts`.

## Mapa brief ↔ spec

| Brief | Tema | User stories da spec | ACs |
|---|---|---|---|
| US-1 | Lockfile + camada de estado + religação | US1 (formato), US3 (mecanismo de aborto) | AC-04, AC-05 (+ mecanismos de AC-10b, AC-15 recuperação, AC-19, AC-38, AC-39) |
| US-2 | init/update/mediação: formato efetivo, migração, rollback; templates de controle git + B1/B2 | US1, US2, US4 (parte), US5 | AC-01, 02, 03, 06, 07, 08, 09, 10, 11, 12, 13, 23 (mediação/não rastreado), 24, 25, 26, 27, 30 (mediação), 31, 32, 34, 35 (update), 36 (update/init), 37, 19/38/39 (init, update, --apply-resolutions) |
| US-3 | doctor | US3 | AC-14, 15, 16, 17, 18, 35 (doctor), 36 (doctor), 19/38/39 (doctor) |
| US-4 | skill maker-update + interop git + contagem | US4 (+ AC-40 de US1, SC-001/008) | AC-20, 21, 22, 23, 40 |
| US-5 | agent add / add / remove no formato em uso | US1 | AC-30 (agent add), AC-33, 19/38/39 (agent add, add, remove) |
| US-6 | documentação, notas de release, build | US6 | AC-28, AC-29 |

---

## Fase A — Substrato (1 slot, bloqueia tudo)

### [US-1 — backend] Lockfile do estado + camada de estado única (P1)

Brief: `briefs/US-1.md`

- [X] T101 — `src/state/paths.ts`: `MANIFEST_FILE`, `LOCKFILE` (`.maker/maker.lock`), `BASES_DIR`, `GIT_CONTROL_FILES` (`.maker/.gitattributes`, `.maker/.gitignore`), `basePath`, `isBaseName`, `isStateMetadata`. Sem imports.
- [X] T102 — `src/config/schema.ts`: `state.bases` opcional (`"files" | "pack"`), **sem default**, mensagem `state.bases deve ser "files" ou "pack"`. Teste `test/config/schema.test.ts`: ausência → `state` indefinido; `"files"`/`"pack"` aceitos; `"zip"` rejeitado com a mensagem (FR-003, FR-004).
- [X] T103 — `src/state/lockfile.ts`: `canonicalJson`, `serializeLockfile` (contrato §1–§2).
- [X] T104 — `src/state/lockfile.ts`: `parseLockfile` com ressincronização por unidade, supressão de `malformed` redundante dentro de bloco quebrado, recuperação `\r\n`→`\n` só com sha256 conferindo (`recovered: true`), `LockfileError`, `manifestSchema` zod (contrato §3).
- [X] T105 — `test/state/lockfile.test.ts`: propriedades L1–L15 do contrato (AC-04, AC-05, FR-007..FR-010a, FR-012, edge cases; L9b conflito intercalado → nenhuma base atingida aceita; L12 proxy de merge com entradas adjacentes, campo novo e unidade `file` nova).
- [X] T106 — `src/render/manifest.ts`: `Manifest.basesFormat?: BasesFormat`; remover `MANIFEST_FILE`, `readManifest`, `writeManifest` (movidos para `src/state/`).
- [X] T107 — `src/state/store.ts`: `StateError`, `inspectState`, `openState({ mode })`, `readManifest`, `InstallState` (união verificada dos dois formatos, com a mesma recuperação `\r\n`→`\n` para `.maker/bases/<hash>`; coexistência; erros do lockfile; `manifest.json` ilegível → `unreadable`).
- [X] T108 — `src/state/store.ts`: `planStateWrite` (`consolidate`, `prune`, normalização de `config.state`, remoção de `.maker/bases`; bases recuperadas regravadas corretas), `withBases`.
- [X] T109 — `src/state/format.ts`: `configuredBasesFormat` (`unset`/`set`/`invalid`/`unreadable`), `effectiveBasesFormat` (JSON malformado → sem migração, `reason: "unreadable-config"`), `planFormatTransition`, `pendingDefaultMigration`.
- [X] T110 — `src/changes/transaction.ts`: metadados de estado por último e, entre eles, create/update antes de remove; hook `crashAfter`; `recoverBeforeRead`; `hasPendingTransactions`. Teste `test/changes/transaction.test.ts`: `crashAfter` deixa journal; `recoverBeforeRead` restaura o estado anterior; ordem files→pack = `maker.lock` criado antes de `manifest.json` removido (crash no meio → coexistência, nunca ausência de estado).
- [X] T111 — `test/state/store.test.ts` + `test/state/format.test.ts`: coexistência → `StateError("coexistence")` sem escrita; `maker-lockfile 2` → `unknown-version`; manifest com marcador → `manifest-conflict`; nunca `null` nesses casos; união verificada com base corrompida em cada formato; base CRLF recuperável em cada formato; `planStateWrite` files↔pack (consolidate/prune), idempotência (segundo plano todo `preserve`); `config.state` removido; resolução config→manifest→default; `maker.config.json` malformado → sem migração; `state.bases` inválido → erro de validação; transição e contagens.
- [X] T112 — Religar chamadores à camada de estado **sem mudar comportamento externo** (formato em uso; `init` novo ainda grava `"files"` até US-2): `src/commands/init.ts`, `src/commands/update.ts` (`readBase`/`listBases` → `InstallState`; bases acumuladas num `Map`; `planStateWrite(inUse, prune: true)`; `planUpdate(target, { merge, state? })`; `sentinelConfig` preserva `state`), `src/commands/mediation.ts`, `src/agents/migrate.ts` (`planBase` → acumula no `Map` devolvido), `src/addons/apply.ts`, `src/commands/agent.ts` (sem `writeManifest`: persistência via `planStateWrite` + `applyChangePlan`), `src/commands/doctor.ts` (`openState({ mode: "read" })`, `hasBase`, mensagens com constantes de `paths.ts`), `src/addons/doctor.ts` (callback `hasBase`), `src/agents/validate.ts` (fachada; mensagem `estado do maker ilegível`). Modos: mutantes `mutate`, `--dry-run` `dry-run`, doctor `read`.
- [X] T113 — `test/helpers/state.ts` (API em `contracts/state-api.md`; `initInstall({ format })` produz o formato pedido convertendo após o `init`, sem depender do default) e migração mecânica dos testes existentes para ele (imports de `readManifest`/`writeManifest`, escrita direta em `.maker/bases`, leitura direta de `.maker/manifest.json`, mensagem de `validate`, anti-acoplamento ignorando `.maker/maker.lock`). Suíte verde nos dois formatos.
- [X] T114 — `test/state/encapsulation.test.ts` (prova de D4): fora de `src/state/`, zero ocorrências de `manifest.json`, `maker.lock`, `.maker/bases`, `["']bases["']`; e o identificador `writeManifest` não existe em `src/` (nenhum escritor de estado fora do plano transacional).

---

## Fase B — Comandos de formato efetivo ‖ diagnóstico (2 slots, paralelos: US-2 ‖ US-3)

### [US-2 — backend] init/update/mediação: formato efetivo, migração transacional, relatório e arquivos de controle do git (P1)

Brief: `briefs/US-2.md` · depende de US-1 · **arquivos disjuntos de US-3**

- [X] T201 — `src/commands/update.ts` (`planUpdate`): formato efetivo (`configuredBasesFormat` + `effectiveBasesFormat`), `planFormatTransition`, `planStateWrite({ format: efetivo, consolidate: true, prune: true })`, grava `basesFormat` efetivo, `UpdatePlanning.transition`.
- [X] T202 — `src/commands/update.ts` (`runUpdate`): anúncio de migração no dry-run e no aplicado, opt-out quando `reason = default`, entradas inválidas descartadas, aviso de `maker.config.json` ilegível, aborto por `state.bases` inválido (contrato `cli-output.md` §1); códigos de saída inalterados; `openState` em `mutate`/`dry-run` antes de planejar.
- [X] T203 — `src/commands/init.ts`: install novo no formato efetivo da config carregada (default `"pack"`); install existente → mesma transição do update com `consolidate: true, prune: false`; anúncio; grava `basesFormat`.
- [X] T204 — `src/commands/mediation.ts`: `--apply-resolutions` no formato em uso (sem migrar, `basesFormat` preservado), bases novas só no armazenamento em uso; `--export` fora do estado.
- [X] T205 — `test/commands/update.pack.test.ts`: AC-01, AC-02, AC-03, AC-07 (SC-002), AC-27, AC-31, AC-32, AC-35 (update registra `"files"`), AC-36 (sem `manifest.json`/`bases/`; doctor verde); FR-003 (`state.bases` inválido em `maker.config.json` → aborta sem escrita); `maker.config.json` malformado com manifest com config → update funciona como hoje, sem migrar, com aviso.
- [X] T206 — `test/commands/update.reverse.test.ts`: AC-24, AC-25 (SC-004), AC-26 (união verificada, corrompida descartada e listada, tratamento de base ausente).
- [X] T207 — `test/commands/update.dry-run.test.ts`: AC-08 e SC-007 (nos dois formatos e durante migração, dois planos idênticos, árvore inalterada), AC-12 (anúncio com origem → destino, contagens e opt-out).
- [X] T208 — `test/commands/update.parity.test.ts`: AC-09 / SC-003 — sem customização, mesclável, conflito, mediação e base ausente; compara arquivos gerenciados, entradas do plano com `source ≠ "metadata"` e código de saída.
- [X] T209 — `test/commands/update.rollback.test.ts`: AC-10(a) `failAfter` na migração files→pack e pack→files; AC-10(b) `crashAfter` em cada ponto da migração (inclusive entre `maker.lock` criado e `manifest.json` removido) + próximo comando mutante recupera antes de ler (FR-019) e o estado volta exatamente ao anterior; AC-11 falha no update em pack.
- [X] T210 — `test/commands/init.pack.test.ts`: AC-06, AC-34; AC-19/AC-38/AC-39 para `init` sobre install existente (aborta, árvore idêntica, nunca cria `manifest.json`).
- [X] T211 — `test/commands/mediation.pack.test.ts`: AC-30 (`--apply-resolutions` em pack: bases só no lockfile), AC-13 (export fora do lockfile), AC-19/AC-38/AC-39 para `update` e `--apply-resolutions`; B1 (proposta para `.maker/.gitignore` e `.maker/.gitattributes` aceita e aplicada; `.maker/manifest.json`, `.maker/maker.lock`, `.maker/bases/<h>` e `.maker/addons/<id>.json` recusados com "fora dos arquivos gerenciados").
- [X] T212 — `test/commands/legacy-reader.test.ts`: AC-37 — leitor do contrato 1.0.0 (install ⇔ `.maker/manifest.json`) conclui "nenhum install" para update/add/remove/agent add/mediação/doctor num install em pack, sem escrita.
- [X] T213 — Adaptar as suítes legadas deste escopo ao default `"pack"` e aos dois arquivos gerenciados novos (`test/update.integration.test.ts`, `test/mediation.integration.test.ts` — o caso da linha 227 continua passando —, `test/init.integration.test.ts`, `test/legacy-agent.integration.test.ts`, `test/engine.test.ts` só contagens/listas).
- [X] T214 — Templates `templates/engine/common/.maker/.gitattributes` e `templates/engine/common/.maker/.gitignore.hbs` (conteúdo exato em `contracts/git-control-files.md`).
- [X] T215 — **B1** `src/commands/mediation.ts` (`isMediablePath`): aceitar exatamente `GIT_CONTROL_FILES`, rastreados ou não; demais `.maker/*` fora de `.maker/workflow/` continuam recusados. Teste em T211.
- [X] T216 — **B2** `src/commands/update.ts`: `GIT_CONTROL_FILES` existentes sem entrada no manifest — idêntico ao upstream → passa a ser rastreado (entrada + base); diferente → `preserve` + mediação `local-edit` "arquivo pré-existente não rastreado pelo maker" (base nula), nunca sobrescrito. Teste em `test/commands/update.pack.test.ts`: os dois casos, nos dois formatos, e o ciclo export → proposta → `--apply-resolutions` registrando a entrada com `baseHash` do upstream (AC-23, P4).

### [US-3 — backend] `maker doctor` valida bases e estado em qualquer formato (P1)

Brief: `briefs/US-3.md` · depende de US-1 · **arquivos disjuntos de US-2**

- [X] T301 — `src/state/diagnose.ts`: `diagnoseState(snapshot, configured): DoctorFinding[]` com a tabela de `cli-output.md` §2 (inclui arquivos afetados por hash, `config-invalid`, `config-unreadable`, base recuperável como `base-corrupt`).
- [X] T302 — `src/commands/doctor.ts`: `hasPendingTransactions` checado **antes** de "nenhum install"; `inspectState` + `diagnoseState`; seção `Estado (.maker)`; `fail` → exit 1; estado sem manifest (erros de lockfile/coexistência) reportado sem lançar; "personalizado" só com base verificada; mensagens com constantes de `src/state/paths.ts`.
- [X] T303 — `src/addons/doctor.ts`: `mergeable` usa base verificada (`hasBase`), nos dois formatos (AC-18 com add-ons).
- [X] T304 — `test/state/diagnose.test.ts`: um caso por `code` com severidade, hash, arquivos e ação.
- [X] T305 — `test/commands/doctor.state.test.ts` (installs via `initInstall({ format })`, sem depender do default): AC-14, AC-15 (CRLF em base `utf8`, nos dois formatos: falha mesmo quando recuperável), AC-16 (ilegível, versão desconhecida, truncada), AC-17 (órfãs, soltas, não migrado com opt-out), AC-35 (doctor sem info), AC-18 (íntegro nos dois formatos com add-on `saas`), AC-36 (doctor verde lendo só o lockfile), AC-19/38/39 (doctor falha); transação pendente sem estado autoritativo → `pending-transaction`, não "nenhum install"; FR-003 (`state.bases` inválido → `config-invalid`), JSON malformado → `config-unreadable`; SC-005; doctor não escreve (hash da árvore).
- [X] T306 — `test/doctor.addon.test.ts`: adaptar ao default `"pack"` se necessário.

---

## Fase C — Interop git ‖ formato em uso (2 slots, paralelos: US-4 ‖ US-5)

### [US-4 — backend] Skill maker-update, interop git e contagem de arquivos (P2)

Brief: `briefs/US-4.md` · depende de US-1, US-2, US-3 · **arquivos disjuntos de US-5**

- [ ] T401 — `templates/engine/workflow/skills/maker-update/SKILL.md` (Hard rules, linha 23): proibir editar também `.maker/maker.lock`.
- [ ] T402 — `scripts/package-smoke.mjs`: exigir os dois templates de controle git no tarball.
- [ ] T403 — `test/state/git-interop.test.ts` (`it.skipIf(!hasGit())` com motivo): AC-20 (autocrlf, nos dois formatos), AC-21, AC-22, AC-40 (entradas não adjacentes, **adjacentes**, campo novo × edição vizinha, unidade `file` nova × edição vizinha — todos sem conflito e doctor verde).
- [ ] T404 — `test/commands/update.gitcontrol.test.ts`: AC-23 (edição local rastreada preservada/mesclada); FR-029 (update cria os dois em install existente e os registra no manifest com base); FR-030 (`.gitattributes` de raiz inalterado, nenhum `.gitignore` de raiz).
- [ ] T405 — `test/state/reference-install.test.ts`: SC-001 (Claude + Codex + `saas`, default, sem opt-in: ≤ 16 arquivos versionados em `.maker`, contando só o que não é ignorado), SC-008 (tamanho do lockfile ≤ soma das bases + overhead de cabeçalhos + base64).

### [US-5 — backend] `agent add`, `add` e `remove` no formato em uso (P1)

Brief: `briefs/US-5.md` · depende de US-1, US-2 · **arquivos disjuntos de US-4**

- [ ] T501 — `src/util/engine-scaffold.ts`: `applyAgentProvider(targetDir, ctx, provider, { includeShared? })` para renderizar em staging sem depender do alvo.
- [ ] T502 — `src/commands/agent.ts`: `agent add` transacional — `openState({ mode: "mutate" })`, preflight atual, render em staging, `planWrite` por arquivo, entradas com `baseHash = hash`, bases no formato em uso (`planStateWrite({ format: inUse, bases: novas })`, sem consolidar/podar), `basesFormat` preservado, `applyChangePlan`.
- [ ] T503 — `src/addons/apply.ts`: conferir formato em uso, `basesFormat` preservado e nenhuma poda em `add`/`remove` (ajuste só se o teste T505 exigir).
- [ ] T504 — `test/commands/agent.state.test.ts`: AC-30 (`agent add` em pack: bases só no lockfile, nenhuma em `.maker/bases`), AC-33 (`agent add` em install não migrado: bases por arquivo, sem `basesFormat`, `update` seguinte migra), AC-19/38/39 (aborta, árvore idêntica), FR-022 (falha injetada restaura tudo).
- [ ] T505 — `test/commands/add.state.test.ts`: AC-33 (`add`/`remove` não migram, `basesFormat` ausente continua ausente), AC-19/38/39 para `add` e `remove`, FR-011 (órfãs toleradas, sem poda), FR-022 em pack.
- [ ] T506 — Adaptar `test/agent.integration.test.ts` e `test/addon.integration.test.ts` ao default `"pack"` e ao `agent add` transacional.

---

## Fase D — Documentação e entrega (1 slot)

### [US-6 — backend] Taxonomia de `.maker`, notas de release e build (P3)

Brief: `briefs/US-6.md` · depende de US-1..US-5

- [ ] T601 — `docs/maker-state.md`: taxonomia (4 categorias, cada item de `.maker`, versionar ou não, nos dois formatos, explícito que em pack não existem `manifest.json`/`bases/`), formatos, default, trade-offs (inclusive `linguist-generated` colapsando o manifest e como expandir; conflitos residuais e conflito intercalado), escolha/troca de formato, diagnóstico e recuperação (FR-001, FR-002, AC-28, AC-29).
- [ ] T602 — `README.md` (seção de `.maker` e link) e `docs/MIGRATION.md` (seção "Bases no formato pack por padrão": opt-out, atualizar o maker em todo o time/CI antes de migrar, limitações da 1.0.0 com `init`/`init --force`).
- [ ] T603 — `test/docs/maker-state.test.ts`: cada item presente em `.maker` num install de referência (pack e files, com temporários criados) aparece na tabela da taxonomia com exatamente uma categoria (AC-28); o doc contém `state.bases`, `"pack"`, `"files"` e o procedimento de migração (AC-29, parte de docs).
- [ ] T604 — Texto de commit/PR da entrega para **as duas opções** de Q1 (`contracts/cli-output.md` §5): opção A (`feat(state)!:` + rodapé `BREAKING CHANGE:`) e opção B (`feat(state):` + seção `## Notas de release` no corpo do PR para colar nas release notes do Release PR). O orquestrador usa a opção decidida no Gate 2 (AC-29, parte CHANGELOG/release notes). `CHANGELOG.md` **não** é editado à mão.
- [ ] T606 — Emenda autorizada no Gate 3: constante `FORMAT_OPT_OUT_SNIPPET` em `src/state/format.ts` como fonte única da dica de opt-out; `src/commands/update.ts` e `src/state/diagnose.ts` passam a importá-la (saída do CLI inalterada).
- [ ] T605 — `pnpm build` (atualiza `dist/cli.js` versionado), `pnpm verify`, `pnpm package:smoke`.

---

## Matriz de cobertura AC → task

| AC | Task(s) | AC | Task(s) |
|---|---|---|---|
| AC-01 | T201, T205 | AC-21 | T214, T403 |
| AC-02 | T201, T205 | AC-22 | T214, T403 |
| AC-03 | T108, T111, T205 | AC-23 | T215, T216, T211 (mediação/não rastreado); T404 |
| AC-04 | T103, T105 | AC-24 | T201, T206 |
| AC-05 | T103, T105 | AC-25 | T206 |
| AC-06 | T203, T210 | AC-26 | T107, T201, T206 |
| AC-07 | T201, T205 | AC-27 | T109, T205 |
| AC-08 | T202, T207 | AC-28 | T601, T603 |
| AC-09 | T201, T208 | AC-29 | T601, T602, T603, T604 |
| AC-10 | T110, T209 | AC-30 | T204, T211 (mediação); T502, T504 (agent add) |
| AC-11 | T209 | AC-31 | T201, T202, T205 |
| AC-12 | T202, T207 | AC-32 | T109, T205 |
| AC-13 | T204, T211 | AC-33 | T502, T503, T504, T505 |
| AC-14 | T301, T305 | AC-34 | T203, T210 |
| AC-15 | T104, T107, T301, T305 | AC-35 | T201, T205 (update); T301, T305 (doctor) |
| AC-16 | T104, T301, T305 | AC-36 | T205, T210 (init/update); T305 (doctor) |
| AC-17 | T301, T305 | AC-37 | T212 |
| AC-18 | T302, T303, T305 | AC-38 | T107, T111; T210, T211, T504, T505, T305 |
| AC-19 | T104, T107, T111; T210, T211, T504, T505, T305 | AC-39 | T104, T107, T111; T210, T211, T504, T505, T305 |
| AC-20 | T214, T403 | AC-40 | T103, T105 (proxy L12), T403 |

SC: SC-001 T405 · SC-002 T205 · SC-003 T208 · SC-004 T206 · SC-005 T305 · SC-006 T403 · SC-007 T207 · SC-008 T405.
FR-003 (config inválida lida de `maker.config.json`): T102, T111, T205, T305.

## Paralelização

| Fase | Par | `Tocar SOMENTE:` ∩ |
|---|---|---|
| A | US-1 sozinho | — |
| B | US-2 ‖ US-3 | ∅ (US-2: init/update/mediation, templates `.maker/*`, testes de comando de update/init/mediação e suítes legadas deles, `test/engine.test.ts`; US-3: diagnose/doctor/addons-doctor + testes de doctor) |
| C | US-4 ‖ US-5 | ∅ (US-4: SKILL.md, package-smoke, testes git/contagem/gitcontrol; US-5: agent/engine-scaffold/addons-apply + testes de agent/add) |
| D | US-6 sozinho | — |

Acoplamento só em tempo de execução (sem edição concorrente): testes de US-2 chamam `runDoctor` (AC-36)
e US-3 altera o doctor; US-3 cria installs por `initInstall({ format })`, independente do default que a
US-2 troca e dos templates que ela adiciona. O orquestrador roda a suíte completa após cada par.

## Prova de isolamento/segurança

Não aplicável como E2E — ver `plan.md §4`. Invariantes provados em `test/`: encapsulamento do estado
(`test/state/encapsulation.test.ts`, T114), zero shell-out (`test/runs/no-shellout.test.ts`, existente),
leitura pura de doctor/dry-run (hash de árvore em T207 e T305). `tests/e2e/003-compact-maker-state/`:
**não aplicável** — CLI headless sem regra de isolamento de dados declarada.
