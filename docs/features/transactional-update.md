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

Use `maker update --no-merge` para manter a política conservadora anterior. Arquivos binários,
states legados sem base exata e caminhos controlados por add-ons também são preservados.
