# Publicação da CLI

## Fluxo

O Release Please lê Conventional Commits em `main` e mantém um Release PR. O merge desse PR cria a
tag e a GitHub Release; o evento `release.published` dispara `.github/workflows/publish.yml`, que:

1. verifica fonte, testes, acoplamento e o `dist/` versionado;
2. gera um único tarball e faz smoke test desse arquivo;
3. publica o mesmo tarball no npm por Trusted Publishing (OIDC);
4. anexa `maker.tgz` e `maker.tgz.sha256` à GitHub Release.

## Linha de desenvolvimento

`main` é estável e potencialmente publicável, mas um merge comum **não** corta uma versão. Features
e correções entram por branches curtas (`feat/*`, `fix/*` ou a convenção numerada do `/run-spec`) e
se acumulam em `main`. A cada merge, o Release Please atualiza o mesmo Release PR com a próxima
versão e o changelog acumulado.

O único gatilho normal de publicação é o merge do **Release PR**:

```text
branches curtas → PRs comuns → main → Release PR aberto → merge deliberado → npm + GitHub Release
```

Consequências operacionais:

- PR comum pode ser mergeado sem publicar nada;
- várias melhorias pequenas compõem uma única versão;
- o Release PR pode permanecer aberto por dias ou semanas;
- `fix:` determina patch, `feat:` determina minor e `!`/`BREAKING CHANGE` determina major;
- ninguém faz bump manual nem cria tag/release fora do fluxo automatizado;
- agents podem preparar e revisar mudanças, mas não devem mergear o Release PR sem solicitação
  humana explícita.

Não mantemos uma branch `develop` permanente. Quando várias branches instáveis precisarem ser
testadas juntas, use uma branch temporária `integration/<tema>`, abra um único PR dela para `main`
quando estabilizar e remova-a depois do merge.

Para testes públicos antes de uma versão estável, use prerelease SemVer e o dist-tag npm `next`
(`X.Y.Z-beta.N`). Prereleases não devem substituir `latest`.

## Configuração única dos mantenedores

### GitHub

1. Crie um fine-grained personal access token limitado a este repositório, com acesso de leitura e
   escrita a Contents e Pull Requests, e salve-o como `RELEASE_PLEASE_TOKEN`. O token é necessário
   para que os PRs criados pelo bot disparem a CI normalmente.
2. Crie o environment `npm`. Proteções e aprovadores são opcionais, mas recomendados.
3. Aplique `.github/rulesets/main.json` para exigir os checks `verify` e `node-18` em `main`.

### npm

Na página do pacote `@vinicius.cerqueira/maker`, adicione um Trusted Publisher do GitHub Actions:

- organização ou usuário: `vinics12`;
- repositório: `maker-kit`;
- workflow: `publish.yml`;
- environment: `npm`.

Não crie `NPM_TOKEN`: o job recebe uma credencial curta via OIDC e o npm gera provenance
automaticamente para o pacote público.

## Recuperação

O workflow **Publish** também aceita execução manual com uma tag existente. Ele verifica se a versão
já existe no npm antes de publicar e sempre reconstrói, testa e atualiza os assets da release. Use
esse caminho para recuperar uma falha parcial sem criar outra tag ou sobrescrever uma versão npm.

Versões npm são imutáveis. Se uma versão defeituosa já foi publicada, marque-a como deprecated e
publique um patch; nunca mova ou recrie uma tag existente.
