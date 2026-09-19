# Catálogo local de add-ons

> Catálogo as-built — conceitual. Última atualização: 2026-09-19 · Issue: #8

## O que faz / para quem

Permite que usuários descubram as capacidades opcionais distribuídas com o Maker sem precisar
conhecer previamente seus IDs. O comando `maker list` funciona dentro ou fora de um projeto
inicializado e apresenta nome, descrição, versão, knobs e próximo comando de cada add-on.

## Estados

- **available**: existe no catálogo empacotado e ainda não possui state no projeto.
- **applied**: possui state válido, com ID e versão compatíveis com o catálogo.
- **degraded**: o manifest ou state é inválido, incompatível ou órfão. A listagem continua e orienta
  o usuário a executar `maker doctor`.

## Regras e limitações

- O catálogo é exclusivamente local; não consulta registry nem rede.
- A saída é textual, determinística e ordenada pelo ID do add-on.
- `maker list` diagnostica somente a coerência básica de catálogo e state. Verificação de arquivos,
  hashes e blocos injetados pertence ao `maker doctor`.
- O comando não instala, remove ou repara add-ons automaticamente.
