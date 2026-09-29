# Feature Specification: Estado compacto em `.maker` sem perder bases de reconciliação

**Feature Branch**: `003-compact-maker-state`
**Created**: 2026-09-27
**Status**: Draft (emendada em 2026-09-28 — Clarification 23)
**Input**: Issue GitHub #41 — "Compactar o estado versionado em .maker sem perder bases de reconciliação" — mais as decisões de escopo aprovadas pelo humano antes da spec.

## Contexto

Todo projeto consumidor versiona o diretório `.maker`. Nele convivem, sem distinção explícita, coisas
de naturezas diferentes: o inventário autoritativo do install (manifest e estado de add-ons), um
snapshot de base por conteúdo de arquivo gerenciado (hoje, **um arquivo por base**), os papéis de
workflow compartilhados pelos agentes e diretórios temporários (journal de transações, lock, exports
de mediação, runs do pipeline).

As bases são indispensáveis: é com elas que o `maker update` faz a comparação de três vias (base ×
local × upstream) e preserva customizações. Por isso não podem ser simplesmente ignoradas nem
trocadas por hashes. O custo é ruído: num install de referência (integrações Claude + Codex + add-on
`saas`) **feito com o maker 1.0.0** são 127 arquivos gerenciados, 87 bases (~430 KB, medição da issue;
o install 1.0.0 real usado na aceitação migrou 86) e **101 arquivos em `.maker`**; um único
`maker update` pode tocar dezenas de arquivos de base, poluindo o diff de PR do consumidor. No projeto
que originou a issue, são 133 arquivos em `.maker`, 119 deles bases. *(Um install de referência no
formato `"files"` feito com a versão desta feature tem **mais** arquivos em `.maker` — 137 medidos na
entrega — porque `agent add` passou a registrar bases; os números acima referem-se sempre ao install
feito com a 1.0.0.)*

Duas fragilidades foram encontradas na investigação e entram no escopo:

- **Fim de linha**: as bases não têm proteção contra conversão CRLF feita pelo git (ex.: Windows com
  `autocrlf`). O conteúdo convertido deixa de conferir com o hash, e a base passa a ser tratada como
  ausente — o update perde a capacidade de mesclar customizações daquele arquivo.
- **Diagnóstico cego**: o `maker doctor` não detecta base referenciada ausente ou corrompida quando o
  arquivo gerenciado em si está intacto; o problema só aparece no próximo update.

Esta feature (a) documenta a taxonomia de `.maker`, (b) torna **padrão** um formato **compacto** de
armazenamento das bases — um único arquivo texto, determinístico e auditável, que funciona como o
**lockfile do estado do maker**: artefato versionado, único, gerado pela CLI, do qual dependem, no
formato padrão, todos os comandos que leem ou mutam o install (`init` sobre install existente,
`update`, `add`, `remove`, `list`, `agent add`, mediação e `doctor`) —, mantendo o formato por arquivo como opt-out explícito, (c) protege as bases
contra reescrita de fim de linha, (d) separa os temporários do versionamento e (e) torna o `doctor`
capaz de validar as bases em qualquer formato. A semântica de merge (issue #10) **não muda**.

## Clarifications

### Session 2026-09-27

Decisões tomadas pelo humano antes da spec (1–8 e 16) e no Gate 1 (17, que **substitui** a decisão 2
e o default original, 10, que deriva dela, e 20, que absorve o manifest no lockfile), e ambiguidades
residuais resolvidas pelo spec-author com o default mais conservador (9, 11–15, 18, 19, 21 e 22),
refinadas após as revisões do spec-reviewer. As Clarifications 23 e 24 (sessão 2026-09-28) são
decisões do humano na aceitação; a 23 **revisa** as 1, 16 e 20.

1. Q: Qual é a taxonomia de `.maker`? → A: quatro categorias — **estado autoritativo** (manifest,
   estado de add-ons), **snapshots de base**, **arquivos gerenciados** (papéis de workflow; são
   conteúdo instalado, não estado) e **temporários** (transações, lock, mediação, runs). Os runs do
   pipeline são temporários/locais e ficam fora do versionamento recomendado. *(Revisto pela
   Clarification 23: em pack, o manifest, o estado de add-ons e as bases vivem todos no lockfile.)*
2. Q: Um ou dois formatos de bases? → A: dois — **por arquivo** (atual) e **compacto** —, escolhidos
   pelo consumidor por uma chave de config `state.bases` com valores `"files"` | `"pack"`. A escolha
   efetiva fica registrada no manifest. *(O default original, `"files"`, foi substituído no Gate 1 —
   ver Clarification 17.)*
3. Q: Como é o formato compacto? → A: um único arquivo de bases, texto, determinístico (entradas
   ordenadas por hash), cada entrada com hash sha256, tamanho em bytes e codificação (UTF-8 bruto ou
   base64 para conteúdo não UTF-8), **sem compressão**, com versão de formato no cabeçalho.
4. Q: Como proteger as bases no git? → A: um arquivo de atributos git gerenciado pelo maker marca as
   bases, nos dois formatos, como imunes à conversão de fim de linha e como geradas (colapsadas no
   diff de PR).
5. Q: Como se muda de formato? → A: mudando a config e rodando `maker update`, nos dois sentidos,
   numa única transação com rollback; idempotente; se os dois formatos coexistirem, vale a união
   verificada; bases corrompidas não migram e passam a ser reportadas como ausentes; nenhuma
   customização é descartada.
6. Q: O que o `doctor` valida? → A: em qualquer formato, que todo `baseHash` referenciado resolve e
   confere com o hash; reporta formato compacto ilegível, versão de formato desconhecida, entrada
   truncada, bases órfãs e coexistência de formatos — sempre com ação recomendada.
7. Q: E os temporários? → A: um arquivo de ignore do git gerenciado **dentro de `.maker`** exclui
   transações, lock, mediação e runs.
8. Q: Garantias de update? → A: `maker update --dry-run` determinístico (duas execuções = mesmo
   plano) e merge de três vias/mediação com comportamento idêntico nos dois formatos.
9. Q: Onde vivem os arquivos de controle do git gerenciados (ignore e atributos)? → A: **dentro de
   `.maker`**. O maker não cria nem edita arquivos de controle do git na raiz do projeto consumidor.
10. Q: E se a config não declarar `state.bases` (ou não houver arquivo de config, caso de installs
    antigos)? → A: vale o formato registrado no manifest. Quando **nem a config nem o manifest**
    declaram formato (ex.: todo manifest atual com bases por arquivo), vale o default `"pack"` e o
    próximo `maker update` migra. A ausência da chave é distinguível de um `"files"` explícito: um
    `"files"` explícito (na config ou registrado no manifest) **nunca** migra. *(Decisão do humano,
    derivada da 17.)* Só `init` e `update` registram ou alteram o formato no manifest.
11. Q: O que acontece com um arquivo compacto de versão de formato desconhecida (mais nova que a
    suportada)? → A: todo comando que grava/lê bases ou muta o install (`init` sobre install
    existente, `agent add`, `update` — incluindo `--apply-resolutions` —, `add` e `remove`) recusa-se
    a operar e sai com erro **antes** de qualquer escrita; o `doctor` reporta falha com a ação
    "atualize o maker". Nada é sobrescrito nem migrado.
12. Q: Bases órfãs (presentes mas não referenciadas) degradam o install? → A: não — são **aviso**
    no `doctor` (ação: rodar `maker update`). Órfãs são toleradas nos dois formatos até o próximo
    `maker update`, que é o único comando que as poda; `add`/`remove` (add-on) e `agent add` não
    precisam reescrever o armazenamento para podar.
13. Q: Coexistência de formatos degrada o install? → A: depende. **Bases soltas por arquivo junto a
    um lockfile (sem `.maker/manifest.json`)** é **aviso** no `doctor` (ação: rodar `maker update`
    para consolidar no formato configurado); o update consolida pela união verificada.
    `.maker/manifest.json` **junto a** um lockfile é **falha** (Clarification 21, FR-006c, AC-38), e
    o mesmo vale para `.maker/addons/*.json` junto a um lockfile (Clarification 23, FR-033, AC-44).
14. Q: Quais comandos respeitam a escolha? → A: todo comando que grava/lê bases ou muta o install.
    Hoje gravam bases: `init`, `agent add` e `update` (incluindo `update --apply-resolutions`, da
    mediação); `add`/`remove` (add-on) não gravam bases, mas mutam o manifest e o estado de add-ons
    (ambos no lockfile, em pack — Clarification 23) e leem bases. Só `init`
    e `update` aplicam o formato efetivo (e portanto migram); os demais operam no formato em uso no
    install (Clarification 18). Um `init` sem `state.bases` já nasce no formato compacto e
    `agent add`/`--apply-resolutions` num install compacto gravam só no arquivo compacto. Um `init`
    sobre install existente ainda não migrado segue as mesmas regras de migração do `update`
    (transação única com rollback, relatório de bases migradas/descartadas, aviso de opt-out).
15. Q: A base corrompida encontrada na migração aborta a migração? → A: não. A migração segue com as
    demais bases; a corrompida é descartada e passa a contar como base ausente, com o mesmo
    tratamento que o update já dá hoje a base ausente (arquivo preservado, mediação quando cabe). O
    relatório do update lista cada base descartada.
16. Q: Qual o alvo de arquivos versionados em `.maker`? → A: **≤ 15** (decisão do humano, revista no
    Gate 1 pela Clarification 20 — de ≤ 17 para ≤ 16 — e na aceitação pela Clarification 23 — de
    ≤ 16 para ≤ 15). No install de referência em pack sobram 1 lockfile do estado (manifest + estado
    de add-ons + bases) + 12 papéis de workflow = **13 arquivos de estado/conteúdo**, mais os **2
    arquivos de controle do git** gerenciados (ignore e atributos) exigidos pelas decisões 4 e 7 =
    **15**. Com o default `"pack"` (Clarification 17), o alvo vale para o install de referência sem
    opt-in.
17. Q: Qual é o default de `state.bases`? → A: **`"pack"`** — **decisão do humano no Gate 1**, que
    substitui o default `"files"` da decisão 2: "o padrão deve ser o pack para funcionar com os
    lockfiles e não o inverso". `"files"` passa a ser o opt-out explícito para quem prefere bases
    legíveis por arquivo. Installs novos nascem em pack; installs existentes sem formato declarado
    migram para pack no próximo `maker update`, pela mesma migração transacional, idempotente e
    reversível. É uma **mudança de comportamento visível** para consumidores existentes e MUST
    constar no CHANGELOG/release notes da versão que a entregar.
18. Q: E `add`, `remove` e `agent add` num install ainda não migrado (sem formato declarado, bases por
    arquivo em disco)? → A: operam no **formato em uso** — o registrado no manifest ou, sem registro,
    o formato por arquivo presente em disco — e **não migram**; `agent add` grava bases novas nesse
    formato. Esses comandos **preservam o campo de formato do manifest exatamente como o
    encontraram** (ausente continua ausente): gravar `"files"` cancelaria o default para sempre, e
    gravar `"pack"` sem migrar deixaria o manifest divergente do disco. Só `init` e `update` aplicam
    o formato efetivo, migram e registram/alteram o formato. Assim, comandos pontuais nunca
    reescrevem o armazenamento inteiro como efeito colateral, e o `update` seguinte ainda migra.
19. Q: E se o time tiver versões misturadas do maker (alguém/CI com versão antiga rodando num install
    já em pack)? → A: uma versão que não entende o formato compacto MUST NOT degradar silenciosamente
    o install (tratar bases como ausentes, regravar bases por arquivo, perder o campo de formato).
    Isso é garantido pelas Clarifications 20 e 23 (install em pack não tem `.maker/manifest.json` nem
    `.maker/addons/`, e cada comando mutante da 1.0.0 aborta sem o que lê primeiro). O CHANGELOG instrui atualizar o maker em todo o time/CI antes de migrar.
    **Install ainda não migrado** (usado por FR-025/AC-17) = formato efetivo `"pack"` (FR-005),
    nenhum formato registrado no manifest e bases por arquivo em disco; config com `"files"`
    explícito e manifest sem formato **não** é "vai migrar".
20. Q: Onde fica o manifest num install em pack? → A: **decisão do humano no Gate 1**: dentro do
    **lockfile do estado do maker**. Num install em pack, o arquivo compacto contém o manifest
    (metadados + entradas de arquivos) e as bases; **não existem** `.maker/manifest.json` nem
    `.maker/bases/`. O lockfile é um **arquivo único** (manifest e bases no mesmo arquivo — decisão
    do humano, consistente com SC-001), com cabeçalho, seção de manifest legível e seção de
    bases — e, pela Clarification 23, seção de add-ons; o estado inteiro é portátil e auditável. O formato `"files"`
    continua com `.maker/manifest.json` + `.maker/bases/` (compatível com a 1.0.0). A migração
    files → pack remove `.maker/manifest.json`, `.maker/bases/` e — pela Clarification 23 —
    `.maker/addons/` na mesma transação; pack → files os recria; o rollback restaura o estado original nos dois sentidos. **Motivo**: a 1.0.0 publicada não
    valida versão de schema, mas seus comandos mutantes `update`, `doctor`, `add`, `agent add` e
    mediação abortam antes de escrever quando `.maker/manifest.json` não existe. *(Correção da
    aceitação: o `remove` da 1.0.0 **não** segue essa regra — ele lê primeiro `.maker/addons/<id>.json`
    e trata o manifest como opcional; a garantia para o `remove` vem da Clarification 23.)* Com as
    duas decisões, um maker antigo num install em pack para sem degradar nada. O lockfile carrega
    versão de formato; versões futuras que não a entendam abortam antes de escrever (FR-012/AC-19).
    **`maker init` da 1.0.0 num install em pack** (correção da aceitação): **sem** `--force`, ele
    **recusa** por colisão **enquanto houver arquivos gerados que diferem** do que ele renderizaria
    (o que vale para o install da versão nova, cujos templates diferem) e, recusando, não grava
    estado algum — não cria um segundo estado nem causa coexistência. **Limitação conhecida**:
    `maker init --force` da 1.x não depende do manifest e reinstala por cima; é ação explícita de
    força, mitigada pela orientação do CHANGELOG (FR-006a).
21. Q: E se `.maker/manifest.json` e o lockfile coexistirem (ex.: merge de branches em formatos
    diferentes)? → A: dois estados autoritativos concorrentes não são consolidados automaticamente:
    todo comando mutante aborta antes de escrever com ação recomendada (escolher um e remover o
    outro, ou restaurar pelo histórico do git) e o `doctor` reporta **falha**. A união verificada
    (FR-015) continua valendo só para bases soltas por arquivo coexistindo com um lockfile (sem
    `.maker/manifest.json`).
22. Q: E se a seção de manifest do lockfile estiver ilegível (malformada, truncada, com marcadores de
    conflito do git)? → A: como o lockfile é o único estado autoritativo, todo comando mutante (`init`
    sobre install existente, `update` incluindo `--apply-resolutions`, `add`, `remove`, `agent add`)
    aborta antes de escrever com ação recomendada (resolver o conflito ou restaurar do histórico do
    git) e **nunca** trata o install como ausente; o `doctor` reporta falha. A união verificada só se
    aplica a entradas de base quando a seção de manifest é legível. Para reduzir conflitos no caso
    comum (duas branches que rodaram `update`), o lockfile é organizado em unidades estáveis e
    ordenadas — entradas de manifest por caminho, uma por unidade; bases por hash — para que o git
    mescle mudanças em entradas diferentes sem conflito textual.

### Session 2026-09-28 (aceitação — achados do pm-validator, decisões do humano)

23. Q: Rodando o maker **1.0.0 publicado** contra um install em pack, `maker remove <id>` não para: o
    `remove` da 1.0.0 identifica o add-on aplicado por `.maker/addons/<id>.json` (que continuava
    existindo em pack) e trata o manifest como opcional — sai 0, apaga o estado do add-on e os
    arquivos criados por ele, remove os blocos injetados e deixa o lockfile desatualizado. Como fechar
    a garantia da Clarification 20? → A: **decisão do humano (opção b)**: no formato **pack**, o
    estado de cada add-on aplicado passa a viver **dentro do lockfile** (uma unidade por add-on, na
    seção de add-ons); num install em pack **não existem** `.maker/addons/` nem
    `.maker/addons/<id>.json`, e o `remove` da 1.0.0 responde "add-on não está aplicado" sem escrever
    nada. No formato **files**, o estado continua em `.maker/addons/<id>.json` (compatível com a
    1.0.0). A migração files → pack move os estados de add-on para o lockfile e remove
    `.maker/addons/` na mesma transação; pack → files os recria; rollback nos dois sentidos.
    Coexistência de `.maker/addons/*.json` com um lockfile é tratada **como a coexistência de
    manifest** (FR-006c/AC-38): comandos mutantes abortam antes de escrever e o `doctor` reporta
    falha. *Justificativa do spec-author para não tratar diferente (ex.: união verificada, como nas
    bases soltas)*: diferentemente de uma base — endereçada pelo próprio conteúdo e verificável pelo
    hash —, o estado de add-on é autoritativo e não verificável por si só; um `.maker/addons/<id>.json`
    ao lado do lockfile pode ser resto de branch em files, versão divergente da unidade do lockfile ou
    add-on que o lockfile não conhece, e escolher qualquer um silenciosamente pode apagar arquivos do
    consumidor no próximo `remove`. Um diretório `.maker/addons/` vazio (sem nenhum `*.json`) não é
    coexistência — o git nem o versiona —: é tolerado sem aviso (`doctor` verde) e removido na
    próxima escrita de estado (migração ou `update`). Todos os comandos que leem/escrevem estado de add-on (`add`,
    `remove`, `list`, verificação de add-ons do `doctor`, mediação/`--apply-resolutions`, `update`) funcionam igual nos dois formatos, e `agent add` — que
    não lê nem grava estado de add-on — se comporta igual nos dois formatos. A seção de add-ons do
    lockfile é determinística, ordenada por id de add-on, uma unidade por add-on (amigável a merge), e
    seção de add-ons ilegível/em conflito segue FR-010a (aborta; nunca "install ausente" nem
    "add-on não aplicado"). Consequências: SC-001 passa a **≤ 15**; a garantia de FR-006b/AC-37 vale
    para **todos** os comandos mutantes da 1.0.0, incluindo `remove`, provada contra a ordem de
    leitura real de cada comando (AC-42); a taxonomia (FR-001) registra que, em pack, o estado de
    add-on é parte do lockfile.
24. Q: (a) Até onde vai a garantia de merge sem conflito da seção de add-ons? (b) O que acontece
    quando um estado de add-on no formato files é inválido e a migração files → pack (inclusive a
    default) precisa movê-lo para o lockfile? → A: **decisões do humano na aprovação da emenda**:
    (a) add-ons distintos aplicados/removidos em branches diferentes mesclam **sem conflito** quando
    suas unidades no lockfile ficam separadas por **ao menos uma unidade inalterada**; unidades
    **novas no mesmo intervalo** (ex.: a base comum não tem nenhum add-on e cada branch aplica um
    diferente) ou **remoções adjacentes** conflitam textualmente — é limitação aceita do merge
    textual do git e segue FR-010a (comandos mutantes abortam com ação recomendada; `doctor` falha),
    nunca resolvida em silêncio. (b) Estado de add-on inválido no formato files — JSON ilegível, fora
    do schema do estado de add-on, ou com chave de campo que a gramática do lockfile não consegue
    representar — **bloqueia** a migração files → pack (inclusive a disparada pelo default): o
    comando aborta antes de qualquer escrita, com mensagem que cita o arquivo, a ação (corrigir o
    arquivo) e o opt-out `state.bases: "files"`; o `doctor` **avisa** quando uma migração pendente
    será bloqueada por isso (FR-035, AC-47). Diferente das bases corrompidas (descartadas na
    migração, FR-016), estado de add-on é autoritativo e não recuperável — descartá-lo faria o
    add-on "sumir" e impediria o `remove`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bases no formato compacto por padrão, como lockfile do estado (Priority: P1)

Por padrão, as bases do maker vivem num único arquivo compacto — o lockfile do estado do maker. Um
install novo já nasce assim. Um consumidor com install existente (bases por arquivo, sem formato
declarado) roda `maker update` como sempre: o plano anuncia a migração para o formato compacto e
explica como mantê-lo por arquivo (`state.bases: "files"`). Numa única transação, todas as bases
válidas passam para o arquivo compacto, as bases por arquivo são removidas, o manifest passa a
registrar o formato compacto e nenhuma customização local é tocada. A partir daí, cada update altera
um único arquivo de bases. Quem declara `"files"` explicitamente não é migrado.

**Why this priority**: É o valor central da issue: redução material de arquivos e de diff sem perder
a capacidade de reconciliação. Sozinha, entrega o ganho mensurável.

**Independent Test**: Instalar o maker em diretório temporário com Claude + Codex + add-on `saas` no
formato por arquivo atual (sem `state.bases`), customizar alguns arquivos gerenciados, rodar
`maker update` com a versão nova e conferir
contagem de arquivos em `.maker`, integridade das bases e preservação das customizações.

**Acceptance Scenarios**:

1. **AC-01** — **Given** um install com bases por arquivo e `state.bases: "pack"` explícito na config, **When**
   `maker update` é executado, **Then** existe o lockfile do estado, não existem mais
   `.maker/manifest.json`, `.maker/bases/` nem `.maker/addons/`, o manifest (dentro do lockfile) registra o formato compacto e cada `baseHash` referenciado
   resolve para uma entrada cujo conteúdo confere com o hash.
2. **AC-02** — **Given** o mesmo install com arquivos gerenciados customizados, **When** a migração é
   aplicada, **Then** o conteúdo de todos os arquivos gerenciados fica byte a byte idêntico ao de
   antes da migração.
3. **AC-03** — **Given** um install já migrado para o compacto, **When** `maker update` é executado
   de novo sem mudança upstream nem de config, **Then** nenhum arquivo é alterado (idempotência).
4. **AC-04** — **Given** o mesmo estado lógico (manifest e conjunto de bases), **When** o lockfile é
   gerado em máquinas ou sistemas operacionais diferentes, **Then** o conteúdo é byte a byte idêntico
   nas duas seções (entradas de manifest ordenadas por caminho, bases ordenadas por hash, fim de linha
   fixo).
5. **AC-05** — **Given** o lockfile, **When** inspecionado num editor de texto, **Then** ele exibe um
   cabeçalho com a versão de formato, uma seção de manifest legível (metadados e uma entrada por
   arquivo gerenciado) e uma seção de bases com, por entrada, hash sha256, tamanho em bytes,
   codificação e conteúdo, sem compressão; bases UTF-8 aparecem como texto legível e bases não UTF-8
   aparecem em base64.
6. **AC-06** — **Given** um install novo e uma config **sem** `state.bases`, **When** `maker init`
   roda, **Then** as bases já são gravadas no formato compacto, nenhuma base por arquivo é criada e o
   manifest registra `"pack"`.
7. **AC-07** — **Given** um install compacto com uma nova versão upstream que altera N arquivos
   gerenciados, **When** `maker update` é aplicado, **Then** dentro do armazenamento de bases apenas o
   arquivo compacto é modificado (nenhum arquivo de base é criado ou removido individualmente).
8. **AC-30** — **Given** um install compacto, **When** `maker agent add` instala uma nova integração
   e, em outro cenário, `maker update --apply-resolutions` aplica resoluções de mediação, **Then** as
   bases novas aparecem apenas no arquivo compacto e nenhuma base por arquivo é criada no
   armazenamento por arquivo.
9. **AC-31** — **Given** um install existente em formato por arquivo, com arquivos gerenciados
   customizados e **sem** `state.bases` declarado na config nem formato registrado no manifest,
   **When** `maker update` é aplicado com uma versão upstream nova, **Then** as bases migram para o
   arquivo compacto (como em AC-01), as customizações são preservadas e mescladas com o upstream
   exatamente como seriam no formato por arquivo, o manifest registra `"pack"`, e a saída informa a
   migração e como voltar (`state.bases: "files"`).
10. **AC-32** — **Given** um install existente em formato por arquivo com `state.bases: "files"`
    explícito na config (ou `"files"` registrado no manifest), **When** `maker update` roda, **Then**
    nenhuma migração acontece e nenhum arquivo compacto é criado.
11. **AC-33** — **Given** um install existente ainda não migrado (bases por arquivo, sem formato
    declarado), **When** `maker agent add`, `maker add` ou `maker remove` roda, **Then** nenhuma
    migração acontece, nenhum arquivo compacto é criado, bases novas (de `agent add`) são gravadas
    no formato por arquivo, o manifest **continua sem formato registrado**, e um `maker update`
    posterior ainda migra para pack (como em AC-31).
12. **AC-34** — **Given** um install existente ainda não migrado, **When** `maker init` é executado
    sobre ele, **Then** a migração para pack segue as mesmas regras do `update` (transação única com
    rollback, relatório de bases migradas/descartadas, aviso de opt-out) e o manifest registra
    `"pack"`.
13. **AC-36** — **Given** um install em pack (novo via `init` ou migrado via `update`), **When** o
    conteúdo de `.maker` é listado, **Then** não existe `.maker/manifest.json`, `.maker/bases/` nem
    `.maker/addons/`, e o `doctor` sai verde lendo o estado (manifest, add-ons e bases) apenas do
    lockfile. **Given** um install em pack com um diretório `.maker/addons/` vazio no disco, **When**
    `maker doctor` roda, **Then** sai verde sem aviso; **When** o próximo `maker update` roda,
    **Then** o diretório vazio é removido.
14. **AC-37** — **Given** um install em pack (com o add-on `saas` aplicado) e um leitor de estado que
    implementa o contrato de leitura da 1.0.0 **na ordem real de cada comando** — `update`,
    `agent add`, mediação e `doctor` identificam o install por `.maker/manifest.json`; `add` consulta
    primeiro `.maker/addons/<id>.json` apenas para registrar em log "já aplicado — reaplicando" (sem
    decidir nada) e em seguida a aplicação lê `.maker/manifest.json` e aborta sem ele; `remove`
    identifica o add-on aplicado por `.maker/addons/<id>.json` **antes** de consultar o manifest,
    que trata como opcional —, **When** todos os comandos mutantes da 1.0.0 — incluindo `add` e
    `remove` — e o `doctor` são simulados contra esse contrato, **Then** cada um para no primeiro
    teste de existência que decide o fluxo ("nenhum install" ou "add-on não está aplicado") e nenhum
    arquivo é escrito. O teste verifica o contrato de leitura, não o binário antigo (o caso do
    `remove` é detalhado em AC-42).
15. **AC-38** — **Given** `.maker/manifest.json` e o lockfile presentes ao mesmo tempo, **When**
    qualquer comando mutante roda, **Then** ele aborta antes de qualquer escrita com ação recomendada;
    **When** `maker doctor` roda, **Then** reporta falha.
16. **AC-39** — **Given** um lockfile cuja seção de manifest **ou de add-ons** está malformada,
    truncada ou contém marcadores de conflito do git, **When** qualquer comando mutante roda (`init`
    sobre o install existente, `update` incluindo `--apply-resolutions`, `add`, `remove`,
    `agent add`), **Then** ele aborta antes de qualquer escrita com ação recomendada (resolver o
    conflito ou restaurar do histórico do git) e nunca trata o install como ausente nem o add-on como
    não aplicado (não reinstala, não cria `.maker/manifest.json` nem `.maker/addons/`); **When**
    `maker doctor` e `maker list` rodam, **Then** o `doctor` reporta falha e o `list` sai com erro e
    ação recomendada em vez de listar add-ons aplicados como disponíveis.
17. **AC-40** — **Given** um install em pack e duas branches que, a partir do mesmo commit, rodaram
    `maker update` alterando entradas de arquivos gerenciados distintos, **When** o git mescla as
    branches, **Then** o lockfile é mesclado sem conflito textual e o resultado é válido para o
    `doctor` (verde). O teste depende do binário git e faz **skip explícito** (com motivo) quando git
    não está disponível.
18. **AC-41** — **Given** um install novo via `maker init` com Claude + Codex e config sem
    `state.bases`, **When** `maker add saas` é aplicado, **Then** o estado do add-on aparece como
    unidade da seção de add-ons do lockfile, **não** existe `.maker/addons/` nem
    `.maker/addons/saas.json`, `maker list` mostra `saas` como aplicado e `maker doctor` (incluindo a
    verificação de add-ons) sai verde; **When** `maker remove saas` roda em seguida, **Then** o
    add-on é removido como no formato por arquivo (blocos injetados retirados, arquivos criados
    intactos apagados, editados preservados) e a unidade some do lockfile.
19. **AC-42** — **Given** um install em pack com o add-on `saas` aplicado e um simulador do `remove`
    da 1.0.0 que reproduz a ordem de leitura real daquela versão (teste de existência de
    `.maker/addons/<id>.json` **antes** de qualquer leitura do manifest, manifest tratado como
    opcional — derivada do código da tag `v1.0.0`), **When** `remove saas` é simulado, **Then** o
    simulador conclui "add-on não está aplicado" e aborta, e nenhum arquivo do install é criado,
    alterado ou removido (conteúdo de `.maker` e dos arquivos gerenciados byte a byte idêntico). O
    mesmo teste, rodado contra um install em pack que **ainda** tivesse `.maker/addons/saas.json`
    (fixture de controle), MUST mostrar que o simulador prosseguiria — provando que o teste detecta a
    regressão observada na aceitação.
20. **AC-43** — **Given** um install em formato por arquivo com o add-on `saas` aplicado (estado em
    `.maker/addons/saas.json`), **When** `maker update` migra para pack, **Then** o estado do add-on
    passa a ser unidade do lockfile com os mesmos campos e valores, `.maker/addons/` deixa de existir
    e `maker list`/`maker doctor` o reconhecem como aplicado; **When** a config passa a
    `state.bases: "files"` e `maker update` roda, **Then** `.maker/addons/saas.json` é recriado com
    os mesmos campos e valores do original, legível pelo contrato de leitura da 1.0.0, e a unidade
    sai do lockfile (que deixa de existir); **When** uma falha é injetada em cada um dos dois
    sentidos, **Then** o rollback restaura exatamente o estado anterior, inclusive o estado de
    add-on.
21. **AC-44** — **Given** um lockfile e ao menos um `.maker/addons/*.json` presentes ao mesmo tempo
    (com ou sem unidade correspondente no lockfile), **When** qualquer comando mutante roda (`init`
    sobre o install existente, `update` incluindo `--apply-resolutions`, `add`, `remove`,
    `agent add`), **Then** ele aborta antes de qualquer escrita com ação recomendada (escolher um
    estado e remover o outro, ou restaurar do histórico do git); **When** `maker doctor` roda,
    **Then** reporta falha. **Given** um diretório `.maker/addons/` vazio junto ao lockfile, **Then**
    não há coexistência: nenhum comando aborta por isso, o `doctor` sai verde sem aviso e o diretório
    é removido na próxima escrita de estado (migração ou `update`), como em AC-36. **Given** um
    diretório sem install (sem manifest nem lockfile) com um `.maker/addons/*.json` órfão, **When**
    `maker init` roda, **Then** aborta antes de escrever reportando coexistência com ação recomendada
    e nenhum lockfile é criado (FR-033).
22. **AC-45** — **Given** um install em pack e duas branches que, a partir do mesmo commit, aplicaram
    (ou removeram) add-ons **distintos** cujas unidades no lockfile ficam separadas por ao menos uma
    unidade inalterada, alterando apenas as unidades desses add-ons e entradas de manifest distintas,
    **When** o git mescla as branches, **Then** a seção de add-ons do lockfile é mesclada sem conflito
    textual e o resultado é válido para o `doctor` (verde). **Given** duas branches que inserem
    unidades novas no mesmo intervalo (ex.: base comum sem nenhum add-on e cada branch aplicando um
    diferente) ou removem unidades adjacentes, **When** o git mescla e o conflito textual resultante
    é commitado sem resolução, **Then** todo comando mutante aborta antes de escrever com ação
    recomendada e o `doctor` reporta falha (FR-010a, Clarification 24). **Given** o mesmo
    estado lógico, **When** o lockfile é gerado em máquinas diferentes, **Then** a seção de add-ons é
    byte a byte idêntica (unidades ordenadas por id). O teste de merge depende do binário git e faz
    **skip explícito** (com motivo) quando git não está disponível. *Nota para o plano*: o catálogo
    real só tem o add-on `saas`; o teste usa add-ons **sintéticos de fixture** com alvos de injeção e
    arquivos criados disjuntos (e, no cenário sem conflito, um add-on inalterado cuja unidade separa
    as dos add-ons alterados).
23. **AC-46** — **Given** dois installs equivalentes com o add-on `saas` aplicado, um por arquivo e
    outro em pack, **When** a mesma sequência roda em ambos — `maker list`, `maker agent add` de uma
    nova integração, `maker update` com upstream novo (incluindo
    reaplicação do add-on e, num cenário com conflito, `--apply-resolutions`), `maker doctor` e
    `maker remove saas` —, **Then** os arquivos gerenciados resultantes, as saídas relevantes ao
    usuário (status do add-on, alvos com bloco, arquivos apagados/preservados) e os códigos de saída
    são idênticos, e o estado de add-on é o mesmo campo a campo (diferindo só onde é armazenado;
    `agent add` não altera o estado de add-on em nenhum dos formatos).
24. **AC-47** — **Given** um install em formato files que migraria para pack (por config `"pack"` ou
    pelo default) e um `.maker/addons/<id>.json` inválido — em três cenários: JSON ilegível, JSON fora
    do schema do estado de add-on, e chave de campo que a gramática do lockfile não representa —,
    **When** `maker update` (ou `maker init` sobre o install) roda, **Then** ele aborta antes de
    qualquer escrita (nenhum arquivo criado, alterado ou removido; nenhum lockfile criado), com
    mensagem que cita o arquivo inválido, a ação (corrigir o arquivo) e o opt-out
    `state.bases: "files"`; **When** `maker update --dry-run` roda, **Then** o plano reporta a
    migração como bloqueada pelo mesmo motivo; **When** `maker doctor` roda, **Then** emite **aviso**
    de que a migração pendente será bloqueada por esse arquivo, com a mesma ação. **Given** o mesmo
    arquivo inválido e `state.bases: "files"` explícito, **Then** nenhuma migração é tentada e o
    bloqueio não se aplica.

---

### User Story 2 - Reconciliação, dry-run e rollback funcionam igual nos dois formatos (Priority: P1)

Um consumidor em qualquer formato roda `maker update` com upstream novo. O plano do `--dry-run` é
determinístico, o merge de três vias preserva customizações exatamente como hoje, conflitos e
mediação se comportam igual, e uma falha no meio da aplicação restaura o estado anterior — inclusive
durante uma migração de formato.

**Why this priority**: O formato compacto só é aceitável se não degradar a segurança do update. É a
garantia que os critérios de aceite da issue exigem após a migração.

**Independent Test**: Rodar o mesmo cenário de update (sem customização, com customização
mesclável, com conflito, com base ausente) nos dois formatos e comparar planos, códigos de saída e
conteúdos resultantes; injetar falha no meio da aplicação e conferir o rollback.

**Acceptance Scenarios**:

1. **AC-08** — **Given** um install em qualquer formato, **When** `maker update --dry-run` é
   executado duas vezes seguidas, **Then** os dois planos são idênticos e nenhum arquivo é escrito.
2. **AC-09** — **Given** dois installs equivalentes, um por arquivo e outro compacto, com as mesmas
   customizações e o mesmo upstream novo, **When** `maker update` é aplicado em ambos, **Then** os
   arquivos gerenciados resultantes, as entradas de arquivos gerenciados do plano (excluídas as
   entradas de armazenamento de bases e do manifest, que diferem por definição) e o código de saída
   são idênticos (sem customização, customização mesclável, conflito e mediação).
3. **AC-10** — **Given** uma migração de formato em andamento, **When** (a) a aplicação falha em
   processo (erro de escrita), **Then** o rollback imediato do próprio comando restaura exatamente o
   estado anterior; **When** (b) o processo é morto/crasha antes de concluir, **Then** o próximo
   comando que muta o install recupera a transação pelo journal antes de qualquer outra ação e o
   estado volta a ser exatamente o anterior — mesmo formato, mesmas bases, mesmo manifest, mesmos
   arquivos.
4. **AC-11** — **Given** um update em install compacto, **When** a aplicação falha depois de escrever
   parte dos arquivos, **Then** o arquivo compacto, o manifest e os arquivos gerenciados voltam ao
   estado anterior à tentativa.
5. **AC-12** — **Given** um estado que implica migração (mudança de config ou install sem formato
   declarado migrando para o default), **When** `maker update --dry-run` é executado, **Then** o plano
   anuncia a migração de formato de forma destacada (origem → destino, número de bases migradas e
   descartadas) e, quando a migração decorre do default, diz como evitá-la (`state.bases: "files"`),
   sem escrever nada.
6. **AC-13** — **Given** exports de mediação gerados por `maker update --export`, **When** o install
   usa o formato compacto, **Then** os exports continuam separados do estado persistente e não são
   incluídos no arquivo compacto.

---

### User Story 3 - `maker doctor` detecta base ausente ou corrompida em qualquer formato (Priority: P1)

Um consumidor roda `maker doctor` e fica sabendo, antes do próximo update, que uma base referenciada
sumiu, foi corrompida (ex.: conversão CRLF) ou que o arquivo compacto está ilegível — sempre com uma
ação recomendada.

**Why this priority**: Fecha o achado de diagnóstico cego e é critério de aceite explícito da issue;
sem ele, o formato compacto torna-se mais frágil (um arquivo só concentra o risco).

**Independent Test**: Em installs dos dois formatos, apagar/alterar bases e o arquivo compacto
deliberadamente e verificar o relatório do `doctor` e seu código de saída.

**Acceptance Scenarios**:

1. **AC-14** — **Given** um install (qualquer formato) com arquivos gerenciados intactos e uma base
   referenciada ausente, **When** `maker doctor` roda, **Then** ele reporta falha citando o arquivo
   gerenciado afetado e o hash, com ação recomendada, e sai com código de erro.
2. **AC-15** — **Given** uma base referenciada cujo conteúdo não confere com o hash (ex.: fins de
   linha convertidos para CRLF), **When** `maker doctor` roda, **Then** ele reporta a base como
   corrompida, com ação recomendada, e sai com código de erro.
3. **AC-16** — **Given** um arquivo compacto ilegível, com versão de formato desconhecida ou com
   entrada truncada (tamanho declarado diferente do conteúdo), **When** `maker doctor` roda, **Then**
   ele reporta o problema específico com ação recomendada e sai com código de erro.
4. **AC-17** — **Given** bases órfãs (presentes, não referenciadas) ou bases soltas por arquivo junto
   a um lockfile (sem `.maker/manifest.json`), **When** `maker doctor` roda, **Then** ele emite **aviso** com a ação "rode
   `maker update`", sem marcar o install como degradado por isso. **Given** um install ainda não
   migrado (Clarification 19: formato efetivo `"pack"`, nenhum formato no manifest, bases por arquivo
   em disco), **When** `maker doctor` roda,
   **Then** ele informa que o próximo `maker update` migrará para o formato compacto e como evitar
   (`state.bases: "files"`), sem degradar.
5. **AC-35** — **Given** um install com bases por arquivo, manifest sem formato registrado e
   `state.bases: "files"` explícito na config, **When** `maker doctor` roda, **Then** ele **não**
   informa migração pendente; **When** `maker update` roda, **Then** nenhuma migração acontece e o
   manifest passa a registrar `"files"`.
6. **AC-18** — **Given** um install íntegro em qualquer formato, **When** `maker doctor` roda,
   **Then** ele sai verde, incluindo a verificação de add-ons.
7. **AC-19** — **Given** um arquivo compacto com versão de formato desconhecida, **When** qualquer
   comando que grava/lê bases ou muta o install é executado (`init` sobre o install existente,
   `agent add`, `update` incluindo `--apply-resolutions`, `add` e `remove`), **Then** ele sai com erro antes de
   qualquer escrita, com a ação "atualize o maker".

---

### User Story 4 - O git não corrompe bases nem versiona temporários (Priority: P2)

Um consumidor em Windows com conversão automática de fim de linha, ou qualquer consumidor que rode
`git add .maker`, não corrompe as bases e não versiona transações, lock, mediação nem runs.

**Why this priority**: Corrige a fragilidade de CRLF e reduz o ruído que resta após a compactação.
É complementar ao P1 e vale para os dois formatos.

**Independent Test**: Num repositório git com `core.autocrlf=true`, versionar e fazer checkout do
`.maker` e conferir que as bases continuam conferindo com os hashes; conferir que `git status` não
lista temporários de `.maker`.

**Acceptance Scenarios**:

1. **AC-20** — **Given** um install em qualquer formato dentro de um repositório git com
   `core.autocrlf=true`, **When** `.maker` é commitado e o repositório é clonado de novo, **Then**
   todas as bases continuam conferindo com seus hashes e o `doctor` sai verde. O teste depende do
   binário git no ambiente de teste e faz **skip explícito** (com motivo) quando git não está
   disponível.
2. **AC-21** — **Given** um install com transações, lock, exports de mediação e runs presentes em
   `.maker`, **When** o consumidor consulta os arquivos não rastreados do git, **Then** nenhum desses
   temporários aparece como candidato a versionamento.
3. **AC-22** — **Given** um PR do consumidor que altera bases, **When** visualizado numa plataforma
   que honra atributos git de arquivo gerado, **Then** as bases (nos dois formatos) aparecem marcadas
   como geradas.
4. **AC-23** — **Given** um consumidor que editou os arquivos de controle do git gerenciados dentro
   de `.maker`, **When** `maker update` roda, **Then** as edições são tratadas como qualquer
   customização de arquivo gerenciado (preservadas/mescladas, nunca descartadas silenciosamente).

---

### User Story 5 - Voltar ao formato por arquivo e consolidar formatos misturados (Priority: P2)

Um consumidor que adotou o compacto decide voltar para bases legíveis por arquivo, ou tem os dois
formatos presentes (ex.: merge de branches com formatos diferentes). Ele ajusta a config e roda
`maker update`, que migra ou consolida sem perda.

**Why this priority**: Garante reversibilidade (Constitution P4) e cobre o cenário realista de
branches divergentes; sem ele, a migração automática para o default vira caminho sem volta.

**Independent Test**: Migrar para compacto e de volta, comparando as bases com as originais; montar
um install com os dois formatos (conjuntos parcialmente sobrepostos, uma entrada corrompida) e rodar
update.

**Acceptance Scenarios**:

1. **AC-24** — **Given** um install compacto e `state.bases: "files"` na config, **When** `maker
   update` roda, **Then** cada base válida vira um arquivo de base individual com conteúdo byte a byte
   igual, `.maker/manifest.json` é recriado registrando o formato por arquivo e o lockfile é removido.
2. **AC-25** — **Given** um install migrado files → pack → files, **When** comparado ao estado
   original, **Then** o conjunto de bases e seus conteúdos são idênticos.
3. **AC-26** — **Given** um único estado autoritativo legível (sem `.maker/manifest.json` junto ao
   lockfile) e bases nos dois formatos, com conjuntos parcialmente sobrepostos e uma
   entrada que não confere com o hash, **When** `maker update` roda, **Then** o resultado contém a
   união das bases válidas no formato configurado, a entrada corrompida é descartada e listada no
   relatório, e os arquivos que dependiam dela recebem o tratamento de base ausente.
4. **AC-27** — **Given** uma config sem `state.bases` (ou sem arquivo de config) num install cujo
   manifest registra o compacto, **When** `maker update` roda, **Then** o formato compacto é mantido
   e nenhuma migração acontece.

---

### User Story 6 - Taxonomia de `.maker` documentada (Priority: P3)

Um consumidor ou contribuidor consulta a documentação e entende, para cada item de `.maker`, se é
estado autoritativo, snapshot de base, arquivo gerenciado ou temporário — e o que deve ou não ser
versionado, incluindo os trade-offs entre os dois formatos de bases.

**Why this priority**: É critério de aceite da issue e base para decisões do consumidor, mas não
muda comportamento.

**Independent Test**: Revisar a documentação entregue contra a lista de itens de `.maker` existentes
num install de referência.

**Acceptance Scenarios**:

1. **AC-28** — **Given** a documentação da feature, **When** confrontada com todos os itens presentes
   em `.maker` num install de referência (incluindo temporários), **Then** cada item está
   classificado em exatamente uma das quatro categorias, com indicação de versionar ou não — nos dois
   formatos, deixando explícito que em pack o manifest, o estado de add-ons e as bases vivem no
   lockfile e que `.maker/manifest.json`/`.maker/bases/`/`.maker/addons/` não existem; toda contagem
   de arquivos citada na documentação diz a qual install (versão do maker e formato) se refere.
2. **AC-29** — **Given** a documentação, **When** o consumidor procura como escolher e trocar de
   formato, **Then** encontra a chave `state.bases`, o default, os trade-offs (legibilidade por
   arquivo × número de arquivos/ruído de diff) e o procedimento de migração e recuperação; e o
   CHANGELOG/release notes da versão registra a mudança de default para `"pack"` como mudança de
   comportamento visível, com a instrução de opt-out.

---

### Edge Cases

- **Base não UTF-8** (binário ou encoding diferente): gravada em base64 no compacto e recuperada byte
  a byte idêntica; nos dois formatos confere com o hash.
- **Base vazia** (conteúdo de 0 bytes): representável nos dois formatos, com tamanho 0.
- **Conteúdo de base contendo texto que imita o delimitador/cabeçalho do formato compacto**: a leitura
  depende do tamanho declarado, não de busca por delimitador; a entrada é recuperada intacta.
- **Arquivo compacto sem nenhuma entrada** (install sem bases): válido; o `doctor` não reclama.
- **Merge de git no lockfile** (caso comum: duas branches rodaram `update`): com a organização em
  unidades estáveis e ordenadas (FR-009a), mudanças em entradas distintas mesclam sem conflito
  (AC-40). Se ainda assim houver conflito textual:
  - **na seção de manifest** (ou manifest ilegível/truncado): todo comando mutante aborta antes de
    escrever com ação recomendada (resolver o conflito ou restaurar do histórico do git) e o `doctor`
    reporta falha; o install nunca é tratado como ausente (FR-010a, AC-39);
  - **só em entradas de base, com manifest legível**: as entradas afetadas não conferem e são
    tratadas como ausentes; o `doctor` reporta com ação recomendada e o `update` recupera as bases
    válidas pela união verificada.
- **Base referenciada ausente em qualquer formato durante update**: comportamento atual preservado
  (arquivo preservado, mediação quando cabe); a feature não muda essa semântica.
- **Consumidor cujo `.gitignore` da raiz já ignora `.maker` inteiro**: fora do escopo; o maker não
  edita arquivos de controle da raiz.
- **Transação pendente de versão anterior encontrada no primeiro comando após o upgrade do maker**: a
  recuperação da transação acontece antes de qualquer migração de formato.
- **Versões misturadas do maker no time/CI**: uma versão antiga (1.0.0) rodando num install já em
  pack não encontra o que decide o fluxo de cada comando (ordem detalhada em AC-37) — `.maker/manifest.json` (`update`, `add`,
  `agent add`, mediação, `doctor`) ou `.maker/addons/<id>.json` (`remove`) — e aborta antes de
  escrever (FR-006b, Clarifications 20 e 23); o `list` da 1.0.0 (só leitura) mostra os add-ons como
  não aplicados, sem escrever. O CHANGELOG orienta atualizar o maker em todo o time/CI antes de
  migrar.
- **`maker init` da 1.0.0 num install em pack**: **sem** `--force`, recusa por colisão enquanto
  houver arquivos gerados que diferem da renderização da 1.x (caso do install da versão nova) e,
  recusando, não grava nada — não cria segundo estado nem coexistência. **Com** `--force`
  (limitação conhecida da 1.x): não depende do manifest e reinstala por cima; é ação explícita de
  força, mitigada pelo CHANGELOG (FR-006a). Se isso acontecer, o resultado é coexistência, tratada
  como abaixo.
- **`.maker/manifest.json` ou `.maker/addons/*.json` coexistindo com o lockfile** (merge de branches
  em formatos diferentes, checkout de branch antiga, `init --force` da 1.x): comandos mutantes abortam
  antes de escrever e o `doctor` reporta falha (Clarifications 21 e 23).
- **`init` num diretório sem install mas com `.maker/addons/*.json` órfão** (ex.: sobra de um install
  apagado à mão): aborta antes de escrever reportando coexistência, com ação recomendada; não cria
  lockfile ao lado (FR-033).
- **Estado de add-on inválido num install files que migraria para pack**: a migração é bloqueada
  (aborto antes de escrever, ação "corrija o arquivo" e opt-out `state.bases: "files"`); o `doctor`
  avisa antes (FR-035, AC-47).
- **Add-on removido em pack cujo estado reaparece por merge** (uma branch removeu o add-on, outra o
  reaplicou com knobs diferentes): as unidades do mesmo id conflitam textualmente; é conflito na
  seção de add-ons e segue FR-010a (aborta, `doctor` falha), nunca resolvido em silêncio.
- **Install com arquivo compacto e config `"pack"` mas bases por arquivo reaparecendo** (ex.: checkout
  de branch antiga): coexistência — aviso no `doctor`, consolidação no próximo update.

## Requirements *(mandatory)*

### Functional Requirements

**Taxonomia e documentação**

- **FR-001**: A documentação MUST classificar cada item de `.maker` em uma de quatro categorias —
  estado autoritativo (manifest — `.maker/manifest.json` no formato por arquivo ou dentro do lockfile
  no formato compacto —, estado de add-ons — `.maker/addons/<id>.json` no formato por arquivo ou
  dentro do lockfile no formato compacto), snapshots de base (bases por arquivo ou dentro do
  lockfile), arquivos gerenciados (papéis
  de workflow) e temporários (transações, lock, mediação, runs) — indicando o que versionar. Toda
  contagem de arquivos citada MUST identificar o install a que se refere (versão do maker e formato).
- **FR-002**: A documentação MUST descrever os dois formatos de bases, o default, os trade-offs, a
  chave de config e os procedimentos de migração, diagnóstico e recuperação. Entre os trade-offs MUST
  constar que marcar o lockfile como gerado colapsa no diff do PR também as mudanças de manifest (não
  só as de bases), e como expandi-las para revisão.

**Escolha de formato**

- **FR-003**: O consumidor MUST poder escolher o formato de armazenamento das bases pela chave de
  config `state.bases`, com valores `"files"` (uma base por arquivo) ou `"pack"` (arquivo compacto
  único). Valor fora desses MUST ser rejeitado na validação da config com mensagem clara.
- **FR-004**: O default MUST ser `"pack"`. O formato por arquivo é opt-out explícito
  (`state.bases: "files"`).
- **FR-005**: O formato efetivo MUST ficar registrado no manifest e é resolvido nesta ordem: valor de
  `state.bases` na config; senão, formato registrado no manifest; senão, `"pack"`. A ausência da chave
  na config (ou de arquivo de config) MUST ser distinguível de um `"files"` explícito; um `"files"`
  explícito (na config ou registrado no manifest) MUST NOT disparar migração. Somente `init` e
  `update` MUST registrar ou alterar o formato no manifest; os demais comandos MUST preservar o campo
  exatamente como o encontraram (ausente continua ausente).
- **FR-006**: Todo comando que grava/lê bases ou muta o install — `init`, `agent add`, `update`
  (incluindo `update --apply-resolutions`), `add` e `remove` — MUST ler bases em qualquer formato
  presente. `init` e `update` MUST gravar bases somente no formato efetivo. `agent add`, `add` e
  `remove` MUST operar no formato em uso (registrado no manifest ou, sem registro, o presente em
  disco), MUST NOT migrar, MUST NOT registrar nem alterar o formato no manifest e, quando gravam
  bases, MUST gravá-las somente nesse formato. Um `init` sobre install existente que implique
  migração MUST seguir FR-013 a FR-019 como o `update`.
- **FR-006a**: A mudança de default (installs existentes sem formato declarado passam a migrar para
  `"pack"` no próximo update) MUST constar no CHANGELOG/release notes como mudança de comportamento
  visível, com a instrução de opt-out e a orientação "atualize o maker em todo o time/CI antes de
  migrar". A documentação de migração MUST descrever corretamente o comportamento das versões 1.x
  num install em pack, de forma condicional: `maker init` **sem** `--force` recusa por colisão
  **enquanto houver arquivos gerados que diferem** do que a 1.x renderizaria (caso do install
  produzido pela versão nova, cujos templates diferem) e, recusando, não grava estado; `maker init
  --force` reinstala por cima (limitação conhecida, ação explícita de força) e o resultado é
  coexistência (FR-006c/FR-033); os demais comandos mutantes param sem escrever (FR-006b).
- **FR-006b**: Num install em formato compacto, `.maker/manifest.json` e `.maker/bases/` MUST NOT
  existir e `.maker/addons/` MUST NOT conter nenhum `*.json` (o maker nunca o cria em pack; um
  diretório `.maker/addons/` vazio que reste no disco é tolerado — não é coexistência, o `doctor`
  segue verde sem aviso — e MUST ser removido na próxima escrita de estado: migração ou `update`); o
  manifest (metadados + entradas de arquivos) e o estado de cada add-on aplicado MUST viver no
  lockfile do estado junto com as bases, de forma portátil e auditável.
  Com isso, **todo** comando mutante da 1.0.0 — `update`, `add`, `remove`, `agent add`, mediação — e
  o `doctor`, cada um seguindo a sua ordem de leitura real (`update`, `agent add`, mediação e
  `doctor` leem `.maker/manifest.json` primeiro; `add` consulta `.maker/addons/<id>.json` só para
  log e aborta ao ler o manifest; `remove` testa `.maker/addons/<id>.json` primeiro e trata o
  manifest como opcional — AC-37), MUST parar no primeiro teste de existência ("nenhum install" / "add-on não está
  aplicado") e não escrever nada (AC-37, AC-42). O formato `"files"` MUST continuar usando
  `.maker/manifest.json` + `.maker/bases/` + `.maker/addons/<id>.json`, compatível com a 1.0.0.
- **FR-006c**: A migração files → pack MUST remover `.maker/manifest.json`, `.maker/bases/` e
  `.maker/addons/` na mesma transação; pack → files MUST recriá-los; o rollback MUST restaurar o
  estado original nos dois sentidos. Se `.maker/manifest.json` e o lockfile coexistirem, todo comando
  mutante MUST abortar antes de escrever com ação recomendada e o `doctor` MUST reportar falha (a
  coexistência de estado de add-on segue FR-033).

**Formato compacto**

- **FR-007**: O formato compacto (lockfile) MUST ser um único arquivo, texto, sem compressão,
  composto de cabeçalho com a versão de formato, seção de manifest legível (metadados e uma entrada
  por arquivo gerenciado), seção de add-ons legível (uma entrada por add-on aplicado, com o mesmo
  conteúdo lógico do estado de add-on do formato por arquivo; vazia quando não há add-on) e seção de
  bases.
- **FR-008**: Cada entrada da seção de bases MUST declarar hash sha256, tamanho em bytes e codificação (`utf8` para
  conteúdo UTF-8 válido, gravado bruto; `base64` para o restante), seguida do conteúdo.
- **FR-009**: As entradas de manifest MUST estar ordenadas por caminho, as de add-on por id e as
  bases por hash, e a serialização MUST ser determinística nas três seções: o mesmo estado lógico
  (manifest, estados de add-on e conjunto de bases) produz o mesmo arquivo byte a byte em qualquer
  máquina/SO.
- **FR-009a**: O lockfile MUST ser amigável a merge: organizado em unidades estáveis e ordenadas
  (uma entrada de manifest por caminho por unidade; um estado de add-on por id por unidade; uma base
  por hash por unidade), de modo que mudanças em entradas diferentes, feitas em branches distintas,
  sejam mescladas pelo git sem conflito textual **quando as unidades alteradas ficam separadas por
  ao menos uma unidade inalterada** (Clarification 24). Unidades novas inseridas no mesmo intervalo
  (ex.: base comum sem nenhum add-on e cada branch aplicando um diferente) ou remoções de unidades
  adjacentes podem conflitar textualmente; esse conflito MUST seguir FR-010a (aborto com ação
  recomendada; `doctor` falha), nunca ser resolvido em silêncio.
- **FR-010a**: Se a seção de manifest **ou a de add-ons** do lockfile estiver ilegível, malformada,
  truncada ou com marcadores de conflito do git, todo comando mutante (`init` sobre install
  existente, `update` incluindo `--apply-resolutions`, `add`, `remove`, `agent add`) MUST abortar
  antes de escrever com ação recomendada (resolver o conflito ou restaurar do histórico do git) e MUST
  NOT tratar o install como ausente nem um add-on como não aplicado; o `doctor` MUST reportar falha e
  o `list` MUST sair com erro e ação recomendada. A união verificada (FR-015) MUST se aplicar a
  entradas de base somente quando as seções de manifest e de add-ons são legíveis.
- **FR-010**: A leitura de cada entrada MUST recuperar o conteúdo original byte a byte e verificá-lo
  contra o hash declarado; entradas que não conferem, truncadas ou malformadas MUST ser tratadas como
  base ausente, nunca usadas como base de merge.
- **FR-011**: Após cada `maker update`, o armazenamento de bases (em qualquer formato) MUST conter
  apenas bases referenciadas pelo manifest. Bases órfãs MUST ser toleradas nos dois formatos até o
  próximo `update`, único comando que as poda; `add`, `remove` e `agent add` MUST NOT ser obrigados a
  reescrever o armazenamento para podar. Exports de mediação e demais temporários MUST NOT ser
  incluídos no arquivo compacto.
- **FR-012**: Um arquivo compacto com versão de formato desconhecida MUST fazer todo comando que
  grava/lê bases ou muta o install (`init` sobre install existente, `agent add`, `update` incluindo
  `--apply-resolutions`, `add` e `remove`) abortar com erro e ação recomendada **antes** de qualquer
  escrita.

**Migração**

- **FR-013**: Quando o formato efetivo (FR-005, incluindo o default) difere do formato presente, `maker update` MUST migrar as
  bases para o formato configurado, nos dois sentidos, na mesma transação do update (com journal e
  rollback).
- **FR-014**: A migração MUST ser idempotente: repetir o update sem mudanças não altera nenhum
  arquivo.
- **FR-015**: Se bases dos dois formatos coexistirem (bases soltas por arquivo junto a um único
  estado autoritativo; a coexistência de `.maker/manifest.json` ou de `.maker/addons/*.json` com o
  lockfile segue FR-006c/FR-033), o update MUST consolidar a **união verificada** das
  bases no formato configurado e remover o outro formato.
- **FR-016**: Bases que não conferem com o hash MUST NOT migrar; MUST passar a ser tratadas como
  ausentes e MUST ser listadas no relatório do update.
- **FR-017**: A migração MUST NOT alterar o conteúdo de nenhum arquivo gerenciado nem descartar
  customização local.
- **FR-018**: `maker update --dry-run` MUST anunciar de forma destacada a migração planejada (formato
  de origem, destino e quantidade de bases migradas e descartadas) sem escrever nada; a saída do
  `update` (dry-run e aplicado) MUST informar, quando a migração decorre do default, como mantê-lo
  por arquivo (`state.bases: "files"`).
- **FR-019**: Uma transação pendente de execução anterior MUST ser recuperada antes de qualquer
  migração de formato.

**Update, reconciliação e rollback**

- **FR-020**: `maker update --dry-run` MUST ser determinístico em ambos os formatos: duas execuções
  sobre o mesmo estado produzem o mesmo plano.
- **FR-021**: Merge de três vias, detecção de conflito, mediação, export de mediação, códigos de
  saída e as entradas de arquivos gerenciados do plano MUST ter resultado idêntico nos dois formatos
  para o mesmo estado lógico (as entradas de armazenamento de bases e do manifest diferem por
  definição e ficam fora da comparação). A semântica de
  merge MUST NOT mudar (escopo da issue #10).
- **FR-022**: Em falha ou interrupção de qualquer comando mutante (com ou sem migração), MUST ser
  restaurado o estado anterior de bases (em qualquer formato), manifest, estado de add-ons e arquivos
  gerenciados.

**Diagnóstico**

- **FR-023**: `maker doctor` (inclusive a verificação de add-ons) MUST verificar, em qualquer
  formato, que todo `baseHash` referenciado pelos arquivos do manifest resolve para uma base existente cujo conteúdo confere com o
  hash — inclusive quando o arquivo gerenciado está intacto.
- **FR-024**: `maker doctor` MUST reportar como **falha** (install degradado, código de saída de erro):
  base referenciada ausente, base corrompida, arquivo compacto ilegível, versão de formato
  desconhecida e entrada truncada/malformada.
- **FR-025**: `maker doctor` MUST reportar como **aviso** (sem degradar): bases órfãs e bases soltas
  por arquivo junto a um lockfile (sem `.maker/manifest.json`); `.maker/manifest.json` junto a um
  lockfile é **falha** (FR-006c). Um install ainda não migrado (formato efetivo `"pack"` por FR-005, nenhum formato
  registrado no manifest e bases por arquivo em disco) MUST ser reportado como informação
  (sem degradar), dizendo que o próximo `maker update` migrará para o formato compacto e como evitar.
- **FR-026**: Todo achado do `doctor` sobre bases MUST trazer ação recomendada concreta (ex.: rodar
  `maker update`, atualizar o maker, restaurar o arquivo do histórico do git) e identificar o hash e,
  quando houver, o arquivo gerenciado afetado.

**Proteção no git**

- **FR-027**: O maker MUST gerenciar, dentro de `.maker`, um arquivo de atributos git que (a) impede
  conversão de fim de linha nas bases, nos dois formatos, e (b) as marca como geradas.
- **FR-028**: O maker MUST gerenciar, dentro de `.maker`, um arquivo de ignore do git que exclui
  transações, lock, exports de mediação e runs.
- **FR-029**: Os dois arquivos de controle do git MUST ser arquivos gerenciados comuns: rastreados no
  manifest, criados por `init`/`update` em installs existentes, com customização local preservada
  pelo mesmo mecanismo de merge dos demais arquivos.
- **FR-030**: O maker MUST NOT criar nem modificar arquivos de controle do git fora de `.maker`.

**Estado de add-ons (Clarification 23)**

- **FR-031**: No formato compacto, o estado de cada add-on aplicado MUST viver no lockfile, como uma
  unidade por add-on na seção de add-ons, com o mesmo conteúdo lógico (mesmos campos e valores) do
  estado de add-on do formato por arquivo; `.maker/addons/` MUST NOT existir num install em pack
  (FR-006b). No formato por arquivo, o estado MUST continuar em `.maker/addons/<id>.json`, legível
  pelo contrato da 1.0.0.
- **FR-032**: A migração files → pack MUST mover todos os estados de add-on para o lockfile e remover
  `.maker/addons/` na mesma transação da migração das bases e do manifest; pack → files MUST
  recriar `.maker/addons/<id>.json` com os mesmos campos e valores e retirar a seção do lockfile
  junto com ele; o rollback MUST restaurar o estado de add-on original nos dois sentidos; repetir a
  migração sem mudanças MUST NOT alterar nenhum arquivo (FR-014). Um `init` sobre install existente
  que migre segue a mesma regra.
- **FR-033**: Se ao menos um `.maker/addons/*.json` coexistir com um lockfile (com ou sem unidade
  correspondente no lockfile), todo comando mutante (`init` sobre install existente, `update`
  incluindo `--apply-resolutions`, `add`, `remove`, `agent add`) MUST abortar antes de escrever com
  ação recomendada (escolher um estado e remover o outro, ou restaurar do histórico do git) e o
  `doctor` MUST reportar falha — mesmo tratamento de FR-006c, sem união automática (motivo na
  Clarification 23). Um diretório `.maker/addons/` sem nenhum `*.json` MUST NOT ser tratado como
  coexistência: é tolerado (o `doctor` segue verde, sem aviso) e removido na próxima escrita de
  estado — migração ou `update` (FR-006b). Um `init` num diretório **sem install** (sem manifest nem
  lockfile) que contenha ao menos um `.maker/addons/*.json` órfão MUST abortar antes de escrever,
  reportando coexistência com a mesma ação recomendada, e MUST NOT criar um lockfile ao lado.
- **FR-034**: Todos os comandos que leem ou escrevem estado de add-on — `add`, `remove`, `list`, a
  verificação de add-ons do `doctor`, a mediação (`update --export`/`--apply-resolutions`) e `update`
  (inclusive reaplicação de add-ons) — MUST produzir o mesmo resultado nos dois formatos para o
  mesmo estado lógico (arquivos gerenciados, estado de add-on campo a campo, saídas e códigos de
  saída), diferindo apenas no local de armazenamento do estado. `add` e `remove` MUST gravar o
  estado de add-on no formato em uso (FR-006) e, em pack, MUST reescrever o lockfile numa única
  transação junto com o manifest. `agent add` não lê nem grava estado de add-on; MUST se comportar
  igual nos dois formatos e, em pack, MUST preservar a seção de add-ons do lockfile inalterada.
- **FR-035**: Um `.maker/addons/<id>.json` inválido no formato files — JSON ilegível, fora do schema
  do estado de add-on, ou com chave de campo que a gramática do lockfile não representa — MUST
  bloquear a migração files → pack (inclusive a disparada pelo default e a de `init` sobre install
  existente): o comando MUST abortar antes de qualquer escrita, com mensagem que identifica o
  arquivo, a ação recomendada (corrigir o arquivo) e o opt-out `state.bases: "files"`; o
  `update --dry-run` MUST reportar a migração como bloqueada; o `doctor` MUST emitir **aviso** (sem
  degradar) quando uma migração pendente será bloqueada por isso. Estado de add-on inválido MUST NOT
  ser descartado nem migrado parcialmente (Clarification 24).

### Key Entities

- **Base (snapshot)**: conteúdo exato de uma versão upstream de arquivo gerenciado, identificado pelo
  sha256 do conteúdo. Atributos: hash, tamanho, conteúdo.
- **Armazenamento de bases**: onde as bases vivem; um de dois formatos — *por arquivo* (uma base por
  arquivo, nomeado pelo hash) ou *compacto* (arquivo único com cabeçalho versionado e entradas
  hash/tamanho/codificação/conteúdo ordenadas por hash).
- **Manifest**: estado autoritativo do install (metadados + entradas de arquivos); referencia
  `baseHash` por arquivo gerenciado e passa a registrar o formato efetivo de bases. Vive em
  `.maker/manifest.json` no formato por arquivo e **dentro do lockfile** no formato compacto.
- **Estado de add-on**: estado autoritativo por add-on; não referencia bases (as bases dos alvos de
  injeção são referenciadas pelo manifest). Vive em `.maker/addons/<id>.json` no formato por arquivo
  e **dentro do lockfile** (seção de add-ons, uma unidade por id) no formato compacto.
- **Config `state.bases`**: escolha declarada pelo consumidor (`"files"` | `"pack"`); default
  `"pack"`, ausência distinguível de `"files"` explícito.
- **Lockfile do estado (arquivo compacto)**: artefato versionado, determinístico, com versão de
  formato, gerado pela CLI, que contém o manifest, os estados de add-on e as bases num install em
  pack; todos os comandos dependem dele no formato padrão. Substitui `.maker/manifest.json`,
  `.maker/bases/` e `.maker/addons/`.
- **Arquivos de controle do git gerenciados**: atributos (fim de linha e "gerado" para bases) e ignore
  (temporários), ambos dentro de `.maker`.
- **Temporários**: journal de transações, lock, exports de mediação, runs — fora do versionamento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No install de referência (Claude + Codex + add-on `saas`, config default), **sem nenhum
  opt-in**, o número de arquivos versionados em `.maker` é **≤ 15** após o primeiro `maker update`
  (ou já no `init`) — o lockfile (manifest, estado de add-on e bases), os 12 papéis de workflow e os
  2 arquivos de controle do git gerenciados (Clarifications 16, 20 e 23, decisões do humano). Ponto
  de partida da medição: o mesmo install feito com o maker 1.0.0 tinha 101 arquivos em `.maker`.
- **SC-002**: Um `maker update` que altera N arquivos gerenciados em install compacto modifica
  exatamente **1** arquivo de armazenamento de bases (contra até N no formato por arquivo).
- **SC-003**: Em 100% dos cenários de teste de update (sem customização, com customização mesclável,
  com conflito, com base ausente), os arquivos gerenciados resultantes, os códigos de saída e as
  entradas de arquivos gerenciados do plano são idênticos nos dois formatos.
- **SC-004**: 100% das bases válidas sobrevivem a uma ida e volta files → pack → files com conteúdo
  byte a byte idêntico; 0 customizações perdidas em qualquer migração.
- **SC-005**: 100% dos casos injetados de base ausente, base corrompida (incluindo conversão CRLF),
  arquivo compacto ilegível, versão desconhecida e entrada truncada são detectados pelo `doctor` com
  ação recomendada, em ambos os formatos, sem depender de rodar update.
- **SC-006**: Num repositório com `core.autocrlf=true`, 0 bases deixam de conferir com o hash após
  commit e novo clone.
- **SC-007**: Duas execuções consecutivas de `maker update --dry-run` produzem planos idênticos em
  100% das execuções, nos dois formatos e durante migração.
- **SC-008**: O arquivo compacto é auditável: todas as bases UTF-8 aparecem como texto legível num
  diff comum, e o tamanho total do armazenamento compacto não excede o tamanho somado das bases por
  arquivo acrescido do overhead de cabeçalhos e do base64 das bases não UTF-8.

## Assumptions

- A comparação de três vias, a mediação e o tratamento de base ausente são os já existentes; a
  feature muda apenas **onde e como** as bases são armazenadas e verificadas.
- O número de arquivos importa mais que o tamanho total para o ruído de diff (hipótese da issue); por
  isso o formato compacto não comprime e privilegia auditabilidade.
- O formato compacto não depende de cache local nem de serviço remoto; é portátil entre máquinas e CI
  por ser só um arquivo versionado.
- O projeto consumidor usa git; em projetos sem git, os arquivos de controle do git são inócuos.
- Plataformas de PR que não honram o atributo "gerado" continuam exibindo o diff normalmente; o
  colapso é conveniência, não requisito de correção.
- Os runs do pipeline (`.maker/runs/`) passam a ser tratados como temporários/locais, conforme
  decisão do humano; consumidores que queiram versioná-los podem sobrescrever o ignore gerenciado
  (customização preservada, FR-029).
- A mudança de formato registrada no manifest pode exigir evolução do schema do manifest; installs
  com manifest anterior continuam legíveis, são lidos no formato por arquivo presente em disco e
  migram para `"pack"` no próximo `maker update` (salvo `"files"` explícito na config).
- A mudança de default é comportamento visível e será comunicada no CHANGELOG/release notes pelo
  fluxo de release existente (Release Please).
- O catálogo real de add-ons tem hoje só o `saas`; cenários que exigem dois ou mais add-ons (AC-45)
  usam add-ons sintéticos de fixture, com alvos disjuntos, e não exigem add-ons novos no catálogo.
- Nomes de arquivos, layout interno exato do formato compacto e estratégia de verificação são
  decisões do architect, desde que respeitem FR-007 a FR-012.

## User Journey

Ordenada por dependência:

1. **Consumidor entende `.maker`** → lê a taxonomia e os trade-offs dos formatos (US6).
2. **Proteção de git chega ao install** → `maker update` (ou `init`) cria os arquivos de controle do
   git gerenciados dentro de `.maker`; bases ficam imunes a CRLF e temporários deixam de aparecer no
   git (US4). Vale para os dois formatos.
3. **Diagnóstico confiável** → `maker doctor` passa a validar todas as bases referenciadas e o
   armazenamento em qualquer formato (US3).
4. **Compacto por padrão** → install novo nasce em pack; install existente sem formato declarado vê
   a migração anunciada no `maker update --dry-run` (com a instrução de opt-out `"files"`) e a aplica
   no update, numa transação com rollback (US1).
5. **Operação contínua** → updates seguintes reconciliam customizações igual ao formato por arquivo,
   tocando 1 arquivo de bases; `--dry-run` determinístico; falhas revertidas (US2).
6. **Opt-out/consolidação quando preciso** → consumidor declara `"files"` para voltar às bases por arquivo, ou consolida formatos
   misturados após merge de branches via `maker update` (US5).

## Cobertura da Constitution & Regras do Projeto

- **P4 — Idempotência e reversibilidade (NON-NEGOTIABLE)**: honrado por FR-013 a FR-019 e FR-022 —
  migração transacional com rollback, idempotente (AC-03), reversível nos dois sentidos (AC-24/AC-25),
  sem descartar customização (AC-02) e com `doctor` verde após o ciclo (AC-18); o estado de add-ons
  entra na mesma transação e no mesmo rollback (FR-032, AC-43), e nenhuma versão anterior do maker
  escreve num install em pack (FR-006b, AC-37, AC-42).
- **P1 — Sem shell-out (NON-NEGOTIABLE)**: a proteção de fim de linha e o ignore de temporários são
  entregues como **arquivos** gerenciados (FR-027/FR-028); o maker não invoca o git nem qualquer
  binário externo. A verificação do CRLF (AC-20) é teste de aceite em ambiente com git, não
  comportamento do CLI.
- **P2 — Motor agnóstico de negócio**: a feature só toca estado mecânico do install; nenhuma regra de
  negócio entra no motor. A chave `state.bases` é knob mecânico da config.
- **P3 — `templates/engine/` espelha o layout-alvo**: arquivos de controle do git gerenciados que
  forem instalados no alvo seguem a regra de espelhamento do engine.
- **Bases Técnicas — persistência em arquivos, leitura pura**: o armazenamento continua em arquivos
  do projeto-alvo; leituras (incluindo `doctor` e `--dry-run`) não escrevem (AC-08, AC-12). A
  escrita só ocorre em comando mutante, dentro de transação.
- **PR3 — Organização de testes**: os testes de migração, integridade, base ausente/corrompida,
  update com/sem customização e rollback seguem o layout de testes do projeto (`test/` espelhando
  `src/`).
- **PR6 — Fidelidade de fixtures**: fixtures usam os valores exatos do contrato (`"files"`,
  `"pack"`, codificações `utf8`/`base64`), sem aliases.
- **Não-metas respeitadas**: sem compressão; sem mudança da semântica de merge (#10); bases não são
  substituídas por hashes; estado necessário para atualizar continua versionado; exports de mediação
  ficam fora do estado persistente.
