# US-3 Brief — `maker doctor` detecta base ausente/corrompida e estado inválido em qualquer formato [backend]

## Objetivo
O `doctor` passa a validar, nos dois formatos, que todo `baseHash` referenciado resolve para uma base
cujo conteúdo confere com o hash (mesmo com o arquivo gerenciado intacto), e a reportar lockfile
ilegível, versão desconhecida, entrada truncada/malformada, coexistência, manifest em conflito,
transação pendente, órfãs, bases soltas e migração pendente — sempre com ação recomendada, sem escrever.

## ACs cobertos
- Spec US3: AC-14, AC-15, AC-16, AC-17, AC-18, AC-35 (parte doctor), AC-19 (parte doctor).
- Spec US1: AC-36 (doctor verde lendo só o lockfile), AC-38 e AC-39 (doctor falha).
- FR-003 no doctor (`state.bases` inválido em `maker.config.json` → falha; JSON malformado → aviso).
- FR-023, FR-024, FR-025, FR-026; SC-005.

## Contexto necessário
- Depende de **US-1**: `inspectState` (snapshot com `bases`, `problems`, `looseFileBases`,
  `conflictMarkersInBases`, `crlfSuspected`, `pendingTransactions`, `error`), `configuredBasesFormat`,
  `pendingDefaultMigration`, `test/helpers/state.ts` (`putBase`, `corruptBase`, `removeBase`,
  `initInstall({ format })`, `toLegacyFiles`, `snapshotTree`).
- Tabela de achados, severidades, mensagens e ações: `contracts/cli-output.md` §2. Tipo
  `DoctorFinding` em `data-model.md`.
- `src/commands/doctor.ts` hoje: `verifyManifest`, integrações, add-ons, mediação pendente via
  `planUpdate`, "personalizado" quando há base. `src/addons/doctor.ts:138` decide `mergeable` pela base.

## Decisões fixadas
- `src/state/diagnose.ts` é **arquivo novo** (a pasta `src/state/` é da US-1, mas este arquivo é seu):
  `diagnoseState(snapshot, configured): DoctorFinding[]`, puro.
- `fail`: pending-transaction, coexistence, unreadable, unknown-version, manifest-invalid,
  manifest-conflict, base-missing, base-corrupt, entry-truncated, entry-malformed.
  `warn`: orphan-bases, loose-file-bases, bases-conflict-markers. `info`: pending-default-migration.
- Órfã = base válida presente não referenciada por nenhum `baseHash`.
- Sem manifest (erro de estado) o doctor reporta e sai com 1, **sem lançar**.
- `pending-default-migration` só quando `pendingDefaultMigration(state, configured)`; com `"files"`
  explícito na config não há info (AC-35).
- Doctor nunca escreve: use `openState/inspectState` em modo `read`; teste com `snapshotTree`.
- **Transação pendente primeiro**: `hasPendingTransactions` é checado antes de concluir "nenhum install"
  (um crash no meio de uma migração vira `pending-transaction`, não "sem install").
- **Mensagens com constantes**: todo caminho de estado citado em mensagem/ação é montado com
  `MANIFEST_FILE`, `LOCKFILE`, `BASES_DIR` de `src/state/paths.ts` — `test/state/encapsulation.test.ts`
  (US-1) reprova os literais `manifest.json`, `maker.lock`, `.maker/bases` fora de `src/state/`
  (`diagnose.ts` está em `src/state/`, mas use as constantes do mesmo jeito).
- Base com `recovered: true` continua `base-corrupt` (**fail**, AC-15), com o sufixo "recuperável" e a
  ação de rodar `maker update` (`cli-output.md` §2).
- Config: `configuredBasesFormat(target, { inspect: true })` — `invalid` → `config-invalid` (fail);
  `unreadable` → `config-unreadable` (warn); nenhum dos dois lança.
- Crie os installs de teste com `initInstall({ format: "files" | "pack" | "unset" })` — ele produz o
  formato pedido independentemente do default do `init`, que a US-2 troca em paralelo.
- AC-15 com CRLF: converta os `\n` de uma base `utf8` para `\r\n` (arquivo em files; bloco no lockfile);
  o doctor sai 1 mesmo a base sendo recuperável.

## Runbook
1. `diagnose.ts` + `test/state/diagnose.test.ts` (um caso por `code`).
2. `doctor.ts`: seção `Estado (.maker)`, exit code, estados sem manifest, "personalizado" com base verificada.
3. `addons/doctor.ts`: `mergeable` por base verificada.
4. `test/commands/doctor.state.test.ts` cobrindo os ACs nos dois formatos; adapte `test/doctor.addon.test.ts`.
5. Verify completo.

## Tocar SOMENTE:
- `src/state/diagnose.ts`
- `src/commands/doctor.ts`
- `src/addons/doctor.ts`
- `test/state/diagnose.test.ts`
- `test/commands/doctor.state.test.ts`
- `test/doctor.addon.test.ts`

## NÃO tocar
`src/state/{paths,lockfile,store,format}.ts` e `test/helpers/state.ts` (congelados — US-1),
`src/commands/update.ts`, `src/commands/init.ts`, `src/commands/mediation.ts` (US-2), `src/agents/**`,
`templates/**`, `docs/**`, `dist/**`.

> Paralela com US-2. O doctor chama `planUpdate` (de US-2) só para contar mediação pendente — não
> dependa do formato do plano nem do anúncio de migração.
