# US-5 Brief — `agent add`, `add` e `remove` no formato em uso [backend]

## Objetivo
Os comandos pontuais operam no formato em uso, nunca migram, preservam `basesFormat` exatamente como
encontraram e abortam antes de escrever em estado inválido. O `agent add` passa a ser transacional e a
registrar bases das integrações novas (no lockfile em pack, por arquivo em files).

## ACs cobertos
- Spec US1: AC-30 (parte `agent add`), AC-33; AC-19/AC-38/AC-39 para `agent add`, `add` e `remove`.
- FR-005 (preservar o campo), FR-006, FR-011 (sem poda), FR-022 (rollback do `agent add`).

## Contexto necessário
- Depende de US-1 (`openState`, `planStateWrite`, helpers de teste) e US-2 (default pack: installs de
  teste nascem em pack; `update` migra o não migrado, usado no fim de AC-33).
- Hoje (`src/commands/agent.ts`): `assertNoUnmanagedProviderFiles` faz o preflight;
  `applyAgentProvider(targetDir, …)` escreve direto no alvo e decide incluir os papéis compartilhados
  por `existsSync(.maker/workflow/agents)`; entradas sem `baseHash`. Depois da US-1 o manifest já é
  persistido pela transação, mas os arquivos ainda não.
- `src/addons/apply.ts` já usa o estado desde a US-1 (formato em uso, sem migrar); aqui você prova com
  testes e ajusta só se o teste exigir.
- Plano: `plan.md` §3 D6, D8. Mensagens de aborto: `contracts/cli-output.md` §3.

## Decisões fixadas
- `applyAgentProvider(targetDir, ctx, provider, { includeShared })`: quando informado, não consulta o
  disco do alvo — permite renderizar em staging (`mkdtemp`) e planejar.
- `agent add`: `openState({ mode: "mutate" })` → preflight → render em staging →
  `planWrite(force: true)` por arquivo → entradas `{ ...entry, baseHash: entry.hash }` → bases novas →
  `planStateWrite(state, target, { manifest, format: state.inUse, bases: novas })` (sem `consolidate`,
  sem `prune`) → `applyChangePlan`. `basesFormat` nunca é criado nem alterado.
- `add`/`remove` não reescrevem o armazenamento para podar; órfãs continuam (FR-011).
- AC-33 termina com `maker update` migrando para pack (comportamento da US-2).

## Runbook
1. `engine-scaffold.ts` (opção `includeShared`).
2. `agent.ts` transacional com bases.
3. `test/commands/agent.state.test.ts` e `test/commands/add.state.test.ts`; ajuste `src/addons/apply.ts`
   só se necessário.
4. Adapte `test/agent.integration.test.ts` e `test/addon.integration.test.ts`. Verify completo.

## Tocar SOMENTE:
- `src/commands/agent.ts`
- `src/util/engine-scaffold.ts`
- `src/addons/apply.ts`
- `test/commands/agent.state.test.ts`
- `test/commands/add.state.test.ts`
- `test/agent.integration.test.ts`
- `test/addon.integration.test.ts`

## NÃO tocar
`src/state/**`, `test/helpers/state.ts` (congelados), `src/commands/{update,init,mediation,doctor}.ts`,
`templates/**`, `scripts/**`, `docs/**`, `dist/**`, e os arquivos da US-4
(`templates/engine/workflow/skills/maker-update/SKILL.md`, `scripts/package-smoke.mjs`,
`test/state/git-interop.test.ts`, `test/state/reference-install.test.ts`,
`test/commands/update.gitcontrol.test.ts`). Suítes de update/init/mediação/engine são da US-2 (já concluída).

> Paralela com US-4, que só mexe na skill `maker-update`, no smoke de pacote e em testes. Os templates
> `.maker/.gitattributes`/`.gitignore` (US-2) são do engine comum, não dos providers: o conjunto de
> arquivos do `agent add` não muda.
