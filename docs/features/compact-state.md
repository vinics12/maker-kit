# Estado compacto do maker (lockfile único)

> Catálogo as-built — conceitual. Para o contrato detalhado, ver a spec linkada.
> Última atualização: 2026-09-28 · Specs: 003-compact-maker-state · PRs: #43 (fecha a issue #41)

## O que faz / para quem
Reduz o ruído que o maker deixa no versionamento do projeto-alvo. Em vez de um manifest, um arquivo
por add-on aplicado e uma base por arquivo gerenciado, o estado do install passa a viver num único
lockfile versionado e amigável a merge. Serve a quem mantém o projeto (revisa PRs, resolve conflitos
entre branches) e ao time que precisa atualizar o maker sem espalhar dezenas de arquivos de estado.

## Entidades e regras de negócio
- **Estado autoritativo**: os metadados do install e uma entrada por arquivo gerenciado (manifest),
  mais o estado de cada add-on aplicado. É o que decide "há install?" e "este add-on está aplicado?".
- **Bases de reconciliação**: o conteúdo upstream original de cada arquivo gerenciado, endereçado pelo
  seu hash, usado como ancestral comum no merge 3-way do update.
- **Dois formatos, nunca simultâneos.** O padrão é o formato compacto: manifest, estado de add-ons e
  bases vivem num único lockfile, cada um em sua seção. O formato por arquivo (manifest próprio, um
  estado por add-on, uma base por arquivo) continua existindo como opt-out explícito na config do
  projeto. Ter os dois estados presentes ao mesmo tempo é sempre tratado como problema.
- **Resolução do formato**: declaração na config do projeto, senão o formato já registrado no
  install, senão o padrão compacto. Só `init` e `update` alteram o formato registrado; `add`,
  `remove` e `agent add` operam no formato em uso sem migrar.
- **Arquivos de controle do git dentro de `.maker`**: um arquivo de atributos (sem conversão de fim
  de linha; lockfile e bases marcados como gerados para colapsar no diff de review) e um de ignore
  (transações, mutex, mediação e runs) são gerenciados como os demais arquivos, com merge 3-way e
  preservação de customização. A raiz do projeto nunca é tocada. Controles pré-existentes nunca são
  sobrescritos: idênticos passam a ser rastreados; divergentes são preservados e vão para mediação.
- **Temporários** (journal de transações, mutex, mediação, runs) nunca são versionados.

## Telas / fluxos (jornada)
1. **Install novo**: `init` já nasce no formato compacto.
2. **Trocar de formato**: o dono muda (ou remove) a declaração na config e roda `update`. O update
   migra manifest, estado de add-ons e bases, remove os arquivos do formato antigo e imprime um
   relatório (também em `--dry-run`) com o que migrou e o que foi descartado. A migração vale nos
   dois sentidos, é transacional (um crash nunca deixa o projeto sem estado autoritativo) e é
   bloqueada, sem escrever nada, quando há estado de add-on inválido ou não representável no
   lockfile — o dono corrige o arquivo ou faz opt-out para o formato por arquivo.
3. **Bases soltas** (ex.: checkout de branch antiga) encontradas junto de um lockfile em uso são
   consolidadas no mesmo update.
4. **Diagnóstico**: `doctor` reporta na seção de estado, com severidade e ação: base ausente ou
   corrompida, CRLF (a base é recuperada para o merge, mas o armazenamento segue apontado como
   corrompido até um update regravá-lo), conflito de merge no lockfile (blocos inteiros de bases são
   recuperados automaticamente; conflitos dentro da seção de manifest ou de add-ons, ou intercalados
   no conteúdo de uma base, não), versão futura do formato (pede atualizar o maker), lockfile ou
   manifest ilegível, e coexistência de formatos. Instalação íntegra mostra apenas o formato.
5. **Base ausente no update**: o arquivo dependente é preservado e encaminhado para mediação.

## Pontos de integração (conceitual)
- **Atualização transacional**: a migração de formato e a recuperação de transações pendentes usam o
  mesmo journal; a recuperação roda antes de ler qualquer estado.
- **Mediação**: bases ausentes e controles git pré-existentes divergentes caem no fluxo de mediação.
- **Add-ons**: `list`, `add` e `remove` leem o estado de add-ons do formato em uso.
- **Review de PR**: como o lockfile é marcado como gerado, a plataforma colapsa o diff inteiro,
  inclusive manifest e add-ons; é preciso expandir manualmente.

## Decisões-chave e limitações conhecidas
- Compactar é mudança incompatível: versionada como major (2.0.0).
- **Convivência com o maker 1.x**: a 1.x não conhece o lockfile, então num install compacto conclui
  "nenhum install" ou "add-on não aplicado" e **para sem escrever**; `list` mostra tudo como
  disponível. Exceção conhecida: `init --force` da 1.x reinstala por cima e gera coexistência, que a
  versão atual detecta e aborta no comando seguinte. Recomendação: atualizar o maker em todo o time e
  na CI antes de migrar um projeto.
- Risco residual de conflito de merge no lockfile quando duas branches inserem itens distintos na
  mesma vizinhança (bases, arquivos do manifest ou add-ons novos); resolução por doctor/update ou
  restauração do histórico do git.
- Um config ilegível mantém o formato atual (sem migração), com aviso.

## Referências
- Spec(s): `specs/003-compact-maker-state/`
- Documentação de usuário: `docs/maker-state.md`, `docs/MIGRATION.md`
- PR(s): https://github.com/vinics12/maker-kit/pull/43
