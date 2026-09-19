# Acceptance Test Guide — 002-github-actions-ci

> **Feature headless / infra-only.** O valor (verde/vermelho bloqueando merge) só existe **end-to-end
> no GitHub Actions** — não há UI de app nem estado de banco. Toda validação aqui é **manual, no
> provedor de CI**, observando PRs e runs reais.

## O que o Gate 3 já provou (NÃO revalidar aqui)

Já verde na automação/estático — não repetir:

- Os scripts de verify em si (`build`/`typecheck`/`test`/`audit:coupling`) passam localmente e no
  próprio Gate 3.
- Determinismo local do install: `pnpm install --frozen-lockfile` sem `ERR_PNPM_IGNORED_BUILDS` e
  `pnpm-lock.yaml` intacto (runbook T003 do brief).
- `pnpm-workspace.yaml` versionado com `allowBuilds: esbuild: false` + comentário; bloco `pnpm` removido
  do `package.json`; `.github/rulesets/main.json` e `README.md` presentes; diff sem deps de runtime
  novas (SC-005).
- YAML do workflow bem-formado, ordem dos 4 steps, `name: verify`, concorrência, `--frozen-lockfile`.

## Primeira validação após o merge (só um humano confirma, em PR real)

O comportamento do provedor de CI **não é observável antes do workflow existir na branch default**.
Portanto os cenários abaixo exigem que o workflow já esteja em `main` e um **PR de teste dedicado**
(descartável) com quebras deliberadas. Não fazem parte do Gate 3.

Regra geral de execução:

- Todos os cenários de quebra usam **uma branch de teste** derivada de `main`, com **uma quebra por
  commit/PR** (nunca combinar). Reverter/descartar a branch ao fim.
- "Job vermelho" = check `verify` com conclusão `failure`. "Step falhou" = o step nomeado com X
  vermelho. "Não executado" = step posterior com ícone de *skipped*/cinza (nunca verde).
- Onde olhar: aba **Checks** / **Actions** do PR → run do workflow **CI** → job **verify** → lista de
  steps com timing e status.

---

## Cenário 1 — SC-001: todo PR dispara o workflow automaticamente

**Pré-condições:** workflow `CI` já em `main`.

**Ações:**
1. Criar branch a partir de `main`, fazer um commit trivial (ex.: linha em comentário) e abrir PR contra `main`.
2. Abrir a aba **Checks** do PR imediatamente após abrir.

**Resultado esperado:**
- Sem nenhuma ação manual, aparece um check **verify** (workflow **CI**) em estado *queued/in progress*
  e depois concluído.
- Nenhum PR fica sem o status check (não há filtro de path/branch que pule o disparo).

---

## Cenário 2 — SC-003 / US2-AC1: PR limpo → job verde reproduzindo o verify local

**Pré-condições:** branch cujo verify local está verde (os 4 scripts passam na máquina).

**Ações:**
1. Abrir PR dessa branch contra `main`.
2. Acompanhar o job **verify** até concluir.

**Resultado esperado:**
- Os 4 steps — **build → typecheck → test → audit:coupling** — concluem com sucesso, na ordem.
- Check **verify** verde. O veredito bate com o que foi observado localmente (mesma chain, mesmo pnpm,
  Node ≥18). Um CI verde onde o local era verde = fidelidade confirmada.

---

## Cenário 3 — SC-004: ordem observada dos steps + fail-fast no log

**Pré-condições:** um run qualquer já concluído (pode reaproveitar o do Cenário 2 para a ordem, e o do
Cenário 6 para o fail-fast).

**Ações:**
1. No run verde (Cenário 2), ler a sequência de steps no log do job **verify**.
2. Num run vermelho por quebra de etapa intermediária (ex.: Cenário 5, typecheck), observar os steps
   após o que falhou.

**Resultado esperado:**
- Ordem no log é **exatamente** `build → typecheck → test → audit:coupling`.
- Ao falhar um step, **todos os posteriores** ficam como "não executados" (skipped/cinza), nunca verdes
  nem vermelhos. Fail-fast nativo da Action confirmado no log real.

---

## Cenário 4 — SC-002 / US1-AC4: quebra de `build` (tsup) → build vermelho + nenhum posterior roda

**Pré-condições:** branch de teste a partir de `main`.

**Ações:**
1. Introduzir erro que quebra o `pnpm build` (ex.: sintaxe inválida num `.ts` que o tsup empacota).
2. Confirmar localmente que `pnpm build` falha (opcional, mas recomendado).
3. Abrir PR e observar o job **verify**.

**Resultado esperado:**
- Step **build** falha; job **verify** vermelho.
- Steps **typecheck**, **test**, **audit:coupling** ficam como **não executados** (fail-fast — a quebra
  mais cedo da chain).

---

## Cenário 5 — SC-002 / US1-AC1: quebra de tipos → step `typecheck` vermelho

**Ações:**
1. Em branch de teste, introduzir erro de tipo que **não** quebra o build mas o `tsc --noEmit` pega
   (ex.: atribuição de tipo incompatível em código que o build tolera). Se o build também quebrar, o
   cenário vira o 4 — ajustar a quebra para atingir só o typecheck.
2. Abrir PR e observar.

**Resultado esperado:**
- Step **build** verde; step **typecheck** falha; job vermelho.
- **test** e **audit:coupling** não executados. Check `verify` "failed" visível no PR.

---

## Cenário 6 — SC-002 / US1-AC2: teste vitest quebrado → step `test` vermelho

**Ações:**
1. Em branch de teste, quebrar deliberadamente uma asserção de teste (ou introduzir bug de runtime que
   faça um teste existente falhar) sem quebrar build/typecheck.
2. Abrir PR e observar.

**Resultado esperado:**
- **build** e **typecheck** verdes; step **test** falha; job vermelho.
- **audit:coupling** não executado.

---

## Cenário 7 — SC-002 / US1-AC3: vazamento de termo de negócio → step `audit:coupling` vermelho

**Ações:**
1. Em branch de teste, introduzir um vazamento de termo de negócio em `templates/engine/` que o
   `pnpm audit:coupling` reprova (P2 — motor agnóstico de negócio), sem quebrar build/typecheck/test.
2. Abrir PR e observar.

**Resultado esperado:**
- **build**, **typecheck**, **test** verdes; step **audit:coupling** falha; job vermelho.
- Confirma que a última etapa da chain também bloqueia e que nenhuma combinação de quebra reporta verde
  (fecha SC-002 junto dos Cenários 4–6).

---

## Cenário 8 — US2-AC2: frozen-lockfile falha se o lockfile divergir

**Ações:**
1. Em branch de teste, alterar `package.json` (ex.: mudar a versão de uma dependência existente) **sem**
   atualizar o `pnpm-lock.yaml`.
2. Abrir PR e observar o step de install (`pnpm install --frozen-lockfile`).

**Resultado esperado:**
- O step de **install** falha explicitamente (lockfile desatualizado) — **antes** de build/typecheck/
  test/audit rodarem. Job vermelho já no install. Previne "funciona na minha máquina" com deps
  divergentes (Edge Case da spec).

---

## Cenário 9 — US2-AC3: Node do runner satisfaz `engines.node` (>=18)

**Ações:**
1. Em qualquer run concluído, abrir o log do step **setup-node** (`actions/setup-node`).
2. Ler a versão de Node provisionada.

**Resultado esperado:**
- Node **22** (única versão, sem matriz) provisionado, satisfazendo `engines.node >=18`. Confirmado no
  log do runner, não presumido.

---

## Cenário 10 — US2-AC4: install sem `ERR_PNPM_IGNORED_BUILDS`

**Ações:**
1. Em um run com **cache frio** (primeira execução após o merge, ou run onde o cache do pnpm não bate),
   abrir o log do step **install**.
2. Procurar por `ERR_PNPM_IGNORED_BUILDS` ou aviso de build-scripts ignorados.

**Resultado esperado:**
- Install conclui **sem** `ERR_PNPM_IGNORED_BUILDS` e os steps **build/test/audit:coupling** rodam
  normalmente — porque `pnpm-workspace.yaml` (`esbuild: false`) versionado neutraliza o "deps status
  check" do pnpm 11. Verificar tanto em cache frio quanto quente: o veredito é idêntico, o cache só
  muda o tempo (Edge Case da spec).

---

## Cenário 11 — US3-AC1 / SC-001 na default: push/merge na `main` dispara o mesmo workflow

**Ações:**
1. Mergear um PR verde (ex.: o descartável do Cenário 2, se aplicável) ou fazer um push direto na `main`
   (via bypass admin).
2. Abrir a aba **Actions** e filtrar por eventos na `main`.

**Resultado esperado:**
- O merge commit / push na `main` dispara um run do workflow **CI** (evento `push`, branch `main`),
  executando a mesma chain na mesma ordem. Histórico verde/vermelho da própria `main` passa a existir.
- Runs de `main` **não** se cancelam entre si (só PRs cancelam runs redundantes) — confirmar que dois
  pushes seguidos na `main` geram dois runs que ambos concluem.

---

## Cenário 12 — SC-006: status check estável `verify` + aplicar o ruleset como required check

Esta é a **ação administrativa fora do commit** (branch protection). O arquivo `.github/rulesets/
main.json` é a fonte versionada; aplicá-lo é passo manual do mantenedor.

**Ações:**
1. Confirmar que, após ≥1 run, o check aparece com nome **`verify`** (estável entre runs, sem sufixo de
   matriz/variável) na lista de checks do PR.
2. Aplicar o ruleset por um dos caminhos (ver `.github/rulesets/README.md`):
   - **UI:** Settings → Rules → Rulesets → **Import** → selecionar `main.json`; ou
   - **API:** `gh api -X POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json`.
3. Em Settings → Rules, abrir o ruleset "main protection" e confirmar o required status check.
4. Abrir um PR com **verify vermelho** (reusar qualquer cenário 4–8) e tentar mergear.

**Resultado esperado:**
- Na configuração do required check, **`verify`** aparece selecionável e casa com o nome do job — sem
  reconfiguração a cada run (nome estável, SC-006/FR-009).
- Ruleset "main protection" fica **active** sobre `refs/heads/main`; `verify` listado em
  `required_status_checks`.
- Com o ruleset ativo, o merge do PR de check vermelho fica **bloqueado**; um PR de check verde é
  mergeável. É aqui que o valor end-to-end da feature (CI bloqueando merge) se prova.
- Admin (RepositoryRole) mantém bypass (`always`) — sem lockout do dono.

---

## Notas de descarte

- Todas as branches de quebra deliberada (Cenários 4–8) são **descartáveis**: fechar o PR sem merge e
  apagar a branch. Nenhuma dessas quebras deve chegar à `main`.
- Recomenda-se rodar os cenários de quebra **antes** de aplicar o ruleset como required (Cenário 12), ou
  via bypass admin, para não travar o próprio ciclo de teste.
