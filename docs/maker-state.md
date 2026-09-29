# Estado do maker em `.maker`

Este documento explica o que existe dentro de `.maker` no projeto-alvo, o que versionar, os dois
formatos de armazenamento (manifest, estado de add-ons e bases), como escolher/trocar entre eles e
como diagnosticar e recuperar o estado quando algo dá errado.

## 1. As quatro categorias de itens em `.maker`

Uma linha por item, nos dois formatos:

| Item | Categoria | `files` | `pack` | Versionar? |
|---|---|---|---|---|
| `.maker/maker.lock` | Estado autoritativo (contém também os snapshots e o estado de add-ons) | — | ✓ | Sim |
| `.maker/manifest.json` | Estado autoritativo | ✓ | — | Sim |
| `.maker/bases/<hash>` | Snapshots de base | ✓ | — | Sim |
| `.maker/addons/<id>.json` | Estado autoritativo | ✓ | — | Sim |
| `.maker/workflow/agents/*.md` | Arquivos gerenciados | ✓ | ✓ | Sim |
| `.maker/.gitattributes` | Arquivos gerenciados | ✓ | ✓ | Sim |
| `.maker/.gitignore` | Arquivos gerenciados | ✓ | ✓ | Sim |
| `.maker/transactions/` | Temporários | ✓ | ✓ | Não |
| `.maker/transaction.lock` | Temporários | ✓ | ✓ | Não |
| `.maker/mediation/` | Temporários | ✓ | ✓ | Não |
| `.maker/runs/` | Temporários | ✓ | ✓ | Não |

- **Estado autoritativo**: metadados do install e uma entrada por arquivo gerenciado (manifest), mais
  o estado de cada add-on aplicado. Em `pack` o manifest vive dentro do `.maker/maker.lock`, numa seção
  de texto `[manifest]` com uma linha por metadado e um bloco por arquivo, e o estado de cada add-on
  aplicado vive na seção `[addons]` do mesmo arquivo (uma unidade `addon "<id>"` por add-on, sempre
  presente mesmo vazia); em `files` o manifest é `.maker/manifest.json` e cada add-on aplicado tem seu
  próprio `.maker/addons/<id>.json` (o mesmo formato lido pela 1.0.0). **Nunca os dois ao mesmo tempo**:
  um `.maker/addons/<id>.json` regular coexistindo com um `maker.lock` é tratado como o mesmo tipo de
  problema que manifest.json + maker.lock coexistindo (ver §4).
- **Snapshots de base**: o conteúdo original de cada arquivo gerenciado (o "base" do merge 3-way),
  endereçado por hash sha256. Em `pack` fica na seção `[bases]` do mesmo `.maker/maker.lock` — por
  isso esse arquivo tem uma única linha na tabela, como estado autoritativo, com a ressalva "contém
  também os snapshots"; em `files` é um arquivo por hash em `.maker/bases/`.
- **Arquivos gerenciados**: papéis do pipeline compartilhados pelos adaptadores
  (`.maker/workflow/agents/*.md`) e os dois arquivos de controle do git, também mantidos por merge
  3-way com preservação de customização: `.maker/.gitattributes` (`maker.lock -text diff merge=text
  linguist-generated=true` e `bases/** -text linguist-generated=true` — impede conversão de fim de
  linha e marca lockfile/bases como gerados no PR) e `.maker/.gitignore` (`/transactions/`,
  `/transaction.lock`, `/mediation/`, `/runs/` — os temporários da linha seguinte).
- **Temporários**: nunca versionados, cobertos pelo `.maker/.gitignore` acima —
  `.maker/transactions/` (journal de transações), `.maker/transaction.lock` (mutex), `.maker/mediation/`
  (exports/propostas em andamento) e `.maker/runs/` (event-stream do pipeline gerado).

**Em `pack`, `.maker/manifest.json`, `.maker/bases/` e `.maker/addons/` não existem**: um leitor que
procura por `.maker/manifest.json` ou por `.maker/addons/<id>.json` (ex.: maker 1.0.0) conclui "nenhum
install"/"add-on não aplicado" e não escreve nada por cima (ver §5).

### Install de referência

Um install com Claude + Codex + o add-on `saas` versiona, em `.maker` (**desta versão**; a 1.0.0
publicada, sem a seção `[addons]`, versiona **101** arquivos em `.maker` num install equivalente
migrado, com **86** bases — números de outra geração de formato, citados aqui só como referência
histórica do aceite):

- **`pack`** (o default): **15 arquivos** — `maker.lock` (1, com o estado do add-on `saas` na seção
  `[addons]`), `workflow/agents/*.md` (12: `architect`, `code-reviewer`, `dev`, `e2e-planner`,
  `e2e-runner`, `feature-cataloguer`, `plan-reviewer`, `pm-validator`, `spec-author`, `spec-reviewer`,
  `ux-designer`, `visual-reviewer`), `.gitattributes` e `.gitignore` (2).
- **`files`**: **137 arquivos** — os mesmos 14 papéis/controles acima mais `addons/saas.json` (1),
  `manifest.json` (1) e uma base por arquivo gerenciado em `.maker/bases/<hash>` (121, incluindo os
  arquivos do SpecKit stock e os demais arquivos comuns do engine, não só os 12 papéis). O número de
  `files` não muda com esta emenda: `.maker/addons/saas.json` continua existindo nesse formato.

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
- **`linguist-generated` colapsa também o manifest e o estado de add-ons**: como o `maker.lock` é
  marcado `linguist-generated=true` (para que o diff de bases não polua o PR), a plataforma de review
  colapsa a visualização padrão do arquivo **inteiro** — inclusive as mudanças na seção `[manifest]` e
  na seção `[addons]`, que não são conteúdo gerado a partir de bytes de terceiros e podem interessar ao
  revisor (ex.: um arquivo novo entrou no install, ou um add-on foi aplicado/removido). Para revisar
  essas mudanças:
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
- **Risco residual análogo na seção de add-ons**: duas branches aplicando add-ons **novos e distintos**
  cujas unidades caem no mesmo intervalo do texto (sem nenhuma unidade inalterada entre elas) também
  podem conflitar textualmente — o mesmo risco de duas unidades `file` novas no mesmo intervalo, agora
  para `addon "<id>"`. O merge aborta com marcadores de conflito (`addons-conflict` no próximo
  `maker doctor`/comando mutante); resolução manual: mantenha as duas unidades no lockfile (cada add-on
  numa unidade própria) e resolva os marcadores como um conflito de texto comum.

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
  migra o manifest, o estado de cada add-on aplicado e as bases para o formato efetivo, remove os
  arquivos do formato antigo (`.maker/manifest.json` + `.maker/bases/` + `.maker/addons/` ou o
  `maker.lock`, conforme a direção) e imprime um relatório antes do resumo (também em `--dry-run`):

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
| **Manifest ilegível** (`.maker/manifest.json` com JSON malformado, formato `files`) | Comandos mutantes abortam; `doctor` falha | Restaure `.maker/manifest.json` do histórico do git |
| **Lockfile ilegível** (`.maker/maker.lock` com cabeçalho ausente ou conteúdo que não segue a gramática do formato, formato `pack`) | Comandos mutantes abortam; `doctor` falha | Restaure `.maker/maker.lock` do histórico do git |
| **Versão de formato desconhecida** (cabeçalho `maker-lockfile N` com `N` diferente da versão suportada por este maker) | Comandos mutantes abortam; `doctor` falha | Atualize o maker |
| **Base ausente** (hash referenciado pelo manifest sem conteúdo correspondente, em nenhum dos dois formatos) | O `update` preserva o arquivo dependente e pede mediação | Restaure a base do histórico do git; sem ela, a mediação resolve o arquivo dependente |
| **Base corrompida** (conteúdo não confere com o hash declarado) | `doctor` falha | Restaure a base do histórico do git; confira `.maker/.gitattributes` (fim de linha) |
| **CRLF** (o lockfile ou uma base foram convertidos para `\r\n`, ex.: clone sem o `.maker/.gitattributes` aplicado ainda) | A leitura tenta a variante `\r\n → \n`; se o sha256 conferir depois da conversão, a base é recuperada e utilizável para merge, mas o `doctor` **continua** reportando `base-corrupt` (o armazenamento está, de fato, corrompido) | Confira que `.maker/.gitattributes` está presente e aplicado (`git check-attr -a -- .maker/maker.lock`); rode `maker update` — ele regrava a base correta (em `files`: sobrescreve; em `pack`: o lockfile inteiro é regravado) |
| **Conflito de merge no lockfile, seção `[manifest]`** (duas branches editando a mesma linha, ou inserindo `file` novo na mesma vizinhança) | Comandos mutantes abortam antes de escrever; `doctor` falha, apontando a linha | Resolva o conflito manualmente em `.maker/maker.lock` ou restaure do histórico do git |
| **Conflito de merge no lockfile, seção `[bases]`, em blocos inteiros** (inserção/remoção de bases distintas) | Os dois lados são recuperados automaticamente; `doctor` avisa | Rode `maker update` — ele regrava o lockfile limpo |
| **Conflito de merge no lockfile, seção `[bases]`, intercalado** (o git refina o conflito para dentro do conteúdo de uma base) | As bases atingidas ficam indisponíveis (contam como ausentes) — nenhum conteúdo misturado é usado como base de merge | Restaure a base do histórico do git, ou resolva por mediação como qualquer base ausente |
| **`maker.config.json` ilegível** (JSON malformado) | O formato das bases é **mantido** (sem migração); o `update` avisa e o `doctor` reporta (aviso) | Corrija o JSON; a próxima leitura escolhe o formato normalmente |
| **`.maker/.gitignore`/`.maker/.gitattributes` pré-existentes** (projeto que já tinha esses arquivos antes de rodar o maker) | Nunca sobrescritos: se o conteúdo já é igual ao gerado, passam a ser rastreados; se difere, são preservados e encaminhados para mediação | Resolva a mediação normalmente (`maker update --export` / `--apply-resolutions`, ou a skill `maker-update`) |
| **Transação pendente** (comando interrompido no meio de uma escrita, inclusive de uma migração) | O próximo comando mutante recupera a transação **antes** de ler o resto do estado; o `doctor` reporta isso antes de qualquer outro achado, inclusive antes de concluir "nenhum install" | Rode qualquer comando que altera o install (ex.: `maker update`) — a recuperação é automática |
| **Coexistência de add-on** (`.maker/addons/<id>.json` **e** `.maker/maker.lock` presentes ao mesmo tempo) | Comandos mutantes abortam antes de escrever; `doctor` falha | Escolha um dos dois estados e remova o outro, ou restaure `.maker` do histórico do git |
| **Seção `[addons]` do lockfile ilegível** (gramática, JSON, duplicata, schema, seção ausente/truncada) | Comandos mutantes abortam; `doctor` falha; `list` sai com erro | Restaure `.maker/maker.lock` do histórico do git |
| **Conflito de merge na seção `[addons]`** | Comandos mutantes abortam; `doctor` falha | Resolva o conflito em `.maker/maker.lock` ou restaure do histórico do git |
| **Estado de add-on não migrável** (`files` em uso, migração para `pack` pendente, e há um `.maker/addons/<id>.json` inválido ou com chave fora da gramática do lockfile) | `update`/`init` que migrariam abortam antes de escrever; `doctor` avisa (não degrada o install) | Corrija ou restaure o arquivo do histórico do git, ou declare `{ "state": { "bases": "files" } }` em `maker.config.json` (opt-out) |
| **JSON de add-on órfão** (`.maker/addons/*.json` sem `manifest.json` nem `maker.lock`) | Não é tratado como "aplicado": `init` aborta (coexistência, variante órfã); `remove` responde "não está aplicado"; os demais comandos respondem "nenhum install"; `list` mostra o add-on como `degraded` | Remova `.maker/addons/` (se o install não existe mais) ou restaure `.maker` do histórico do git |
| **`.maker/addons` que não é diretório** (arquivo ou symlink no lugar do diretório) | Em `pack`, tolerado sem achado; quando um plano precisa **escrever** ali (`add`/mediação em `files`, ou migração `pack → files`) o planejamento aborta com uma mensagem clara em vez de falhar no meio da transação | Remova ou renomeie `.maker/addons` e rode o comando de novo |

Instalação íntegra (qualquer formato): a seção do doctor imprime só
`Estado (.maker): íntegro (<formato>)` (ex.: `Estado (.maker): íntegro (pack)`) e o doctor termina em
`✓ Install íntegro.`.

## 5. Compatibilidade com a 1.0.0

A CLI publicada como 1.0.0 não conhece a seção `[addons]` nem o `maker.lock`: cada comando mutante (e
o `doctor`) decide se há install ou se um add-on está aplicado pelo **primeiro arquivo de estado que lê**
— e esse arquivo não existe num install em `pack`. A única mitigação possível para quem ainda roda a
1.0.0 é a orientação nas notas de release (ver o texto completo em `CHANGELOG.md`, a partir do commit
desta mudança):

- **`update`, `update --export`, `update --apply-resolutions`, `agent add` e a mediação da 1.0.0**
  sobre um install em `pack`: leem `.maker/manifest.json` primeiro, não o encontram, concluem "nenhum
  install" e **param sem escrever nada**.
- **`add` da 1.0.0**: usa `.maker/addons/<id>.json` só para um log informativo (existe/não existe) e em
  seguida lê `.maker/manifest.json` para aplicar — não encontrando, também para sem escrever.
- **`remove` da 1.0.0** (o gatilho original desta emenda): lê `.maker/addons/<id>.json` **antes** do
  manifest — não encontrando, conclui "add-on não está aplicado" e para, mesmo que o add-on esteja de
  fato aplicado no `maker.lock`. Nenhum dos dois casos escreve nada.
- **`list` da 1.0.0** (só leitura): enumera `.maker/addons/*.json`; num install em `pack` não vê nenhum,
  então mostra todo o catálogo como "disponível" — nunca como aplicado.
- **`maker init` sem `--force` da 1.0.0** sobre um install em `pack`: recusa por colisão enquanto
  houver arquivos gerados que diferem do que ela renderizaria (o caso comum de um install feito por
  esta versão) e, recusando, **não grava nada**.
- **`maker init --force` da 1.0.0** sobre um install em `pack` (limitação conhecida): `--force` não
  depende do manifest para decidir se reinstala, então **reinstala por cima** independentemente do
  formato — o resultado é coexistência (`.maker/manifest.json` e/ou `.maker/addons/*.json` ao lado do
  `maker.lock`). A versão atual **detecta essa coexistência** no próximo comando e aborta com a ação de
  resolver manualmente (ver tabela do §4) — não há degradação silenciosa, mas o dano (dois estados
  presentes) já aconteceu antes de o maker poder avisar. Por isso: **atualize o maker em todo o time e
  na CI antes de migrar** um projeto para o formato compacto.

Veja `docs/MIGRATION.md` para o passo a passo completo de atualização de um install existente,
incluindo a seção "Bases no formato pack por padrão".
