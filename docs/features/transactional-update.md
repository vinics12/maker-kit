# Planejamento transacional e merge de atualizações

`maker init`, `maker update`, `maker add` e `maker remove` calculam todas as mudanças antes de
escrever. Use `--dry-run` para listar arquivos criados, atualizados, preservados, removidos e
conflitantes em ordem determinística.

As aplicações usam um journal em `.maker/transactions/`. Uma falha restaura o estado anterior; se
o processo for interrompido, o próximo comando mutante recupera a transação antes de recalcular o
plano. Manifest e states são publicados somente depois dos arquivos correspondentes.

O manifest v3 referencia bases exatas e deduplicadas em `.maker/bases/`. `maker update` combina a
base anterior, o conteúdo local e a nova versão upstream. Mudanças independentes são mescladas;
conflitos preservam o conteúdo local, bloqueiam toda a aplicação e retornam exit code diferente de
zero. O Maker não grava marcadores de conflito.

Um arquivo já mesclado é comparado com sua base upstream, não com o hash gravado após o merge: as
edições locais incorporadas continuam sendo mescladas nos updates seguintes em vez de sobrescritas.

Use `maker update --no-merge` para não mesclar edições locais com mudanças upstream; nessa
modalidade a migração de agentes legados também não é aplicada, apenas listada como pendente.
Arquivos binários, bases históricas ausentes e agentes legados sem migração segura são preservados
e, quando cabe, encaminhados para mediação. Merges cujo resultado já é o conteúdo atual não são
contados como mesclados. As bases gravadas em `.maker/bases/` são só as que o manifest passa a referenciar,
então dois `maker update` seguidos não alteram nada no segundo.

## Arquivos com blocos de add-on

Os blocos de add-on (`<!-- maker:addon:<id>:start -->` … `end`) são tratados como edições locais do
arquivo: o template novo chega pelo mesmo merge 3-way dos demais arquivos, e o merge só é aceito se
mantiver cada bloco intacto. Quando o arquivo é o template atual com os blocos reinjetados — caso de
alvos gravados sem base por versões antigas —, o update apenas adota o template atual como base, sem
pedir mediação. A comparação ignora a data de geração que o template da constitution grava. O que o
merge não resolve (mesma região alterada pelo dono e pelo template, ou arquivo sem base que difere do
template) é preservado e encaminhado para mediação.

`maker add` mantém a base upstream do alvo de injeção e `maker remove` a devolve ao engine, então o
update seguinte mescla as customizações em vez de sobrescrevê-las. Em alvos gravados sem base, o
`remove` compara o arquivo com o template atual (e, em agentes Claude 0.2.x, com o template 0.2.x):
sem customização, o arquivo volta a ser tratado como intacto; com customização, o manifest o marca
como editado (`edited`), com o hash real, e o update o preserva e o encaminha para mediação.

## Config de instalações 0.2.x

A 0.2.x não gravava a config no manifest; ela só é recuperada de `maker.config.json` na raiz do
projeto. Sem essa fonte, o update renderiza com os valores padrão apenas os arquivos que não
dependem da config (detectados renderizando também com valores sentinela). Arquivos existentes que
dependem dela, incluindo agentes Claude 0.2.x cujo papel depende dela, são preservados, e os
ausentes são criados com os padrões; o update lista ambos. Crie `maker.config.json` com os valores
usados no init e execute `maker update --dry-run` para renderizá-los com a config correta.

## Migração dos agentes legados

Na 0.2.x os agentes Claude eram completos em `.claude/agents/<role>.md`, com o bloco do add-on
injetado. Ao atualizar, `maker update` migra os agentes controlados por add-on quando reconhece o
frontmatter, um único bloco completo do add-on e seu alvo no state:

- **Sem customização** (o corpo sem o bloco é igual ao template 0.2.x renderizado, ao template atual
  ou ao papel stock intacto): o papel `.maker/workflow/agents/<role>.md` recebe o template atual com o
  bloco do add-on, idêntico a uma instalação nova com o add-on. O template 0.2.x fica empacotado em
  `templates/legacy/0.2.0/`, para que o reconhecimento continue válido quando o template atual mudar.
- **Com customização**: o corpo inteiro, normalizado como o engine grava papéis compartilhados, é
  copiado para o papel, com o template 0.2.x como base: updates do template chegam por merge.

Em ambos os casos o adapter mantém o frontmatter, referencia o papel e volta ao engine no manifest.
O destino precisa estar ausente, conter um template do engine sem edições locais (o atual ou o
registrado no manifest, mesmo que de uma versão anterior) ou já conter exatamente o conteúdo migrado
sob a mesma origem de add-on. Isso também repara instalações que já passaram pela 0.4.x.

Se o add-on foi reaplicado (`maker add`) depois de um update sem migração, o state e o papel já estão
corretos: quando o agente legado não tem customização e seu bloco é igual ao do papel, só o adapter
é regenerado. Havendo customização, o agente é preservado e o update indica movê-la para o papel.

Sem config recuperável, agentes cujo papel ou adapter depende dela não são migrados (nem recebem uma
base renderizada com os valores padrão): ficam degradados até `maker.config.json` existir.

A migração altera somente os alvos correspondentes em `injectedTargets`, junto com os hashes e
bases do manifest. Constitution, knobs, versão e data de aplicação do add-on são preservados.
O novo caminho permite que Claude e Codex compartilhem as regras e que `maker remove` remova os
blocos nos destinos corretos. A operação participa da mesma transação do update e aparece no
`--dry-run`; o update só relata as migrações depois de aplicá-las.

O agente é preservado, com aviso de que a integração continuará degradada, quando o destino diverge,
os metadados ou blocos são ambíguos ou o frontmatter restringe `tools:` sem `Read` (o adapter não
conseguiria ler o papel; inclua `Read` e rode o update de novo). Agentes legados editados sem origem
de add-on e sem base histórica exata também são preservados. O update imprime uma linha por agente,
um bloco único de ação recomendada e o total de agentes migrados e degradados. `maker doctor` e
`maker agent list` distinguem adapter ausente, referência ausente e arquivo compartilhado ausente,
mostrando o caminho esperado e `maker update --dry-run`.

## Mediação com agente

O merge automático só aplica o que consegue provar seguro. O restante pode ser mediado por um agente
com a skill `maker-update` (`/maker-update` no Claude Code, `$maker-update` no Codex); o update avisa
quando há itens assim. O maker continua sendo o único a escrever nos arquivos gerenciados:

1. `maker update --export [dir]` grava em `dir` (padrão `.maker/mediation`) um `mediation.json` e, para
   cada item, `upstream` (nova versão), `local` (conteúdo atual) e `base` (versão upstream de onde o
   local partiu, quando conhecida). Nada é aplicado. Entram: conflitos do merge, edições locais sem
   base exata ou com a base ausente, arquivos de add-on cujo template mudou desde a última
   reconciliação e agentes legados sem referência ao papel compartilhado — estes em grupo com o papel,
   para resolver os dois juntos. Sem config recuperável a exportação é recusada, porque as versões
   upstream sairiam com os valores padrão.
2. O agente escreve a proposta em `items/<id>/resolved` (e a justificativa em `notes.md`), revisando o
   diff com o dono. Itens adiados ficam sem proposta.
3. `maker update --apply-resolutions [dir] --dry-run` valida e mostra o plano; sem `--dry-run`, aplica
   numa única transação. Toda proposta é rejeitada, sem alterar nada, quando: o arquivo mudou desde a
   exportação, a versão do maker ou a config mudou, contém marcadores de conflito, está vazia ou não é
   UTF-8, perde ou desbalanceia blocos de add-on, resolve só parte de um grupo, o adapter do agente
   legado não mantém a instrução que lê o papel ou fica com blocos de add-on, ou o caminho não é um
   arquivo gerenciado. Blocos de add-on precisam manter os mesmos ids com o mesmo conteúdo (podem
   mudar de arquivo dentro de um grupo); blocos novos são recusados. O maker recalcula os itens de
   mediação e só aceita propostas para itens que ainda correspondem a eles: caminho, upstream, base e
   origem vêm do cálculo atual e do manifest, nunca do índice ou das cópias exportadas, que o agente
   pode editar. A CLI não detecta customizações fora dos blocos que a proposta tenha descartado —
   essa revisão é do agente e do dono.

Cada arquivo aplicado passa a ter como base a versão upstream exportada, então o update seguinte
mescla normalmente a partir dela. Em agentes legados, o adapter volta ao engine e o papel fica com a
origem do add-on cujos blocos recebeu, com `injectedTargets` atualizado. Itens aplicados saem da
exportação, que é removida quando não sobra nenhum. Os ids são estáveis por caminho, e `--export`
recusa sobrescrever uma exportação com propostas (`resolved`/`notes.md`) ainda não aplicadas.
Mantenha o diretório fora do versionamento (por exemplo, `.maker/mediation/` no `.gitignore`).
`maker doctor` informa quantos arquivos aguardam mediação, sem tratar isso como install degradado.
