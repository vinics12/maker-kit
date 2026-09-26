`project/` é um snapshot mínimo de uma instalação real da 0.2.0 com o add-on `saas`, gerado com o
`dist/cli.js` da tag `v0.2.0` (e suas dependências de produção):

```sh
maker init -t project -c fixtures/example.config.json -y   # fixture da própria tag
maker add saas -t project --set tenantColumn=org_id --set brandVarPrefix=--tema- --set roles=owner,staff
```

Mantém só os arquivos usados pelos testes (agentes com e sem add-on, constitution, referência do
add-on e uma skill que depende da config) e o manifest filtrado para eles, com sources `"engine"`
puros e sem `config`. `installedAt`/`appliedAt` foram fixados para o snapshot ser determinístico.
`maker.config.json` reproduz o projeto que manteve a config na raiz; os testes o removem para o caso
em que ela não é recuperável. Os demais arquivos do motor são recriados pelo update.

Os templates 0.2.0 dos agentes que recebem fragmentos de add-on ficam em
`templates/legacy/0.2.0/agents/`, empacotados, pois o update os usa para reconhecer corpos legados
sem customização.
