# Estado do maker em `.maker`

Este documento explica o que existe dentro de `.maker` no projeto-alvo, o que versionar, os dois
formatos de armazenamento das bases de merge, como escolher/trocar entre eles e como diagnosticar e
recuperar o estado quando algo dá errado. A referência completa da gramática do lockfile fica em
`specs/003-compact-maker-state/contracts/lockfile-format.md`; este documento é a versão para consumo
externo, orientada a decisão e operação.

## 1. As quatro categorias de itens em `.maker`

| Categoria | Formato `files` | Formato `pack` | Versionar? |
|---|---|---|---|
| **Estado autoritativo** (manifest: metadados do install + entrada de cada arquivo gerenciado; estado de add-ons) | `.maker/manifest.json` | `.maker/maker.lock` (seção `[manifest]`) | **Sim** |
| **Snapshots de base** (conteúdo original de cada arquivo gerenciado, usado no merge 3-way) | um arquivo por hash em `.maker/bases/<hash>` | `.maker/maker.lock` (seção `[bases]`, dentro do mesmo arquivo do manifest) | **Sim** |
| **Arquivos gerenciados** (papéis do pipeline compartilhados pelos adaptadores) | `.maker/workflow/agents/*.md` | idem | **Sim** |
| **Temporários** (nunca versionar) | `.maker/transactions/`, `.maker/transaction.lock`, `.maker/mediation/`, `.maker/runs/` | idem | **Não** — cobertos por `.maker/.gitignore` |

Em `pack`, o lockfile (`.maker/maker.lock`) é **um único arquivo** que contém as duas primeiras
categorias — o manifest (estado autoritativo) e as bases (snapshots). Ele é listado uma única vez na
tabela acima como estado autoritativo porque essa é a categoria que domina sua natureza (é ele quem
identifica o install e quem os comandos mutantes leem/travam primeiro); a linha deixa explícito que
ele **também contém** os snapshots. **Nesse formato, `.maker/manifest.json` e `.maker/bases/` não
existem** — um leitor que procura por `.maker/manifest.json` (ex.: maker 1.0.0) conclui "nenhum
install" e não escreve nada por cima (ver §4).

Dois arquivos adicionais, de controle do git, são gerenciados como arquivos comuns (com merge 3-way e
preservação de customização) e sempre versionados nos dois formatos:

| Arquivo | Papel |
|---|---|
| `.maker/.gitattributes` | `maker.lock -text diff merge=text linguist-generated=true` e `bases/** -text linguist-generated=true` — impede conversão de fim de linha (o hash tem de conferir byte a byte) e marca o lockfile/as bases como gerados no PR. |
| `.maker/.gitignore` | `/transactions/`, `/transaction.lock`, `/mediation/`, `/runs/` — os temporários da categoria acima. |

### Install de referência

Um install com Claude + Codex + o add-on `saas`, no formato `pack` (o default), versiona **16
arquivos** em `.maker`:

- `maker.lock` (1)
- `addons/<id>.json` (1 por add-on aplicado — 1 para `saas`)
- `workflow/agents/*.md` (12 — um por papel do pipeline: `architect`, `code-reviewer`, `dev`,
  `e2e-planner`, `e2e-runner`, `feature-cataloguer`, `plan-reviewer`, `pm-validator`, `spec-author`,
  `spec-reviewer`, `ux-designer`, `visual-reviewer`)
- `.gitattributes`, `.gitignore` (2)

No formato `files`, o mesmo install versiona os mesmos 16 mais `manifest.json` e uma base por arquivo
gerenciado (`.maker/bases/<hash>`) em vez do único `maker.lock`.

## 2. Formatos de armazenamento das bases

A chave de config `state.bases` escolhe onde o manifest e as bases vivem:

```json
{ "state": { "bases": "pack" } }
```

| Valor | Onde fica | Quando usar |
|---|---|---|
| `"pack"` (**default**) | Tudo em `.maker/maker.lock`, um único arquivo | Padrão recomendado: menos ruído de diff, menos arquivos no PR |
| `"files"` (opt-out) | `.maker/manifest.json` + uma base por arquivo em `.maker/bases/` | Quando cada base precisa aparecer como um diff de arquivo próprio no PR |

### Trade-offs

- **Legibilidade por arquivo × número de arquivos/ruído de diff**: em `files`, cada base é um arquivo
  próprio — o diff de uma única base trocada é curto e isolado, mas um install com dezenas de arquivos
  gerenciados também tem dezenas de arquivos de base no `git status`/PR. Em `pack`, o PR ganha um único
  arquivo (`maker.lock`) para revisar, mas uma mudança em qualquer base ou entrada de manifest aparece
  como um diff dentro desse arquivo.
- **`linguist-generated` colapsa também o manifest**: como o `maker.lock` é marcado
  `linguist-generated=true` (para que o diff de bases não polua o PR), a plataforma de review colapsa
  a visualização padrão do arquivo **inteiro** — inclusive as mudanças na seção `[manifest]`, que não
  são conteúdo gerado a partir de bytes de terceiros e podem interessar ao revisor (ex.: um arquivo
  novo entrou no install). Para revisar essas mudanças:
  - na plataforma de review, use a opção "Load diff" (ou equivalente) no arquivo colapsado;
  - localmente, `git diff -- .maker/maker.lock` sempre mostra o diff completo (o atributo só afeta a
    UI de review, não o git em si);
  - para desativar o colapso só na sua cópia local, adicione a linha `.maker/maker.lock
    -linguist-generated` em `.git/info/attributes` (não versionado — afeta só quem o configurar).
- **Risco residual de conflito na seção de bases**: duas branches inserindo/removendo bases distintas
  na mesma vizinhança de hash podem gerar um conflito de merge do git dentro do `maker.lock`. Quando o
  conflito cobre blocos `@base…@end` inteiros, o maker recupera os dois lados automaticamente na
  próxima leitura; quando o git refina o conflito para dentro do conteúdo de uma base (conflito
  intercalado), essa base fica indisponível até ser restaurada — nesse caso, `maker update` já trata a
  situação como "base ausente": o arquivo dependente é preservado e encaminhado para mediação. Ver §3.

## 3. Escolher e trocar de formato

- **Sem nada declarado**, o formato efetivo é `"pack"` (o default). Instalações novas (`maker init`)
  já nascem em `pack`.
- Para **manter (ou voltar a) bases por arquivo**, declare o opt-out em `maker.config.json`:

  ```json
  { "state": { "bases": "files" } }
  ```

- A resolução do formato efetivo segue esta ordem: `state.bases` de `maker.config.json` do projeto →
  formato já registrado no manifest → `"pack"`. Só `maker init` e `maker update` gravam/alteram o
  formato registrado; `agent add`, `add` e `remove` preservam o campo como encontraram e operam no
  formato em uso, sem migrar.
- **Trocar de formato** é rodar `maker update` depois de mudar (ou remover) `state.bases`: o comando
  migra o manifest e as bases para o formato efetivo, remove os arquivos do formato antigo
  (`.maker/manifest.json` + `.maker/bases/` ou o `maker.lock`, conforme a direção) e imprime um
  relatório antes do resumo (também em `--dry-run`):

  ```
  Migração do formato das bases: files → pack
    87 base(s) migrada(s), 1 descartada(s).
    descartada 3f9a…(64) [files] conteúdo não confere com o hash → afeta: AGENTS.md
    O formato "pack" é o padrão; para manter as bases por arquivo, declare "state": { "bases": "files" } em maker.config.json.
  ```

  Bases que não migram (corrompidas, hash não confere) entram em "descartada(s)" com o hash, a origem
  e os arquivos afetados; esses arquivos recebem o tratamento normal de base ausente no próprio
  `update` (preservados, com mediação). A migração é transacional: um crash no meio dela nunca deixa o
  projeto sem nenhum estado autoritativo (ver §4).
- Bases soltas em `.maker/bases/` encontradas junto de um lockfile em uso (ex.: checkout de uma branch
  antiga) são **consolidadas** no mesmo update, mesmo sem mudança de formato.

## 4. Diagnóstico e recuperação

`maker doctor` é o primeiro passo em qualquer situação estranha; a seção "Estado (.maker):" reporta
cada achado com severidade e ação. Casos cobertos:

| Situação | O que acontece | Como recuperar |
|---|---|---|
| **Coexistência** (`.maker/manifest.json` **e** `.maker/maker.lock` presentes ao mesmo tempo — típico de merge entre branches em formatos diferentes) | Comandos mutantes abortam antes de escrever; `doctor` falha | Escolha um dos dois estados e remova o outro, ou restaure `.maker` do histórico do git |
| **Lockfile ilegível** (JSON/arquivo corrompido, cabeçalho ausente) | Comandos mutantes abortam; `doctor` falha | Restaure `.maker/maker.lock` do histórico do git |
| **Versão de formato desconhecida** (cabeçalho `maker-lockfile N` com `N` maior que o suportado) | Comandos mutantes abortam; `doctor` falha | Atualize o maker |
| **Base ausente** (hash referenciado pelo manifest sem conteúdo correspondente, em nenhum dos dois formatos) | O `update` preserva o arquivo dependente e pede mediação | Restaure a base do histórico do git; sem ela, a mediação resolve o arquivo dependente |
| **Base corrompida** (conteúdo não confere com o hash declarado) | `doctor` falha | Restaure a base do histórico do git; confira `.maker/.gitattributes` (fim de linha) |
| **CRLF** (o lockfile ou uma base foram convertidos para `\r\n`, ex.: clone sem o `.maker/.gitattributes` aplicado ainda) | A leitura tenta a variante `\r\n → \n`; se o sha256 conferir depois da conversão, a base é recuperada e utilizável para merge, mas o `doctor` **continua** reportando `base-corrupt` (o armazenamento está, de fato, corrompido) | Confira que `.maker/.gitattributes` está presente e aplicado (`git check-attr -a -- .maker/maker.lock`); rode `maker update` — ele regrava a base correta (em `files`: sobrescreve; em `pack`: o lockfile inteiro é regravado) |
| **Conflito de merge no lockfile, seção `[manifest]`** (duas branches editando a mesma linha, ou inserindo `file` novo na mesma vizinhança) | Comandos mutantes abortam antes de escrever; `doctor` falha, apontando a linha | Resolva o conflito manualmente em `.maker/maker.lock` ou restaure do histórico do git |
| **Conflito de merge no lockfile, seção `[bases]`, em blocos inteiros** (inserção/remoção de bases distintas) | Os dois lados são recuperados automaticamente; `doctor` avisa | Rode `maker update` — ele regrava o lockfile limpo |
| **Conflito de merge no lockfile, seção `[bases]`, intercalado** (o git refina o conflito para dentro do conteúdo de uma base) | As bases atingidas ficam indisponíveis (contam como ausentes) — nenhum conteúdo misturado é usado como base de merge | Restaure a base do histórico do git, ou resolva por mediação como qualquer base ausente |
| **`maker.config.json` ilegível** (JSON malformado) | O formato das bases é **mantido** (sem migração); o `update` avisa e o `doctor` reporta (aviso) | Corrija o JSON; a próxima leitura escolhe o formato normalmente |
| **`.maker/.gitignore`/`.maker/.gitattributes` pré-existentes** (projeto que já tinha esses arquivos antes de rodar o maker) | Nunca sobrescritos: se o conteúdo já é igual ao gerado, passam a ser rastreados; se difere, são preservados e encaminhados para mediação | Resolva a mediação normalmente (`maker update --export` / `--apply-resolutions`, ou a skill `maker-update`) |
| **Transação pendente** (comando interrompido no meio de uma escrita, inclusive de uma migração) | O próximo comando mutante recupera a transação **antes** de ler o resto do estado; o `doctor` reporta isso antes de qualquer outro achado, inclusive antes de concluir "nenhum install" | Rode qualquer comando que altera o install (ex.: `maker update`) — a recuperação é automática |

Instalação íntegra (qualquer formato): a seção do doctor imprime só
`Estado (.maker): íntegro (<formato>)`.

## 5. Compatibilidade com a 1.0.0

A CLI publicada como 1.0.0 não valida `schemaVersion` e todos os seus comandos mutantes (e o
`doctor`) identificam um install pela presença de `.maker/manifest.json`. Num install em `pack` esse
arquivo não existe — a única mitigação possível para quem ainda roda a 1.0.0 é a orientação nas notas
de release (ver o texto completo em `CHANGELOG.md`, a partir do commit desta mudança):

- **`maker init` (sem `--force`) da 1.0.0 sobre um install em `pack`**: não encontra colisão (não há
  `.maker/manifest.json`) e grava `.maker/manifest.json` + `.maker/bases/` ao lado do `maker.lock`. A
  versão atual detecta essa **coexistência** no próximo comando e aborta com a ação de resolver
  manualmente (ver tabela do §4) — não há degradação silenciosa, mas o dano (dois estados presentes)
  já aconteceu antes de o maker poder avisar. Por isso: **atualize o maker em todo o time e na CI antes
  de migrar** um projeto para o formato compacto.
- **`maker init --force` da 1.0.0 sobre um install em `pack`** (limitação conhecida): `--force` não
  depende do manifest para decidir se reinstala, então reinstala por cima independentemente do
  formato. É uma ação explícita de força; a mitigação é a mesma orientação acima.

Veja `docs/MIGRATION.md` para o passo a passo completo de atualização de um install existente,
incluindo a seção "Bases no formato pack por padrão".
