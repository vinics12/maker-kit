# Guia de aceite manual — 003 Estado compacto em `.maker` (lockfile do estado)

**Feature**: `specs/003-compact-maker-state/` · **Branch**: `003-compact-maker-state`
**Tipo**: CLI headless (HAS_UI=false). Todas as jornadas são feitas no terminal.
**Pré-condição global**: Gate 3 verde (364 testes, `package:smoke` ok, `dist/` reconstruído). Este guia
**não** repete o que a automação já prova (parser do lockfile, rollback por injeção de falha, paridade
de merge entre formatos, determinismo byte a byte entre SOs, cada código de achado do doctor). O foco
aqui são as jornadas de negócio e as decisões que só um humano julga: a migração de um install
**1.0.0 real**, se a saída se lê bem, a convivência com a 1.x no time, merge de branches e o PR.

Decisões em vigor: default `"pack"`; Q1 = BREAKING CHANGE (2.0.0); Q2 = `.gitattributes` da raiz
intocado. Emendas do Gate 3: doctor aceita CRLF no frontmatter de `.claude/**` (T406); constante única
da dica de opt-out (T606).

---

## 0. Preparação (uma vez)

```bash
# 1) CLI nova (esta branch)
cd <worktree>                           # raiz do repositório nesta branch
export NEW="node $PWD/dist/cli.js"

# 2) CLI publicada 1.0.0, isolada num diretório temporário
export OLDDIR=$(mktemp -d)
(cd "$OLDDIR" && npm i --silent --no-audit --no-fund @vinicius.cerqueira/maker@1.0.0)
export OLD="$OLDDIR/node_modules/.bin/maker"
$OLD --version                          # esperado: 1.0.0
```

Todos os projetos de teste ficam em diretórios de `mktemp -d`. Nada neste guia toca o repositório do
maker.

---

## J1 — Migração de um install 1.0.0 real para o lockfile (caminho feliz principal)

**Cobre**: AC-31, AC-12, AC-08/SC-007, AC-02/SC-004 (customizações), AC-03, AC-36, AC-18, SC-001,
FR-029, FR-030, FR-006a (texto de opt-out na saída).
**Por que manual**: o install de partida é produzido pelo **binário 1.0.0 publicado**, não por fixture.

### Pré-condições

```bash
export P1=$(mktemp -d) && cd "$P1"
git init -q && git config user.email qa@example.com && git config user.name QA
$OLD init  --target "$P1" --yes --name "Nimbus" --agent claude
$OLD agent add codex --target "$P1"
$OLD add saas --target "$P1" --yes
git add -A && git commit -qm "install maker 1.0.0"

# Customizações locais em dois arquivos gerenciados
echo "<!-- customização local -->" >> AGENTS.md
echo "Regra local do time" >> .maker/workflow/agents/architect.md
git commit -qam "customizações locais"
```

### Passos e resultado esperado

1. **Contagem antes** — `find .maker -type f | wc -l` → **101** (manifest + ~86 bases + add-on + 12
   papéis). `ls .maker` mostra `addons bases manifest.json transactions workflow`.
2. **Doctor da versão nova antes de migrar** — `$NEW doctor --target "$P1"`:
   - sai com código **0** e termina em `✓ Install íntegro.`;
   - a seção `Estado (.maker):` traz **`info`** `o próximo maker update migrará as bases para o formato "pack"`
     com a ação `para manter bases por arquivo, declare "state": { "bases": "files" } em maker.config.json`;
   - `personalizado:` lista `AGENTS.md` e `.maker/workflow/agents/architect.md`.
3. **Dry-run legível e determinístico**:
   ```bash
   $NEW update --dry-run --target "$P1" > /tmp/d1.txt; echo "rc=$?"
   $NEW update --dry-run --target "$P1" > /tmp/d2.txt
   diff /tmp/d1.txt /tmp/d2.txt && echo IDENTICOS
   git status --porcelain                  # vazio: dry-run não escreve
   grep -v '^preserve' /tmp/d1.txt
   ```
   Esperado: `rc=0`, `IDENTICOS`, `git status` vazio. O bloco de migração aparece **no topo**, antes do
   plano:
   ```
   Migração do formato das bases: files → pack
     86 base(s) migrada(s), 0 descartada(s).
     O formato "pack" é o padrão; para manter as bases por arquivo, declare "state": { "bases": "files" } em maker.config.json.
   ```
   e as linhas de plano não-`preserve` incluem `create .maker/.gitattributes`, `create .maker/.gitignore`,
   `create .maker/maker.lock [metadata] — publicar estado (manifest + bases)`,
   `remove .maker/manifest.json [metadata] — consolidado no formato pack` e
   `remove .maker/bases [metadata] — armazenamento de bases por arquivo removido`.
   **Julgamento humano**: um consumidor que nunca ouviu falar da feature entende, só por esse bloco, o
   que vai acontecer e como evitar? A contagem está visível sem precisar rolar as ~130 linhas de plano?
4. **Aplicar**:
   ```bash
   shasum AGENTS.md .maker/workflow/agents/architect.md > /tmp/antes.sha
   $NEW update --target "$P1"; echo "rc=$?"
   shasum -c /tmp/antes.sha
   ```
   Esperado: `✓ Migração do formato das bases: files → pack` com as mesmas contagens e a dica de
   opt-out; `2 preservado(s) por segurança.`; `rc=0`; `shasum -c` → ambos `OK` (customizações byte a
   byte intactas).
5. **Estado resultante**:
   ```bash
   find .maker -type f | sort
   ls .maker/manifest.json .maker/bases 2>&1     # ambos: No such file or directory
   ls .maker/addons 2>&1                                     # No such file or directory (US-7)
   ls -la .gitattributes; git diff HEAD -- .gitattributes   # raiz intocada (Q2/FR-030)
   ls .gitignore 2>&1                                       # nenhum .gitignore de raiz criado
   ```
   Esperado: exatamente `.maker/.gitattributes`, `.maker/.gitignore`, `.maker/maker.lock` e os 12
   `.maker/workflow/agents/*.md` — **sem** `.maker/addons/saas.json`: o estado do add-on `saas` migrou
   junto para a seção `[addons]` do lockfile, na mesma transação. O `.gitattributes` da raiz (que o
   engine já instalava na 1.0.0) não aparece no diff.
6. **Doctor verde lendo só o lockfile** — `$NEW doctor --target "$P1"` → `Estado (.maker): íntegro (pack)`,
   add-on `saas · … · íntegro` (lido da seção `[addons]`, sem `.maker/addons`), `✓ Install íntegro.`,
   código 0.
7. **Commit e contagem de versionados (SC-001)**:
   ```bash
   git add -A && git commit -qm "maker: migra estado para pack"
   git ls-files .maker | wc -l                   # esperado: 15
   git show --stat HEAD | tail -1
   ```
   Esperado: **15** (de 101). O commit remove `manifest.json`, `addons/saas.json` e ~86 bases, e cria
   `maker.lock`.
8. **Idempotência** — `$NEW update --target "$P1"` de novo → `✓ 0 arquivo(s) atualizado(s), 0 mesclado(s).`,
   sem bloco de migração; `git status --porcelain` vazio.
9. **Auditabilidade do lockfile (AC-05, leitura humana)** — `sed -n 1,20p .maker/maker.lock` e
   `grep -n '^\[bases\]' .maker/maker.lock`: cabeçalho `maker-lockfile 1`, seção `[manifest]` com uma
   linha por metadado (`agents`, `basesFormat "pack"`, `config`, `installedAt`, `makerVersion`,
   `project`, `schemaVersion`) e blocos `file "<path>"` com `baseHash`/`hash`/`source`; seção `[bases]`
   com `@base sha256=… size=… encoding=utf8` seguido do texto legível. **Julgamento**: dá para auditar
   uma mudança de estado lendo o arquivo num editor?
10. **Auditabilidade da seção `[addons]` (AC-41, US-7)** — `sed -n '/\[addons\]/,/\[bases\]/p' .maker/maker.lock`:
   uma unidade `addon "saas"` entre `[manifest]` e `[bases]`, com `appliedAt`, `createdFiles`,
   `injectedBlocks`, `injectedTargets`, `knobs` e `version` — os mesmos campos que
   `.maker/addons/saas.json` teria em `files`, um por linha.

---

## J2 — O diff de PR fica colapsado e os temporários não aparecem no git

**Cobre**: AC-22, AC-21, FR-027, FR-028, FR-002 (trade-off do colapso do manifest).
**Pré-condição**: `P1` ao fim de J1.

1. **Atributos efetivos (local)**:
   ```bash
   cd "$P1"
   git check-attr -a -- .maker/maker.lock
   ```
   Esperado: `diff: set`, `merge: text`, `text: unset`, `linguist-generated: true`.
2. **Temporários ignorados**:
   ```bash
   mkdir -p .maker/runs .maker/mediation .maker/transactions
   touch .maker/runs/r.jsonl .maker/mediation/m .maker/transaction.lock .maker/transactions/t.json
   git status --short --untracked-files=all      # esperado: nada listado
   rm -rf .maker/runs .maker/mediation .maker/transaction.lock .maker/transactions/t.json
   ```
3. **PR real (opcional, requer `gh` e uma conta de teste)** — publique `P1` num repositório descartável,
   crie uma branch que rode `$NEW remove saas --target "$P1"` e abra um PR:
   ```bash
   gh repo create qa-maker-003 --private --source "$P1" --push
   git checkout -b qa/remove-saas && $NEW remove saas --target "$P1"
   git add -A && git commit -qm "remove saas" && git push -u origin qa/remove-saas
   gh pr create --fill && gh pr view --web
   ```
   Esperado na aba "Files changed": `.maker/maker.lock` aparece **colapsado** como gerado ("Load diff");
   os arquivos de conteúdo (constitution, papéis) aparecem normalmente. **Julgamento humano**: o revisor
   ainda percebe que o estado mudou? A doc (`docs/maker-state.md` §2, "linguist-generated colapsa também
   o manifest") explica como expandir. Apague o repositório ao final (`gh repo delete qa-maker-003`).

---

## J3 — Opt-out para bases por arquivo e volta ao pack

**Cobre**: AC-24, AC-25/SC-004, AC-27 (formato registrado prevalece sem config), AC-32, AC-35, AC-33.

### J3a — Ida e volta num install já em pack

**Pré-condição**: `P1` ao fim de J1, `git status` limpo, sem `maker.config.json` na raiz.

1. `echo '{ "state": { "bases": "files" } }' > maker.config.json`
2. `$NEW update --dry-run --target "$P1" | grep -v '^preserve' | grep -v '^create   .maker/bases/'` →
   `Migração do formato das bases: pack → files` com `N base(s) migrada(s), 0 descartada(s).`, **sem**
   a dica de opt-out (a migração não decorre do default), `remove .maker/maker.lock` e
   `create .maker/manifest.json`.
3. `$NEW update --target "$P1"` → `✓ Migração do formato das bases: pack → files`. Depois:
   `ls .maker` mostra `bases` e `manifest.json` e **não** `maker.lock`; `ls .maker/bases | wc -l` = N;
   `grep basesFormat .maker/manifest.json` → `"basesFormat": "files"`; customizações intactas
   (`shasum -c /tmp/antes.sha`).
4. **Remover a config não migra de volta** (formato registrado prevalece):
   `rm maker.config.json && $NEW update --dry-run --target "$P1" | grep -c Migração` → `0`;
   `$NEW doctor --target "$P1"` → `Estado (.maker): íntegro (files)`, sem `info` de migração pendente.
5. **Voltar ao pack**: `echo '{ "state": { "bases": "pack" } }' > maker.config.json && $NEW update --target "$P1"`
   → `✓ Migração do formato das bases: files → pack`. Em seguida `rm maker.config.json` e
   `git status --porcelain` → **vazio**: o `maker.lock` regravado é byte a byte igual ao commitado em J1
   (ida e volta sem perda).

### J3b — Opt-out declarado antes da primeira migração (install 1.0.0 intacto)

```bash
export P3=$(mktemp -d)
$OLD init --target "$P3" --yes --name "Legado" --agent claude
$NEW agent add codex --target "$P3"              # comando pontual num install não migrado
ls "$P3/.maker"; grep -c basesFormat "$P3/.maker/manifest.json"
```
Esperado: `.maker` continua com `bases/` e `manifest.json`, sem `maker.lock`; `grep -c` → `0` (o
`agent add` não registrou formato — AC-33).

```bash
echo '{ "state": { "bases": "files" } }' > "$P3/maker.config.json"
$NEW doctor --target "$P3"           # Estado (.maker): íntegro (files), sem info de migração (AC-35)
$NEW update --target "$P3"           # sem bloco de migração
ls "$P3/.maker"; grep basesFormat "$P3/.maker/manifest.json"   # "basesFormat": "files"
```

---

## J4 — `doctor` com base ausente, corrompida por CRLF e lockfile de versão futura

**Cobre**: AC-14, AC-15, AC-16 (versão desconhecida), AC-19, FR-026 (ação recomendada), e a
recuperação pelo `update` descrita em `docs/maker-state.md` §4.
**Pré-condição**: um install limpo em pack commitado. Use `P1` (fim de J1/J3a) ou crie um novo:
```bash
export P4=$(mktemp -d) && cd "$P4" && git init -q && git config user.email qa@example.com && git config user.name QA
$NEW init --target "$P4" --yes --name "Orbita" --agent claude
git add -A && git commit -qm init
```

1. **Base ausente** — remova do lockfile o bloco da base referenciada por `AGENTS.md`:
   ```bash
   H=$(grep -A1 '^file "AGENTS.md"' .maker/maker.lock | grep -o '[0-9a-f]\{64\}')
   node -e 'const fs=require("fs"),h=process.argv[1];let s=fs.readFileSync(".maker/maker.lock","utf8");const i=s.indexOf("@base sha256="+h),e=s.indexOf("@end sha256="+h,i),j=s.indexOf("\n",e)+1;fs.writeFileSync(".maker/maker.lock",s.slice(0,i)+s.slice(j))' "$H"
   $NEW doctor --target "$P4"; echo "rc=$?"
   ```
   Esperado: `rc=1`; `falha  base ausente <hash> (referenciada por AGENTS.md)` e
   `ação: restaure a base <hash> do histórico do git; sem a base, o próximo maker update preserva o arquivo e pede mediação`.
   Note que `AGENTS.md` está intacto — antes desta feature o doctor sairia verde. Restaure com
   `git checkout -- .maker/maker.lock` e confirme doctor verde.
2. **Conversão CRLF do lockfile** (simula checkout sem o `.gitattributes` aplicado):
   ```bash
   perl -pi -e 's/\n/\r\n/' .maker/maker.lock
   $NEW doctor --target "$P4" | sed -n '/Estado/,/^$/p' | head -6; $NEW doctor --target "$P4" >/dev/null; echo "rc=$?"
   ```
   Esperado: `rc=1` e várias `falha  base corrompida <hash> [pack]: conteúdo recuperado (\r\n → \n) (recuperável: fins de linha convertidos para CRLF)`
   com `ação: rode maker update para regravá-la; confira .maker/.gitattributes`. **Julgamento**: com
   ~90 linhas repetidas, a mensagem ainda orienta bem? Em seguida:
   ```bash
   $NEW update --target "$P4"; $NEW doctor --target "$P4" >/dev/null; echo "rc=$?"
   git status --porcelain
   ```
   Esperado: doctor `rc=0` e `git status` vazio — o update regravou o lockfile em LF, idêntico ao commit.
3. **Lockfile de versão futura** (colega com maker mais novo):
   ```bash
   sed -i.bak '1s/.*/maker-lockfile 2/' .maker/maker.lock && rm .maker/maker.lock.bak
   $NEW doctor --target "$P4"; echo "rc=$?"
   $NEW update --target "$P4"; echo "rc=$?"
   $NEW add saas --yes --target "$P4"; echo "rc=$?"
   git status --porcelain
   ```
   Esperado: doctor `rc=1` com `falha  versão de formato do lockfile desconhecida` / `ação: atualize o maker`;
   update e add saem `rc=1` com `erro: .maker/maker.lock usa um formato mais novo (versão 2) que este maker entende (1); nenhuma alteração foi feita. Ação: atualize o maker.`;
   `git status` mostra **só** `M .maker/maker.lock` (a sua edição). Restaure com `git checkout -- .`.
4. **(Variante files, opcional)** — repita o passo 1 num install em files (`P3` de J3b): apague um
   arquivo de `.maker/bases/` referenciado; o doctor deve reportar `base ausente` citando o arquivo
   gerenciado, com a ação apontando o histórico do git.

---

## J5 — Merge de branches: sem conflito, com conflito no manifest e com formatos misturados

**Cobre**: AC-40, AC-39, AC-38, AC-17 (bases soltas → aviso), FR-015 (consolidação).
**Por que manual**: é o fluxo real do time — branches paralelas rodando o maker e o `git merge`.

### J5a — Merge limpo (duas operações diferentes)

```bash
export P5=$(mktemp -d) && cd "$P5" && git init -q && git config user.email qa@example.com && git config user.name QA
$NEW init --target "$P5" --yes --name "Orbita" --agent claude
git add -A && git commit -qm init && git branch -M main
git checkout -qb feat-codex && $NEW agent add codex --target "$P5" && git add -A && git commit -qm codex
git checkout -q main && git checkout -qb feat-saas && $NEW add saas --yes --target "$P5" && git add -A && git commit -qm saas
git checkout -q main && git merge -q feat-codex && git merge --no-edit feat-saas
git status --porcelain; $NEW doctor --target "$P5"; echo "rc=$?"
```
Esperado: nenhum `CONFLICT`; `git status` vazio; doctor com `claude` e `codex` íntegras,
`Estado (.maker): íntegro (pack)`, `saas · … · íntegro`, `rc=0`.

### J5b — Conflito na seção de manifest do lockfile

A partir de `main` em `P5` (após J5a):
```bash
git checkout -qb x && $NEW remove saas --target "$P5" && $NEW add saas --yes --set tenantColumn=org_id --target "$P5" && git add -A && git commit -qm x
git checkout -q main && git checkout -qb y && $NEW remove saas --target "$P5" && $NEW add saas --yes --set tenantColumn=account_id --target "$P5" && git add -A && git commit -qm y
git merge x                      # esperado: CONFLICT em .maker/maker.lock (e em arquivos de conteúdo)
grep -n '^<<<<<<<' .maker/maker.lock | head -3
$NEW doctor --target "$P5"; echo "doctor rc=$?"
$NEW update --target "$P5"; echo "update rc=$?"
$NEW init --yes --target "$P5"; echo "init rc=$?"
ls .maker/manifest.json 2>&1
```
Esperado:
- doctor `rc=1`: `falha  marcadores de conflito do git na seção de manifest (linha N)` /
  `ação: resolva o conflito em .maker/maker.lock ou restaure do histórico do git`;
- update e init `rc=1`: `erro: .maker/maker.lock contém marcadores de conflito do git na seção de manifest (linha N); nenhuma alteração foi feita. …`;
- `init` **não** reinstala e **não** cria `.maker/manifest.json` (install nunca tratado como ausente).

Resolução (escolhendo um lado inteiro):
```bash
git checkout --theirs -- .maker .specify
$NEW doctor --target "$P5"; echo "rc=$?"        # verde, saas com tenantColumn=org_id
git add -A && git commit -qm "merge x (theirs)" && git checkout -q main
```
**Julgamento humano**: a ação sugerida é suficiente para um dev resolver sem ler a doc? Se não, anote.

### J5c — Branch antiga em `files` misturada com `pack` (coexistência e bases soltas)

Use `P1` (limpo, com o histórico de J1). `C` é o último commit ainda em `files`, anterior à migração.
```bash
cd "$P1"
C=$(git log --format=%h --grep='customizações locais' -1)
git checkout C -- .maker/manifest.json
$NEW doctor --target "$P1"; echo "rc=$?"
$NEW update --target "$P1"; echo "rc=$?"
```
Esperado: doctor `rc=1` com `falha  .maker/manifest.json e .maker/maker.lock coexistem` /
`ação: escolha um estado e remova o outro, ou restaure .maker do histórico do git`; update `rc=1` com
`erro: … coexistem; nenhuma alteração foi feita. …`. Remova o manifest (`git rm -qf .maker/manifest.json`).

Agora só bases soltas:
```bash
B=$(git show --name-only --format= C -- .maker/bases | head -1)
git checkout C -- "$B"
$NEW doctor --target "$P1"; echo "rc=$?"
$NEW update --target "$P1" | head -3
ls .maker/bases 2>&1; git reset -q; git status --porcelain
```
Esperado: doctor `rc=0` com `aviso  bases por arquivo em .maker/bases junto ao lockfile` /
`ação: rode maker update para consolidar no formato configurado`; update imprime
`✓ Consolidação das bases: bases por arquivo → pack`; `.maker/bases` deixa de existir; depois do
`git reset`, `git status` vazio.

---

## J6 — Convivência com maker 1.x no time/CI

**Cobre**: FR-006b, Clarification 19/20, AC-37 (no binário real, não só no contrato), FR-006a.
**Pré-condição**: `P1` em pack, limpo (fim de J1). Registre o hash da árvore:
`git status --porcelain` vazio.

1. **Comandos da 1.0.0 contra um install em pack**:
   ```bash
   $OLD update --target "$P1";              echo "update rc=$?"
   $OLD update --export --target "$P1";     echo "export rc=$?"
   $OLD agent add codex --target "$P1";     echo "agent rc=$?"
   $OLD add saas --yes --target "$P1";      echo "add rc=$?"
   $OLD doctor --target "$P1";              echo "doctor rc=$?"
   git status --porcelain
   ```
   Esperado (observado na preparação): todos `rc=1` com `erro: Nenhum install do maker em …`
   (doctor: `… (.maker/manifest.json ausente).`), e `git status` **vazio**.
2. **`maker remove` da 1.0.0 (gatilho original desta emenda, Clarification 23)** — execute separadamente:
   ```bash
   $OLD remove saas --target "$P1"; echo "remove rc=$?"
   git status --porcelain
   ```
   Esperado (corrigido pela emenda): `rc=1` com `erro: Add-on "saas" não está aplicado em …` e
   `git status --porcelain` **vazio**. Antes da emenda, `.maker/addons/saas.json` sobrevivia à migração
   e a 1.0.0 (que lê esse arquivo antes do manifest, `v1.0.0:src/commands/remove.ts:13`) concluía o
   remove com `rc=0`, apagando arquivos e blocos por baixo do estado real em `maker.lock` — o bug que
   motivou esta emenda. Agora `.maker/addons/` não existe mais em pack (o estado do add-on migrou para
   a seção `[addons]` do lockfile na mesma transação), então a 1.0.0 não encontra nada para "ler antes
   do manifest" e para sem escrever.
3. **`maker list` da 1.0.0 (só leitura)**:
   ```bash
   $OLD list --target "$P1"; echo "list rc=$?"
   ```
   Esperado: `rc=0`, `saas` aparece como `available` (não `applied` — a 1.0.0 enumera
   `.maker/addons/*.json`, que não existe em pack), e nada é escrito.
4. **`maker init` sem `--force` da 1.0.0**:
   ```bash
   $OLD init --target "$P1" --yes --name Nimbus --agent claude; echo "rc=$?"
   ls .maker/manifest.json 2>&1; git status --porcelain
   ```
   Observado: a 1.0.0 **recusa** por colisão (`erro: A instalação não foi iniciada porque estes caminhos possuem conteúdo diferente … nenhuma alteração foi feita.`
   — os templates desta versão diferem dos da 1.0.0, ex.: `.claude/skills/maker-update/SKILL.md`), e não
   cria `.maker/manifest.json`. Isso é **mais seguro** que o descrito em `docs/maker-state.md` §5
   ("grava um segundo estado"); o caminho de coexistência que a doc descreve continua coberto pela
   detecção da J5c. Julgue se a doc deve ficar como está (conservadora) ou ser ajustada.
5. **(Opcional) `init --force` da 1.0.0** — limitação conhecida e documentada: reinstala por cima.
   Rode só se quiser ver o efeito e restaure com `git checkout -- . && git clean -fd`.

---

## J7 — Install novo nasce em pack e comandos pontuais preservam o formato

**Cobre**: AC-06, AC-30 (agent add), AC-36, SC-001 no `init`.

```bash
export P7=$(mktemp -d)
$NEW init --target "$P7" --yes --name "Novo" --agent claude
ls -A "$P7/.maker"                                   # .gitattributes .gitignore maker.lock transactions workflow
grep '^basesFormat' "$P7/.maker/maker.lock"          # basesFormat "pack"
$NEW agent add codex --target "$P7" && $NEW add saas --yes --target "$P7"
ls "$P7/.maker/bases" "$P7/.maker/manifest.json" "$P7/.maker/addons" 2>&1   # todos ausentes
$NEW doctor --target "$P7"; echo "rc=$?"
(cd "$P7" && git init -q && git add -A && git ls-files .maker | wc -l)   # 15
```
Esperado: nenhuma base por arquivo nem `.maker/addons` em momento algum (o `add saas` grava a unidade
direto na seção `[addons]` do lockfile); doctor verde (`íntegro (pack)`); 15 arquivos versionados em
`.maker` no install de referência (Claude + Codex + saas) sem nenhum opt-in.

---

## J8 — Documentação e notas de release

**Cobre**: AC-28, AC-29, FR-001, FR-002, FR-006a.

1. Abra `docs/maker-state.md` e confronte a tabela §1 com `ls -A` de `P1/.maker` (pack) e de
   `P3/.maker` (files), mais os temporários de J2: cada item em **exatamente uma** linha/categoria, com
   "Versionar?". Confira que a doc diz explicitamente que em pack não existem
   `manifest.json`/`bases/`/`addons/` (US-7).
2. Confira os números da doc contra o observado: pack **15** (J1/J7, com a emenda US-7 — antes eram 16,
   com `addons/saas.json` fora do lockfile). Para `files` a doc diz **137** arquivos no install de
   referência; o install 1.0.0 de J1 tinha **101** (sem `.gitattributes`/`.gitignore` e com menos
   bases) — julgue se a diferença de contexto está clara para o leitor.
3. Em `docs/MIGRATION.md`, seção "Bases no formato pack por padrão": opt-out, "atualize o maker em todo
   o time e na CI antes de migrar", limitações de `init`/`init --force`/`remove` da 1.x (inclusive o
   `remove` lendo `.maker/addons/<id>.json` antes do manifest). Compare com o que você observou na J6
   (em especial o `remove`, agora corrigido).
4. Notas de release (Q1 = BREAKING CHANGE): o texto de `contracts/cli-output.md` §5 deve entrar como
   rodapé `BREAKING CHANGE:` do commit/PR de entrega (`feat(state)!: …`), para o Release Please gerar
   2.0.0 e a seção "⚠ BREAKING CHANGES". Confira no PR antes do merge. `CHANGELOG.md` não é editado à mão.

---

## Achados da preparação (para decisão no aceite)

1. **`maker remove` da 1.0.0 escreve num install em pack** (J6 passo 2). **Resolvido pela Clarification
   23 (esta emenda, US-7)**: o estado de cada add-on aplicado passa a viver na seção `[addons]` do
   `maker.lock` em pack, e `.maker/addons/` deixa de existir — o `remove` da 1.0.0
   (`v1.0.0:src/commands/remove.ts:13`, que decide o fluxo por `.maker/addons/<id>.json` antes do
   manifest) não encontra mais nada para ler e conclui "não está aplicado" sem escrever. `AC-42`/`AC-37`
   passam a provar isso tanto pelo simulador quanto pelo **binário real da tag** (S7,
   `test/commands/legacy-reader.test.ts`). Documentação e texto de release corrigidos (D12).
2. **`maker init` sem `--force` da 1.0.0 recusa por colisão** em vez de gravar um segundo estado
   (J6 passo 4). É mais seguro que o documentado; a doc é conservadora. **Resolvido**: `docs/maker-state.md`
   §5, `docs/MIGRATION.md` e o texto do BREAKING CHANGE (`contracts/cli-output.md` §5) foram corrigidos
   para descrever o comportamento real e condicional da 1.x (D12).

---

## Checklist de aceite

| Jornada | ACs principais | OK? |
|---|---|---|
| J1 Migração 1.0.0 → pack | AC-31, 12, 08, 02, 03, 36, 18, SC-001, FR-030 | [ ] |
| J2 PR colapsado e temporários | AC-22, 21 | [ ] |
| J3 Opt-out e volta | AC-24, 25, 27, 32, 33, 35 | [ ] |
| J4 Doctor: ausente, CRLF, versão futura | AC-14, 15, 16, 19 | [ ] |
| J5 Merge: limpo, conflito, formatos misturados | AC-40, 39, 38, 17 | [ ] |
| J6 Convivência com 1.x | FR-006b, AC-37/AC-42 (binário real) | [ ] |
| J7 Install novo em pack | AC-06, 30, 36 | [ ] |
| J8 Docs e release notes | AC-28, 29, FR-006a | [ ] |
| Decisão sobre os achados 1 e 2 | — | [ ] |
