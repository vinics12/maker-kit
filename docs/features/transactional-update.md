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
Arquivos binários, bases históricas ausentes e caminhos controlados por add-ons sem migração segura
são preservados. As bases gravadas em `.maker/bases/` são só as que o manifest passa a referenciar,
então dois `maker update` seguidos não alteram nada no segundo.

`maker add` mantém a base upstream do alvo de injeção e `maker remove` a devolve ao engine: o
update seguinte trata o conteúdo sem o bloco como edição local e faz merge 3-way em vez de
sobrescrevê-lo. Alvos gravados por versões antigas sem base exata são preservados como edição local.

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
  copiado para o papel e o update avisa que ele fica sob controle do add-on, sem updates do template.

Em ambos os casos o adapter mantém o frontmatter, referencia o papel e volta ao engine no manifest.
O destino precisa estar ausente, conter um template do engine sem edições locais (o atual ou o
registrado no manifest, mesmo que de uma versão anterior) ou já conter exatamente o conteúdo migrado
sob a mesma origem de add-on. Isso também repara instalações que já passaram pela 0.4.x.

Se o add-on foi reaplicado (`maker add`) depois de um update sem migração, o state e o papel já estão
corretos: quando o agente legado não tem customização e seu bloco é igual ao do papel, só o adapter
é regenerado. Havendo customização, o agente é preservado e o update indica movê-la para o papel.

Para voltar a receber o template num papel migrado com customização, use `maker remove <addon>`: as
customizações ficam no papel e o update seguinte as mescla com o template atual. Depois reaplique o
add-on com `maker add <addon>`.

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
