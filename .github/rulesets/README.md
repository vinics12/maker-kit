# Rulesets

## `main.json`

Protege a branch `main`: exige PR (0 aprovações obrigatórias — bypass do admin evita lockout de
mantenedor solo), bloqueia deleção e force-push, e torna o status check `verify` (job do
`.github/workflows/ci.yml`) um required check. Sem exigência de linear history — o CONTRIBUTING §3
manda mergear por merge commit.

Aplicar o ruleset é uma ação administrativa (Settings do repositório), fora do escopo deste commit.
Este arquivo é a fonte versionada da decisão.

### Importar pela UI

Settings → Rules → Rulesets → New ruleset → Import a ruleset → selecione `main.json`.

### Aplicar via API

```bash
gh api -X POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json
```
