# Guia de migração: 0.2.x, 0.3.x e 0.4.x → versão atual

Este guia leva um projeto instalado com o maker 0.2.x, 0.3.x ou 0.4.x até um install íntegro na
versão atual, sem perder o que foi customizado. A 0.3.x já usava papéis compartilhados como a 0.4.x:
onde o guia fala em 0.4.x, vale também para ela. Ele cobre os problemas de incompatibilidade conhecidos:

- agentes Claude 0.2.x com add-on que ficaram sem referência ao papel compartilhado
  (`maker doctor` mostra a integração Claude como **degradada**);
- add-on reaplicado (`maker add`) depois de um update, deixando o projeto degradado sem saída;
- `maker remove` seguido de `maker update` sobrescrevendo customizações de arquivos que tinham bloco de add-on;
- installs 0.2.x sem config registrada, renderizados com valores padrão (`just dev` → `npm run dev`);
- constitution e papéis com blocos de add-on que nunca recebiam o template novo;
- customizações perdidas em updates seguidos a um merge.

A atualização é transacional: se qualquer passo falhar, nada é gravado. Mesmo assim, comece com o
repositório limpo para poder comparar e desfazer com o git.

## 1. Preparação

1. Faça commit (ou stash) de tudo: `git status` deve estar limpo.
2. Atualize a CLI: `npm i -g @vinicius.cerqueira/maker` e confira com `maker --version`.
3. **Installs 0.2.x:** a 0.2.x não gravava a config no manifest. Se o projeto não tem
   `maker.config.json` na raiz, recrie-o com os valores usados no `init` (nome, layout, comandos
   `verify`/`build`/`test`/`dev`, agente). Sem ele, o update preserva os arquivos que dependem da
   config e a mediação fica indisponível — veja o [caso F](#f-install-02x-sem-makerconfigjson).
4. Adicione `.maker/mediation/` ao `.gitignore` (é onde a mediação exporta arquivos temporários).

## 2. Diagnóstico

```bash
maker doctor
maker update --dry-run
```

O `--dry-run` não escreve nada e sai com código 0 quando o update resolve tudo sozinho, 1 quando há
conflito e 2 quando sobra mediação ou agente degradado. Ele mostra, por arquivo, o que o update fará (`create`, `update`,
`merge`, `preserve`, `conflict`), um bloco **Agentes legados** com o destino de cada agente
(`migrar`, `pendente`, `degradado`) e, quando for o caso, quantos arquivos precisam de mediação.
Use a tabela abaixo para achar o seu caso.

| O que aparece | Caso |
|---|---|
| Só `update`/`create`, agentes `migrar … corpo sem customização` | [A/B](#ab-02x-sem-customização) |
| `migrar … corpo personalizado; copiado como está` | [C](#c-agentes-02x-customizados) |
| `degradado … papel compartilhado … já possui conteúdo local` ou `… customizações ausentes de` | [D/E](#de-install-04x-degradado-ou-add-on-reaplicado) |
| `Config do projeto não recuperada` / `depende de config não recuperada` | [F](#f-install-02x-sem-makerconfigjson) |
| `conflict … mudanças locais e upstream na mesma região` ou `N arquivo(s) precisam de mediação` | [G](#g-conflitos-e-customizações-que-o-merge-não-resolve) |
| `degradado … o frontmatter restringe tools sem Read` | [H](#h-agente-com-tools-sem-read) |
| Vai rodar `maker remove` num install antigo, ou customizações sumiram depois de um `remove` | [I](#i-maker-remove-em-installs-antigos) |

## 3. Casos

### A/B. 0.2.x sem customização

Com ou sem add-on, basta:

```bash
maker update
maker doctor   # ✓ Install íntegro.
```

Agentes 0.2.x com add-on viram adapters que leem `.maker/workflow/agents/<role>.md`, e o papel
recebe o template atual com o bloco do add-on — idêntico a uma instalação nova. A constitution com
blocos de add-on passa a acompanhar o template por merge.

### C. Agentes 0.2.x customizados

Vale para agentes com bloco de add-on (`architect`, `code-reviewer`) e para os demais agentes do
engine (ex.: `e2e-runner`). O maker compara o agente com o template 0.2.x empacotado para separar o
que é seu. O update copia o corpo do agente, com as customizações, para o papel compartilhado e
regenera o adapter mantendo o frontmatter (`model`, `color`, `tools`…). O template 0.2.x vira a base do papel,
então as próximas versões do template chegam por merge 3-way. Confira depois do update:

```bash
git diff -- .maker/workflow/agents/ .claude/agents/
maker doctor
```

### D/E. Install 0.4.x degradado ou add-on reaplicado

Acontece quando o projeto foi atualizado por uma 0.3.x/0.4.x (que preservava os agentes legados sem
migrá-los) e, às vezes, o add-on foi reaplicado com `maker add`.

- **Sem customização no agente legado:** `maker update` só regenera o adapter (`migrado … (só o
  adapter)`). Nada a fazer além do update.
- **Com customização no agente legado e o papel compartilhado ainda intacto:** o update migra como no
  [caso C](#c-agentes-02x-customizados) — inclusive agentes do engine como o `e2e-runner`.
- **Com o papel compartilhado também editado** (as duas cópias divergem): o agente é preservado como
  `degradado` e entra na mediação como um grupo (agente legado + papel). Siga o [caso G](#g-conflitos-e-customizações-que-o-merge-não-resolve):
  a proposta leva as customizações e o bloco do add-on para o papel e deixa o adapter igual ao
  gerado. **Não reaplique o add-on** para tentar corrigir — isso não move as customizações.

### F. Install 0.2.x sem `maker.config.json`

Sem config, o update:

- renderiza com os padrões só os arquivos que não dependem da config;
- **preserva** os arquivos existentes que dependem dela e deixa pendentes os agentes cujo papel
  depende dela (`degradado … depende de config não recuperada`);
- cria os ausentes com os padrões e lista todos eles;
- recusa `--export`/`--apply-resolutions`.

Correção: crie `maker.config.json` com os valores do `init` e rode de novo.

```bash
maker update --dry-run   # agora sem avisos de config
maker update
maker doctor
```

Os arquivos criados com os padrões e ainda intactos são re-renderizados com a config correta, e os
agentes pendentes migram.

### G. Conflitos e customizações que o merge não resolve

O merge 3-way resolve sozinho quando você e o template mudaram regiões diferentes. Sobra para
mediação: mesma região alterada pelos dois, arquivos sem base exata que diferem do template e
agentes legados degradados que não puderam migrar automaticamente. Agentes legados customizados
com destino seguro migram no próprio update. Um `conflict` bloqueia o update inteiro até ser resolvido.

**Com um agente (recomendado).** Abra o projeto no Claude Code e rode `/maker-update` (no Codex,
`$maker-update`). Se a skill ainda não está instalada porque o update foi bloqueado por conflito,
use o fluxo manual abaixo uma vez; depois do primeiro update aplicado a skill fica disponível. O
agente exporta os itens, propõe o conteúdo final mantendo suas customizações, mostra o diff e só
aplica com a sua aprovação.

**Manual.**

```bash
maker update --export                     # grava .maker/mediation/
# para cada item em .maker/mediation/items/<id>/:
#   base      versão do template de onde seu arquivo partiu (quando conhecida)
#   local     seu arquivo atual
#   upstream  versão nova
# escreva o resultado em items/<id>/resolved (e, se quiser, notes.md)
maker update --apply-resolutions --dry-run   # mostra o diff local → proposta de cada item
maker update --apply-resolutions
maker update                              # aplica o restante do update
maker doctor
```

Uma exportação feita com `maker update --no-merge --export` é aplicada automaticamente no mesmo modo.

Regras que a CLI impõe (a proposta é recusada sem alterar nada):

- o arquivo não pode ter mudado desde a exportação — se mudou, exporte de novo;
- blocos `<!-- maker:addon:<id>:start/end -->` precisam continuar com o mesmo conteúdo (num grupo de
  agente legado, eles vão do agente para o papel);
- itens de um mesmo grupo são resolvidos juntos;
- sem marcadores de conflito, sem proposta vazia;
- nenhuma linha customizada (presente no seu arquivo e ausente da `base`) pode sumir. A CLI lista as
  linhas descartadas; se a remoção for intencional, aplique com `--accept-dropped`.

A checagem de linhas é literal: ela não percebe uma customização reescrita com outro sentido nem uma
regra movida para uma seção onde deixa de valer. Revise o diff `local → resolved` antes de aplicar. Itens sem `resolved` ficam pendentes e podem ser resolvidos
depois; `--export` recusa sobrescrever propostas ainda não aplicadas.

### H. Agente com `tools` sem `Read`

O adapter só funciona se o agente puder ler o papel compartilhado. Inclua `Read` na lista `tools:`
do frontmatter de `.claude/agents/<role>.md` e rode `maker update` de novo.

### I. `maker remove` em installs antigos

Installs cujo add-on foi aplicado antes desta versão não guardavam a base do template. Agora o
`remove` compara o arquivo com os templates conhecidos (em installs 0.2.x, crie o `maker.config.json`
antes; se o `remove` rodar sem ele, os arquivos ficam marcados como editados e são reavaliados no
primeiro `update` depois que a config existir):

- sem customização, o arquivo volta a ser tratado como intacto e o próximo update o regenera;
- com customização, o manifest o marca como editado (com o hash real, sem aparecer como
  `modificado` no doctor); no update, agentes são migrados como no [caso C](#c-agentes-02x-customizados)
  e os demais arquivos são preservados e encaminhados para mediação ([caso G](#g-conflitos-e-customizações-que-o-merge-não-resolve)).

Na 0.4.x, `maker remove` seguido de `maker update` sobrescrevia com o template as customizações da
constitution e dos papéis que tinham bloco de add-on. Se isso aconteceu, recupere o conteúdo pelo
histórico do git (`git log -p -- <arquivo>`) e reaplique-o à mão ou por mediação; a versão atual não
repete o problema.

## Bases no formato pack por padrão

A partir desta versão, o formato padrão de armazenamento do manifest e das bases é `"pack"`: tudo
vive num único arquivo, `.maker/maker.lock`, em vez de `.maker/manifest.json` + uma base por arquivo
em `.maker/bases/`. Detalhes completos (taxonomia, trade-offs, diagnóstico e recuperação) em
[`docs/maker-state.md`](maker-state.md).

- **Quem é afetado:** qualquer install sem `state.bases` declarado em `maker.config.json` e sem
  formato já registrado no manifest (a maioria dos installs existentes). O primeiro `maker update`
  depois de atualizar a CLI migra automaticamente: `.maker/manifest.json` e `.maker/bases/` deixam de
  existir e o conteúdo passa a viver em `.maker/maker.lock`. O `--dry-run` mostra o relatório da
  migração antes de aplicar (contagem de bases migradas/descartadas).
- **Opt-out:** para manter bases por arquivo, declare em `maker.config.json` antes de rodar o
  `update`:

  ```json
  { "state": { "bases": "files" } }
  ```

- **Atualize o maker em todo o time e na CI antes de migrar.** Versões anteriores (1.x) identificam um
  install pela presença de `.maker/manifest.json`; num install já em `pack` esse arquivo não existe.
  Comandos mutantes de uma versão antiga (`update`, `add`, `remove`, `agent add`) concluem "nenhum
  install" e **param sem escrever nada**. Já um `maker init` (sem `--force`) de uma versão antiga não
  vê colisão e **grava um segundo estado** — `.maker/manifest.json` + `.maker/bases/` ao lado do
  `maker.lock` — criando uma coexistência que a versão atual detecta e recusa a resolver sozinha
  (`maker doctor` falha, comandos mutantes abortam). `maker init --force` de uma versão antiga, por sua
  vez, **reinstala por cima** independentemente do formato (limitação conhecida). Depois do update, a
  seção de estado do `maker doctor` mostra `Estado (.maker): íntegro (pack)` e o doctor termina em
  `✓ Install íntegro.`

```bash
maker update --dry-run   # confere o relatório de migração antes de aplicar
maker update
maker doctor              # Estado (.maker): íntegro (pack) / ✓ Install íntegro.
```

## 4. Verificação final

- [ ] `maker doctor` termina com `✓ Install íntegro.` e sem arquivos aguardando mediação. Arquivos que
  você personalizar depois aparecem como `personalizado` — o update os preserva e mescla, e o doctor
  não os trata como problema. Só `modificado` (edição sem base registrada) pede `maker update --dry-run`.
- [ ] `maker update --dry-run` sai com código 0 e não lista `create`, `update`, `merge` nem `conflict`.
- [ ] `git diff` mostra suas customizações preservadas (agentes, papéis, constitution).
- [ ] `.maker/mediation/` não existe ou está no `.gitignore`.
- [ ] Faça commit do resultado.

## 5. Mudanças que podem surpreender

- **Data da constitution:** a linha `Gerado por: maker em <data>` passa a usar a data do install
  (`installedAt`). Em installs atualizados em outros dias, o primeiro update ajusta essa data uma vez;
  depois ela não muda mais.
- **Constitution personalizada de installs 0.2.x:** o template 0.2.x empacotado serve de base exata; a
  sua versão é preservada, a base passa a ser registrada e o doctor deixa de acusar divergência.
- **Arquivos com blocos de add-on** (constitution, papéis com fragmentos) passam a receber o template
  novo por merge, preservando os blocos e suas customizações; só vai para mediação o que você e o
  template mudaram na mesma região.
- **Exit code do `update`:** 2 quando o update foi aplicado mas sobraram itens de mediação ou agentes
  degradados. Scripts de CI que rodam `maker update` devem tratar esse código.
- **Manifest:** entradas podem ganhar `baseHash` (base do próximo merge) e `edited` (arquivo com
  customização sem base exata). Não edite esses campos à mão.
- **Nova skill** `maker-update` instalada para Claude (`.claude/skills/`) e Codex (`.agents/skills/`).
- **Doctor no Windows:** a validação de integração do frontmatter em `.claude/**` passa a tolerar
  `\r\n` (CRLF). Corrige um falso-positivo em projetos com `core.autocrlf=true` no Windows, onde o
  git converte esses arquivos para CRLF no checkout e o `doctor` reportava a integração Claude como
  quebrada mesmo em installs íntegros — bug presente desde a 1.0.0.

## 6. Se algo der errado

- Nenhum comando grava parcialmente: uma falha no meio desfaz a transação. Um comando interrompido
  (ex.: processo morto) é desfeito automaticamente pelo próximo comando que aplica mudanças; o
  `--dry-run` avisa quando há uma transação pendente.
- Para voltar ao estado anterior: `git checkout -- .` e, para apagar arquivos novos, veja antes o que
  sairia com `git clean -nd` (inclui `.maker/mediation/` com propostas ainda não aplicadas e arquivos
  seus não versionados) e só então rode `git clean -fd`. Ou reverta o commit da migração.
- Se o seu caso não está aqui, abra uma issue com a saída de `maker doctor` e
  `maker update --dry-run`.

Detalhes do funcionamento: [atualização transacional](features/transactional-update.md).
