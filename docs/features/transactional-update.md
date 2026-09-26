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

Use `maker update --no-merge` para não mesclar edições locais com mudanças upstream. Arquivos
binários, bases históricas ausentes e caminhos controlados por add-ons sem migração segura são
preservados.

## Migração dos agentes legados

Ao atualizar instalações anteriores aos papéis compartilhados, `maker update` migra agentes Claude
controlados por add-on quando reconhece o frontmatter, um único bloco completo do add-on e seu
alvo no state. O corpo inteiro, incluindo customizações dentro e fora do bloco, passa para
`.maker/workflow/agents/<role>.md`; o adapter mantém o frontmatter e referencia esse papel.
O destino precisa estar ausente, conter um template do engine sem edições locais (o atual ou o
registrado no manifest, mesmo que de uma versão anterior) ou já conter exatamente o corpo legado sob
a mesma origem de add-on. Isso também repara instalações que já passaram pela 0.4.0.

Após a migração, o papel compartilhado passa a ser controlado pelo add-on, como qualquer alvo de
injeção: updates seguintes o preservam e não aplicam mudanças upstream do template desse papel.
Para voltar a recebê-las, use `maker remove <addon>` e `maker add <addon>`, revisando antes as
customizações do corpo migrado.

A migração altera somente os alvos correspondentes em `injectedTargets`, junto com os hashes e
bases do manifest. Constitution, knobs, versão e data de aplicação do add-on são preservados.
O corpo legado é conservado integralmente, sem regenerar suas instruções a partir do catálogo.
O novo caminho permite que Claude e Codex compartilhem as regras e que `maker remove` remova os
blocos nos destinos corretos. A operação participa da mesma transação do update e aparece no
`--dry-run`; `--no-merge` continua permitindo essa transferência sem mesclar conteúdos.

Quando o destino diverge ou os metadados/blocos são ambíguos, o adapter é preservado e o update
avisa, antes da aplicação, que a integração continuará degradada. Agentes legados editados sem
origem de add-on e sem base histórica exata também são preservados. Revise o corpo legado, o papel
compartilhado indicado e os alvos do state antes de migrar manualmente; reaplicar o add-on pode
substituir customizações. `maker doctor` e `maker agent list` distinguem adapter ausente, referência
ausente e arquivo compartilhado ausente, mostrando o caminho esperado e `maker update --dry-run`.
