# CI de Pull Request

> Catálogo as-built — conceitual. Para o contrato detalhado, ver a(s) spec(s) linkada(s).
> Última atualização: 2026-09-11 · Specs: 002-github-actions-ci · PRs: #4

## O que faz / para quem

Todo Pull Request aberto contra a branch default (e todo push que chega diretamente nela) dispara
automaticamente uma verificação que reproduz fielmente a chain de verify que um contribuidor
rodaria localmente. O resultado vira um sinal objetivo e bloqueante do merge, em vez de depender da
disciplina de cada contribuidor de rodar o verify antes de abrir o PR. É infraestrutura de
tooling — sem UI, sem entidades de negócio — usada por qualquer pessoa que contribua com código ao
projeto e pelo mantenedor responsável por aceitar merges.

## Entidades e regras de negócio

Não há entidades de dados; o "artefato" é o próprio resultado da verificação, exposto como um
status check com nome estável no PR.

Regras que moldam o comportamento:

- A verificação executa sempre as mesmas quatro etapas, na mesma ordem canônica: build → checagem
  de tipos → testes → auditoria de acoplamento (a mesma auditoria que impede vazamento de
  terminologia de negócio para dentro do motor).
- É **fail-fast**: a primeira etapa que falhar interrompe a execução; as etapas seguintes não
  rodam. Um PR que quebra o build nunca chega a rodar os testes.
- A verificação nunca reimplementa ou chama a ferramenta por trás de cada etapa diretamente — ela
  sempre passa pelo mesmo comando de projeto que o contribuidor usaria localmente. Isso garante que
  "passou no meu computador" e "passou no CI" signifiquem a mesma coisa.
- O ambiente é determinístico: dependências instaladas a partir de um lockfile travado (falha
  explicitamente se o lockfile estiver desatualizado em relação às dependências declaradas) e uma
  única versão de Node compatível com o mínimo suportado pelo projeto — não uma matriz de versões.
- Execuções redundantes do mesmo PR (pushes sucessivos) cancelam a execução anterior em favor da
  mais recente, para não gastar tempo nem deixar um status obsoleto pendurado; execuções na branch
  default não se cancelam entre si.
- A verificação não consome segredos nem serviços externos — roda de forma idêntica em PRs vindos
  de forks.
- O escopo é estritamente validação: não há publish nem deploy nesta verificação.
- Como camada complementar, existe uma política de proteção da branch default versionada como
  configuração: exige que mudanças cheguem via PR, bloqueia exclusão e reescrita de histórico da
  branch, e declara o status check desta verificação como obrigatório para permitir o merge.
  Aplicar essa política no repositório é uma ação administrativa separada — a configuração apenas
  documenta e version a decisão.

## Telas / fluxos (jornada)

Não há tela; a jornada é orientada a eventos:

1. Contribuidor abre um PR (ou um commit chega à branch default) → a verificação dispara sozinha.
2. Ambiente é provisionado com as versões corretas de runtime e gerenciador de pacotes.
3. Dependências são instaladas de forma determinística; lockfile desatualizado já reprova aqui.
4. As quatro etapas de verify rodam em cadeia, parando na primeira falha.
5. O status (verde ou vermelho) é publicado no PR com nome estável.
6. Quando a política de proteção de branch estiver aplicada, o merge fica bloqueado enquanto o
   status estiver vermelho.

## Pontos de integração (conceitual)

- É um **complemento** aos quatro gates humanos do fluxo de spec-a-aceite — não os substitui.
  Não valida critérios de aceite de uma feature específica (isso é papel do validador humano no
  gate final); valida que a chain de verify do projeto passa.
- Reforça mecanicamente, a cada PR, os princípios de organização e de acoplamento do projeto (ex.:
  a auditoria que impede vazamento de termos de negócio para o motor), em vez de depender só de
  revisão humana para pegar essas violações.
- Convive com a política de artefatos do projeto: o próprio arquivo de verificação é um artefato
  durável que vive na branch default, diferente do material de execução do pipeline de
  desenvolvimento (efêmero e não versionado).

## Decisões-chave e limitações conhecidas

- Uma única versão de Node é usada (a mínima suportada pelo projeto), não uma matriz — prioriza um
  status check estável e barato sobre cobertura de múltiplas versões; matriz fica como evolução
  futura fora de escopo.
- Tornar o status check obrigatório no repositório é uma ação administrativa de configuração, não
  um artefato de código — a verificação garante apenas que o check exista com nome estável.
- Falhas de infraestrutura do provedor de execução (indisponibilidade de rede, etc.) aparecem como
  erro de job, não são tratadas como caso especial distinto de falha de código.
- Sem publish/deploy: o escopo é exclusivamente validação de PR.

## Referências

- Spec(s): `specs/002-github-actions-ci/`
- PR(s): https://github.com/vinics12/maker-kit/pull/4
