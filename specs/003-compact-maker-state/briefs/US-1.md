# US-1 Brief — Lockfile do estado + camada de estado única [backend]

## Objetivo
Criar `src/state/` — o único lugar do código que conhece `.maker/manifest.json`, `.maker/bases/` e o
lockfile `.maker/maker.lock` — e religar todos os comandos a ele **sem mudar o comportamento externo**
(o `init` novo continua gravando `"files"`; a troca de default é da US-2). Ao final, qualquer comando
opera corretamente num install em pack se ele existir, e nenhum escritor de estado fica fora de
`applyChangePlan`.

## ACs / requisitos cobertos
- AC-04, AC-05 (codec do lockfile) e FR-007, FR-008, FR-009, FR-009a (proxy), FR-010, FR-010a, FR-012.
- FR-003, FR-004 (schema de config: `state.bases` sem default).
- Mecanismos (provados por teste unitário aqui; por comando nas US-2/3/5): AC-10b (recuperação antes de
  ler), AC-19 (versão desconhecida aborta), AC-38 (coexistência aborta), AC-39 (manifest inválido/
  em conflito aborta e nunca vira "sem install").
- Edge cases: base não UTF-8, base vazia, conteúdo que imita delimitador, lockfile sem bases,
  conflito/corrupção atingindo só as entradas afetadas (conflito intercalado dentro de uma base → ela
  fica ausente, nunca aceita).
- Recuperação de base convertida para CRLF (nos dois formatos) só quando o sha256 da variante confere.

## Contexto necessário
- Spec: `specs/003-compact-maker-state/spec.md` (Clarifications 3, 10, 11, 13, 18, 20–22; FR-003..FR-012).
- Plano: `plan.md` §3 D1, D2, D4, D6. Contratos: `contracts/lockfile-format.md` (gramática, parse,
  propriedades L1–L13), `contracts/state-api.md` (assinaturas — **você as fixa; depois congelam**),
  `contracts/cli-output.md` §3–§4 (mensagens de `StateError`). Tipos em `data-model.md`.
- Acessos diretos a substituir: `src/commands/init.ts:134-152`, `src/commands/update.ts:113, 207, 222,
  236-243, 404-423`, `src/commands/mediation.ts:229, 337, 369`, `src/agents/migrate.ts:247`,
  `src/addons/apply.ts:98, 209, 226, 264`, `src/commands/agent.ts:21, 42, 51`,
  `src/commands/doctor.ts:18-20, 61`, `src/addons/doctor.ts:138`, `src/agents/validate.ts:42-45`,
  `src/changes/transaction.ts:161-163`.
- Transação: `applyChangePlan` já faz journal/backup/lock/rollback; `createPlan` deduplica por caminho.
  `planWrite(force: true)` devolve `preserve` quando o conteúdo é idêntico — é o que dá idempotência.
- Hoje o `update` renderiza com a config gravada no manifest (`resolveConfig`); o formato é lido à
  parte de `maker.config.json` (D6) — não mude a fonte da config de renderização.
- `sentinelConfig` (`src/commands/update.ts:336`) substitui toda string da config: passe `state` intacto,
  como `project`/`agent`.

## Decisões fixadas
- Lockfile `.maker/maker.lock`, cabeçalho `maker-lockfile 1`, seções `[manifest]`/`[bases]`, unidades
  `file "<path>"` + campos indentados e `@base sha256=… size=… encoding=utf8|base64` / `@end sha256=…`.
  Ordem por **code unit**, JSON canônico, LF, sem valores voláteis.
- Parse ressincroniza por unidade; bases só entram verificadas por hash; marcadores de conflito na seção
  de manifest → `manifest-conflict`, na seção de bases → contados e ignorados. Dentro da extensão de um
  bloco já reportado como quebrado (até o `@end` dele) não há `malformed` redundante.
- Hash não confere → tenta `\r\n`→`\n`; aceita só se o sha256 conferir (`recovered: true` em
  `problems`), no lockfile e em `.maker/bases/<hash>`. `planStateWrite` regrava a base correta.
- `openState` modes `mutate` (recupera transação pendente **antes** de ler — antes do check de
  coexistência), `dry-run` (`assertNoPendingTransactions`), `read`.
- Leitura de bases = união verificada dos dois formatos. Formato em uso: pack se há lockfile, senão files.
- `planStateWrite`: `consolidate`/`prune` conforme contrato; `manifest.config` sem `state`; base files com
  `force`; `.maker/bases` removido como um diretório quando só tem nomes de hash.
- `isStateMetadata` inclui `.maker/maker.lock`. Na transação: metadados de estado por último e, entre
  eles, **create/update antes de remove** — um crash no meio de uma migração deixa coexistência (com
  journal), nunca ausência de estado.
- `GIT_CONTROL_FILES` em `paths.ts` (consumido por US-2 em `mediation.ts`/`update.ts`).
- `configuredBasesFormat` devolve `unset|set|invalid|unreadable`; JSON malformado nunca lança e nunca
  dispara migração (`reason: "unreadable-config"`); `state.bases` inválido lança a validação (FR-003).
- `test/helpers/state.ts`: `initInstall({ format })` produz o formato pedido **convertendo depois do
  `init`** (`planStateWrite({ consolidate: true })`), para que US-3 não dependa do default que US-2 troca.
- `schemaVersion` continua `3`; campo novo `basesFormat` opcional.
- `writeManifest` sai de `src/`. `agent.ts` persiste o manifest por `planStateWrite` + `applyChangePlan`
  (troca mínima; o `agent add` inteiro transacional é da US-5).
- Hook `crashAfter` em `applyChangePlan` só para testes: lança sem rollback, deixa journal e lock com pid `0`.
- Comentários só de PORQUÊ (PR5): ex. por que code unit e não `localeCompare`; por que retomar na linha
  seguinte ao cabeçalho quebrado.

## Runbook
1. `paths.ts` → `lockfile.ts` (serialize, depois parse) → `test/state/lockfile.test.ts` (L1–L13).
2. `schema.ts` (`state.bases`) + `test/config/schema.test.ts`.
3. `render/manifest.ts` (`basesFormat`; remover read/write) → `store.ts` → `format.ts` →
   `test/state/store.test.ts`, `test/state/format.test.ts`.
4. `transaction.ts` (`isStateMetadata`, `crashAfter`, `recoverBeforeRead`, `hasPendingTransactions`) +
   `test/changes/transaction.test.ts`.
5. Religar chamadores (T112) mantendo o comportamento; `init` novo grava `"files"` por enquanto.
6. `test/helpers/state.ts` + migração mecânica dos testes existentes (T113); rode a suíte inteira.
7. `test/state/encapsulation.test.ts` (T114). Verify: `pnpm typecheck && pnpm test && pnpm audit:coupling`.

## Tocar SOMENTE:
- `src/state/paths.ts`
- `src/state/lockfile.ts`
- `src/state/store.ts`
- `src/state/format.ts`
- `src/config/schema.ts`
- `src/render/manifest.ts`
- `src/changes/transaction.ts`
- `src/commands/init.ts`
- `src/commands/update.ts`
- `src/commands/mediation.ts`
- `src/commands/agent.ts`
- `src/commands/doctor.ts`
- `src/agents/migrate.ts`
- `src/agents/validate.ts`
- `src/addons/apply.ts`
- `src/addons/doctor.ts`
- `test/helpers/state.ts`
- `test/state/lockfile.test.ts`
- `test/state/store.test.ts`
- `test/state/format.test.ts`
- `test/state/encapsulation.test.ts`
- `test/config/schema.test.ts`
- `test/changes/transaction.test.ts`
- `test/addon.integration.test.ts`
- `test/agent.integration.test.ts`
- `test/init.integration.test.ts`
- `test/legacy-agent.integration.test.ts`
- `test/mediation.integration.test.ts`
- `test/update.integration.test.ts`
- `test/doctor.addon.test.ts`
- `test/change-plan.test.ts`

## NÃO tocar
`templates/**`, `dist/**`, `docs/**`, `src/cli.ts`, `src/util/**`, `src/runs/**`, `test/runs/**`.
Não mude o default para `"pack"` nem implemente migração (US-2), achados do doctor (US-3) ou o
`agent add` transacional com bases (US-5).

> Depois desta US, `src/state/{paths,lockfile,store,format}.ts` e `test/helpers/state.ts` ficam
> **congelados**. Mudança de API = retorno ao Gate 2.
