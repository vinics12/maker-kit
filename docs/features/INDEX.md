# maker (dogfood) — Índice de Features (as-built)

> Mantido pelo agente `feature-cataloguer` ao fim de cada feature aceita (Gate 4). É o registro
> conceitual das features prontas que o `/run-brainstorm` lê para entender o sistema **sem reler
> código**. Vazio até a primeira feature ser catalogada.

- [Observability do pipeline](pipeline-observability.md) — event stream append-only por run: custo/tempo por gate e captura automática do motivo de decisões de gate
- [CI de Pull Request](ci.md) — verificação automática de build/typecheck/testes/acoplamento em todo PR e push na branch default, complementando os gates humanos
