# Observability do pipeline (event stream de runs)

> Catálogo as-built — conceitual. Para o contrato detalhado, ver a(s) spec(s) linkada(s).
> Última atualização: 2026-09-08 · Specs: 001-event-stream · PRs: #2

## O que faz / para quem

Dá ao autor de features (quem roda `/run-spec`) visibilidade sobre a própria execução do pipeline
do maker: quanto cada run custou (tokens), quanto tempo levou por gate, e por que uma decisão de
gate foi tomada — sem exigir nenhuma instrumentação manual do usuário e sem o humano digitar
motivo nenhum. É observability **do motor** (o pipeline `/run-spec` em si), não do produto que o
usuário está construindo com o maker.

## Entidades e regras de negócio

- **Run**: uma execução completa do `/run-spec`, do início ao fim. Cada run é identificado de
  forma única e acumula, ao longo de sua vida, uma sequência de eventos que nunca é reescrita —
  só cresce (append-only). Nenhum run anterior pode ser sobrescrito ou corrompido por um run novo
  ou por uma leitura.
- **Evento**: o registro atômico de algo que aconteceu durante um run — o run começou, um agente
  entregou trabalho a outro, um humano decidiu num gate, ou o run terminou. Todo evento carrega
  quando aconteceu, a qual run pertence, e seu custo (tokens gastos e tempo decorrido) como
  informação de primeira classe — custo e tempo não são um extra, são parte do contrato de todo
  evento de trabalho.
- **Fase / gate**: todo evento cujo custo é atribuível a um trabalho específico (o trabalho de um
  agente, ou a decisão de um gate) é associado a exatamente uma das quatro fases do pipeline
  (spec, plan, dev, review) — nunca ambíguo, nunca dividido entre fases. Eventos de nível do run
  inteiro (começo e fim) não pertencem a nenhuma fase.
- **Decisão de gate**: quando um humano aprova, reprova ou edita um artefato num gate, isso é
  registrado com quem decidiu e o que foi decidido. O motivo da decisão não é digitado pelo
  humano — é inferido automaticamente comparando o artefato antes e depois da intervenção humana
  e narrando a diferença em linguagem natural. Se não houve edição nenhuma (aprovação limpa),
  o sistema registra explicitamente "sem alterações", nunca inventa um motivo.
- **Regra de agregação custo→gate**: o custo total de um gate é a soma do custo de todo o
  trabalho atribuído àquela fase (o trabalho dos agentes mais a própria decisão do gate). Essa
  soma é sempre a mesma, não importa a ordem em que os eventos são lidos, e é calculada
  inteiramente a partir do que já está registrado — nenhuma fonte externa é consultada.

## Telas / fluxos (jornada)

- **Durante o run**: nenhuma ação do usuário. O pipeline grava eventos sozinho, de forma
  transparente, enquanto o `/run-spec` avança pelos agentes e gates.
- **Autor de feature consulta o histórico**: roda o comando de listagem de runs do maker e vê,
  para cada run já registrado, o custo e o tempo totais e a quebra por gate (spec, plan, dev,
  review). Se ainda não existe nenhum run registrado, vê uma mensagem informativa limpa — nunca
  um erro.
- **Autor de feature enxerga tendências**: na mesma listagem, para cada gate, vê quantos dos runs
  registrados tiveram ao menos uma reprovação naquele gate (ex.: "o gate de plano reprovou em 3
  de 8 runs"). É leitura de padrão sobre o histórico, sem qualquer proposta de mudança — a
  interpretação fica com o humano.
- **Robustez de leitura**: se um run foi interrompido no meio da gravação de um evento (crash), a
  listagem ainda funciona — ela ignora silenciosamente o registro incompleto e mostra tudo que
  está íntegro. A leitura do histórico nunca escreve ou altera nada nos registros.

## Pontos de integração (conceitual)

- **Com o pipeline `/run-spec`**: esta feature observa os 4 gates humanos já existentes do
  pipeline (spec, plan, dev, aceite) — não os altera, não os pula, apenas escuta e registra o que
  já acontece.
- **Não é observability do produto-alvo**: o histórico e o custo aqui são do próprio motor
  (quanto custou construir a feature X), não uma capacidade que o maker instala no projeto do
  consumidor. Observability do app que o usuário constrói é uma capacidade separada, ainda não
  entregue.
- **Substrato cru como integração futura**: o registro de eventos por run é um arquivo simples,
  uma entrada por evento, greppável e "pipeável" por ferramentas externas caso alguém precise
  — sem que o maker precise expor uma API ou exportação estruturada para isso.

## Decisões-chave e limitações conhecidas

- **Fricção humana zero na captura de motivo de gate**: o "porquê" de uma decisão de gate vem
  exclusivamente da comparação automática do artefato antes/depois, nunca de um campo de texto
  livre digitado pela pessoa nem de uma lista fixa de categorias pré-definidas.
  Um gate aprovado sem qualquer edição sempre resulta em "sem alterações", nunca em um motivo
  fabricado.
- **Sem shell externo**: tanto a leitura do histórico quanto o cálculo do diff de gate são feitos
  sem invocar nenhum programa externo do sistema operacional — mantém o motor idêntico em
  qualquer plataforma.
- **Primeiro run é registrado à mão**: como a instrumentação não existe enquanto ela mesma está
  sendo construída, o run que criou esta feature foi logado manualmente no mesmo formato dos
  demais, servindo de primeiro ponto de dado e validação do contrato do evento.
- **Fora de escopo (Fase 1)**:
  - Propor emendas à constitution a partir de padrões de reprovação recorrentes — precisa de
    mais volume de runs para fazer sentido; é visão futura, não escopo atual.
  - Retomar (resumir) um pipeline interrompido a partir do histórico — o registro de eventos
    hoje serve só para observar, não para reconstruir estado de execução.
  - Enviar qualquer dado do histórico para fora da máquina do usuário.
  - Exportação estruturada do histórico (ex.: formato tabular ou relatório consolidado) — hoje o
    consumo é só a listagem no terminal e o arquivo cru por trás dela.
  - Observability do produto que o usuário está construindo com o maker (isso é uma capacidade
    separada, ainda não entregue).

## Referências

- Spec: `specs/001-event-stream/`
- PR: https://github.com/vinics12/maker-kit/pull/2
