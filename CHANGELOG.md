# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo. As versões são
geradas automaticamente pelo Release Please a partir dos Conventional Commits mergeados em
`main`.

## [2.0.0](https://github.com/vinics12/maker-kit/compare/v1.0.0...v2.0.0) (2026-09-29)


### ⚠ BREAKING CHANGES

* **state:** o formato padrão do estado passa a ser "pack": o manifest, o estado dos add-ons e as bases ficam num único arquivo, .maker/maker.lock, e o próximo maker update migra installs existentes sem formato declarado (.maker/manifest.json, .maker/bases/ e .maker/addons/ deixam de existir). Para manter o formato por arquivo, declare "state": { "bases": "files" } em maker.config.json antes do update. Atualize o maker em todo o time e na CI antes de migrar: num install em pack, os comandos update, add, remove, agent add e a mediação das versões 1.x não encontram o estado que leem primeiro (.maker/manifest.json ou .maker/addons/<id>.json) e param sem escrever, e o list das versões 1.x mostra os add-ons como não aplicados. "maker init" sem "--force" de uma versão 1.x recusa por colisão enquanto houver arquivos gerados que diferem do que ela renderizaria (caso de um install feito por esta versão) e, recusando, não grava nada. "maker init --force" de uma versão 1.x reinstala por cima independentemente do formato (limitação conhecida); o estado duplicado resultante é detectado por esta versão, que recusa operar até que ele seja resolvido manualmente.

### Features

* **003/plan:** emenda US-7 — estado de add-on no lockfile (spec + plan + tasks) ([01015a6](https://github.com/vinics12/maker-kit/commit/01015a6925e027e95ac406a3bf5bf8b73beed66b))
* **003/plan:** plan + tasks + briefs ([75242bb](https://github.com/vinics12/maker-kit/commit/75242bbb87f7d48c568b68346ccf51b32525afb0))
* **003/spec:** spec.md aprovado ([cf3864c](https://github.com/vinics12/maker-kit/commit/cf3864cd4b92bcb1c520541b6e634a2539bf9610))
* **003/us1:** lockfile do estado + camada de estado única (src/state/) ([3311675](https://github.com/vinics12/maker-kit/commit/331167563a5eea43b486d05938ed10dfbfecea06))
* **003/us2:** formato efetivo, migração transacional e mediação de arquivos de controle do git ([a670bad](https://github.com/vinics12/maker-kit/commit/a670bada257400eb6fc9c687802be44b1b5f61df))
* **003/us3:** doctor detecta base ausente/corrompida e estado inválido (dois formatos) ([9490812](https://github.com/vinics12/maker-kit/commit/949081282c35f922463c2a95b831a66a736b6aa4))
* **003/us4:** skill maker-update proíbe editar o lockfile; package-smoke exige os templates de controle git ([d567d03](https://github.com/vinics12/maker-kit/commit/d567d03ff126396583af2050f1b65bbdbb4c2b0d))
* **003/us5:** agent add transacional com bases registradas ([b2b2a8d](https://github.com/vinics12/maker-kit/commit/b2b2a8d573d6bca84307687c0c95155bc071939d))
* **003/us7:** camada de estado — add-ons na seção [addons] do lockfile ([effe762](https://github.com/vinics12/maker-kit/commit/effe76256d73ecb82a372c3551a965842bd2e22c))
* **003/us7:** consumidores lêem/escrevem add-ons pela camada de estado ([e05d07a](https://github.com/vinics12/maker-kit/commit/e05d07ab75f72b136d484b228a4a680bdb982d09))
* **003/us7:** rebuild dist/cli.js; marca T701-T731 concluídas ([fd170bb](https://github.com/vinics12/maker-kit/commit/fd170bb3eaae74dace75075b9af071ba4c304efa))
* **state:** Compacta o estado de .maker num lockfile ([a4885c1](https://github.com/vinics12/maker-kit/commit/a4885c18f2d401333ea5c9c0b576321cd3e6d3f2))


### Bug Fixes

* **003/us1:** corrige corruptBase/removeBase em pack para editar só o bloco-alvo ([901584c](https://github.com/vinics12/maker-kit/commit/901584c0802b82e0e9537fe72193d424587f727b))
* **003/us1:** corrige ressincronização, gramática, StateError, helpers e ordem de recuperação ([c6e0554](https://github.com/vinics12/maker-kit/commit/c6e05544f1656fd7fff6c80dc66a4992d77b2e59))
* **003/us2:** adapta suítes legadas e prova de encapsulamento ao default pack ([f951003](https://github.com/vinics12/maker-kit/commit/f951003eb894a1159627a1a08b4c3f562a018b7d))
* **003/us2:** remove IDs de comentários, tira o literal "bases" do opt-out e anuncia entradas de lockfile descartadas ([c2abe22](https://github.com/vinics12/maker-kit/commit/c2abe221470f6b3724fc1406d2f06496a9e461ce))
* **003/us4:** AC-20 com conversão CRLF real no clone (C1/C2, T407) ([b8693e3](https://github.com/vinics12/maker-kit/commit/b8693e3793730f3271a89af6c3e93e1707baab73))
* **003/us4:** remove referência a FR-030 do comentário em validate.ts (C3) ([1731343](https://github.com/vinics12/maker-kit/commit/17313431544d316a84c0bc21e1b8d29a9fa8b639))
* **003/us4:** timeout explícito no crash de rollback e gitignore real na contagem (T408) ([04a8d7e](https://github.com/vinics12/maker-kit/commit/04a8d7e49495ac381a6cbb23b368906e64aa9982))
* **003/us4:** validate.ts aceita CRLF no frontmatter (T406) ([6f873fd](https://github.com/vinics12/maker-kit/commit/6f873fdfa1c761a52b5f80148f14b3ca8fdab1c6))
* **003/us5:** fecha feedback do code-reviewer (C1..C5) ([b5cc5c0](https://github.com/vinics12/maker-kit/commit/b5cc5c02fe7f25a8d9cc7f70bb265d87c3345fe5))
* **003/us6:** taxonomia uma-linha-por-item, saída real do doctor e teste contra install real ([0f43609](https://github.com/vinics12/maker-kit/commit/0f4360990ea24c15d7b0e31903cde0790858dd95))
* **003/us7:** remove referência a decisão do plano em comentário de store ([4a0f39d](https://github.com/vinics12/maker-kit/commit/4a0f39d4eb9d9fc77deda6bc2d5dae1522c91e77))


### Reverts

* **003/us2:** restaura test/state/encapsulation.test.ts para a versão congelada da US-1 ([7fccb61](https://github.com/vinics12/maker-kit/commit/7fccb61c219bfacccf3283d14498d4468d0d95fc))

## [1.0.0](https://github.com/vinics12/maker-kit/compare/v0.4.1...v1.0.0) (2026-09-27)


### Features

* **update:** Migra agentes legados e adiciona mediação por agente ([#38](https://github.com/vinics12/maker-kit/issues/38)) ([35f0f47](https://github.com/vinics12/maker-kit/commit/35f0f4734af7cdff27ec83ce4a2f5309603cb0ad)), closes [#37](https://github.com/vinics12/maker-kit/issues/37)


### Bug Fixes

* **deps:** Atualiza smol-toml para 1.9.0 ([#36](https://github.com/vinics12/maker-kit/issues/36)) ([0ed450d](https://github.com/vinics12/maker-kit/commit/0ed450df9c67e8db0f6154328b75e7f185ff72ea))

## [0.4.1](https://github.com/vinics12/maker-kit/compare/v0.4.0...v0.4.1) (2026-09-25)


### Bug Fixes

* **security:** Bloqueia dependências vulneráveis ([#33](https://github.com/vinics12/maker-kit/issues/33)) ([e0138f4](https://github.com/vinics12/maker-kit/commit/e0138f44b1a6c300eb4caea8280ae2d898cc7a69))

## [0.4.0](https://github.com/vinics12/maker-kit/compare/v0.3.0...v0.4.0) (2026-09-25)


### Features

* **001/plan:** plan + tasks + briefs (STANDARD) ([111964a](https://github.com/vinics12/maker-kit/commit/111964ac45526be9439125208e663c65db4877c2))
* **001/spec:** spec.md aprovado ([7a5504d](https://github.com/vinics12/maker-kit/commit/7a5504dbb323fae3e4cf8a3847b8751b7091ab41))
* **001/us1:** T101-T105 — schema + emit append-only ([0d7c87a](https://github.com/vinics12/maker-kit/commit/0d7c87a488dc2a37d0110b20309f086d905f842e))
* **001/us2:** T201-T207 — maker runs custo/tempo por gate ([b57f220](https://github.com/vinics12/maker-kit/commit/b57f220ce1db74563e7d15eee7e51a0aa051772d))
* **001/us3:** T301-T304 — captura L0 diff LCS puro-JS ([9a6aff3](https://github.com/vinics12/maker-kit/commit/9a6aff3fa8fec682c1ff79acb191bdb025cf7467))
* **001/us4:** T401-T403 — agregação L1 rejeição por gate ([f71e1e0](https://github.com/vinics12/maker-kit/commit/f71e1e028ed4aa0531da89d95ff42b55c8cb9ac3))
* **001:** event stream do pipeline — schema JSONL, maker runs, captura L0, agregação L1 ([a913692](https://github.com/vinics12/maker-kit/commit/a9136921fd1b2fbef3bb9352e3e5249196490ad6))
* **002/plan:** spec + tasks + briefs (MINI) ([ba4f9a7](https://github.com/vinics12/maker-kit/commit/ba4f9a7c64584286d801f666a47e5902408a8756))
* **002/us1:** CI de verify no PR/main + ruleset da main ([f0ffac7](https://github.com/vinics12/maker-kit/commit/f0ffac7319b3c47afa67cbd9e0c825ac1e2858f8))
* **002:** CI de PR via GitHub Actions ([0e32b06](https://github.com/vinics12/maker-kit/commit/0e32b06b860223b0c01551cefdef0e3b7acc90bd))
* **addons:** framework de add-ons + add-on saas (Fase 2) ([33731d3](https://github.com/vinics12/maker-kit/commit/33731d3c7393b81b22b73523c86448806aa10510))
* **addons:** Lista catálogo local ([d27321f](https://github.com/vinics12/maker-kit/commit/d27321f6af840d4a166602499a8e14f757b6edfc)), closes [#8](https://github.com/vinics12/maker-kit/issues/8)
* Adiciona catálogo local de add-ons ([8d91d88](https://github.com/vinics12/maker-kit/commit/8d91d88061758bf8376a58ec91d1cc18fe89c384))
* Adicionar suporte ao Codex como CLI agêntica ([6b426ef](https://github.com/vinics12/maker-kit/commit/6b426ef87bea1cd794a206052002c3c1dda4e00c))
* **doctor:** Adiciona diagnóstico de add-ons ([fe1a2f3](https://github.com/vinics12/maker-kit/commit/fe1a2f399120e7222995652e88974ddb20c05cd7))
* **engine:** .gitattributes força LF nos scripts do pipeline (Windows) ([b2d34e5](https://github.com/vinics12/maker-kit/commit/b2d34e5fe17372d9340122712168bff103888543))
* **engine/cataloguer:** promoção ao catálogo + poda de combustível no Gate 4 ([4cfaf71](https://github.com/vinics12/maker-kit/commit/4cfaf71a5b7b19d4db2b9990ee8a966eb47b79b0))
* instalável direto do GitHub sem npm registry ([769e9fa](https://github.com/vinics12/maker-kit/commit/769e9fa416cce3792a9ed220c55c63c2689666ef))
* motor de criação de produtos reinstalável (Fase 1) ([ee98dca](https://github.com/vinics12/maker-kit/commit/ee98dca20c94b080db2bb85834b89fb443e758a3))
* **plan:** Adiciona aplicação transacional ([14af36e](https://github.com/vinics12/maker-kit/commit/14af36e055afba5ca6fa665b514c8b4c73c88e18))
* Planejamento transacional e 3-way merge ([46ad871](https://github.com/vinics12/maker-kit/commit/46ad8713dd63ec13210a03534b0370be16596015))
* torna maker doctor consciente de add-ons ([4adecee](https://github.com/vinics12/maker-kit/commit/4adecee3eec1d9d6b828d9e1ac5460d5d28d1dc7))
* **update:** Adiciona merge seguro ([0618518](https://github.com/vinics12/maker-kit/commit/06185180e305c8edd8d506bf98b5f5e2f2377d67)), closes [#9](https://github.com/vinics12/maker-kit/issues/9) [#10](https://github.com/vinics12/maker-kit/issues/10)


### Bug Fixes

* **addons:** Detecta symlink quebrado no state ([5478bf9](https://github.com/vinics12/maker-kit/commit/5478bf98c7d9023d5b9361312e8e9d657e610e03))
* **addons:** Tolera store de states inválida ([dd33f98](https://github.com/vinics12/maker-kit/commit/dd33f98b8940655fc7f4a2fd3ac769a697c63854))
* Impede sobrescrita silenciosa no init ([2c74ac6](https://github.com/vinics12/maker-kit/commit/2c74ac67c4835e1fbd599e406b2b1f93f4b16173))
* **init:** Evita seguir symlinks com force ([c3308e9](https://github.com/vinics12/maker-kit/commit/c3308e9ce6b4ab2966bac3a73ebcb562e7bf4376))
* **init:** Impede sobrescrita silenciosa ([1064ed2](https://github.com/vinics12/maker-kit/commit/1064ed2e3cd137e0c39542b9b8f369ea6d96429d)), closes [#1](https://github.com/vinics12/maker-kit/issues/1)
* **install:** versiona dist e remove prepare — corrige npm code 127 ([b5d1537](https://github.com/vinics12/maker-kit/commit/b5d1537bfbd6371f9427a9f0d7fadab9fc5c9c7a))
* **release:** Corrige publicação da CLI ([c1da23e](https://github.com/vinics12/maker-kit/commit/c1da23eafe790f4eb99b6f4947414fcb52da34ed))
* **wrapper:** estrutura de plugin válida do Claude Code + instruções de uso ([52027b6](https://github.com/vinics12/maker-kit/commit/52027b6eadc852beca094322c13961d72b5b5d62))

## [0.3.0](https://github.com/vinics12/maker-kit/compare/@vinicius.cerqueira/maker-v0.2.0...@vinicius.cerqueira/maker-v0.3.0) (2026-09-25)


### Features

* **001/plan:** plan + tasks + briefs (STANDARD) ([111964a](https://github.com/vinics12/maker-kit/commit/111964ac45526be9439125208e663c65db4877c2))
* **001/spec:** spec.md aprovado ([7a5504d](https://github.com/vinics12/maker-kit/commit/7a5504dbb323fae3e4cf8a3847b8751b7091ab41))
* **001/us1:** T101-T105 — schema + emit append-only ([0d7c87a](https://github.com/vinics12/maker-kit/commit/0d7c87a488dc2a37d0110b20309f086d905f842e))
* **001/us2:** T201-T207 — maker runs custo/tempo por gate ([b57f220](https://github.com/vinics12/maker-kit/commit/b57f220ce1db74563e7d15eee7e51a0aa051772d))
* **001/us3:** T301-T304 — captura L0 diff LCS puro-JS ([9a6aff3](https://github.com/vinics12/maker-kit/commit/9a6aff3fa8fec682c1ff79acb191bdb025cf7467))
* **001/us4:** T401-T403 — agregação L1 rejeição por gate ([f71e1e0](https://github.com/vinics12/maker-kit/commit/f71e1e028ed4aa0531da89d95ff42b55c8cb9ac3))
* **001:** event stream do pipeline — schema JSONL, maker runs, captura L0, agregação L1 ([a913692](https://github.com/vinics12/maker-kit/commit/a9136921fd1b2fbef3bb9352e3e5249196490ad6))
* **002/plan:** spec + tasks + briefs (MINI) ([ba4f9a7](https://github.com/vinics12/maker-kit/commit/ba4f9a7c64584286d801f666a47e5902408a8756))
* **002/us1:** CI de verify no PR/main + ruleset da main ([f0ffac7](https://github.com/vinics12/maker-kit/commit/f0ffac7319b3c47afa67cbd9e0c825ac1e2858f8))
* **002:** CI de PR via GitHub Actions ([0e32b06](https://github.com/vinics12/maker-kit/commit/0e32b06b860223b0c01551cefdef0e3b7acc90bd))
* **addons:** framework de add-ons + add-on saas (Fase 2) ([33731d3](https://github.com/vinics12/maker-kit/commit/33731d3c7393b81b22b73523c86448806aa10510))
* **addons:** Lista catálogo local ([d27321f](https://github.com/vinics12/maker-kit/commit/d27321f6af840d4a166602499a8e14f757b6edfc)), closes [#8](https://github.com/vinics12/maker-kit/issues/8)
* Adiciona catálogo local de add-ons ([8d91d88](https://github.com/vinics12/maker-kit/commit/8d91d88061758bf8376a58ec91d1cc18fe89c384))
* Adicionar suporte ao Codex como CLI agêntica ([6b426ef](https://github.com/vinics12/maker-kit/commit/6b426ef87bea1cd794a206052002c3c1dda4e00c))
* **doctor:** Adiciona diagnóstico de add-ons ([fe1a2f3](https://github.com/vinics12/maker-kit/commit/fe1a2f399120e7222995652e88974ddb20c05cd7))
* **engine:** .gitattributes força LF nos scripts do pipeline (Windows) ([b2d34e5](https://github.com/vinics12/maker-kit/commit/b2d34e5fe17372d9340122712168bff103888543))
* **engine/cataloguer:** promoção ao catálogo + poda de combustível no Gate 4 ([4cfaf71](https://github.com/vinics12/maker-kit/commit/4cfaf71a5b7b19d4db2b9990ee8a966eb47b79b0))
* instalável direto do GitHub sem npm registry ([769e9fa](https://github.com/vinics12/maker-kit/commit/769e9fa416cce3792a9ed220c55c63c2689666ef))
* motor de criação de produtos reinstalável (Fase 1) ([ee98dca](https://github.com/vinics12/maker-kit/commit/ee98dca20c94b080db2bb85834b89fb443e758a3))
* **plan:** Adiciona aplicação transacional ([14af36e](https://github.com/vinics12/maker-kit/commit/14af36e055afba5ca6fa665b514c8b4c73c88e18))
* Planejamento transacional e 3-way merge ([46ad871](https://github.com/vinics12/maker-kit/commit/46ad8713dd63ec13210a03534b0370be16596015))
* torna maker doctor consciente de add-ons ([4adecee](https://github.com/vinics12/maker-kit/commit/4adecee3eec1d9d6b828d9e1ac5460d5d28d1dc7))
* **update:** Adiciona merge seguro ([0618518](https://github.com/vinics12/maker-kit/commit/06185180e305c8edd8d506bf98b5f5e2f2377d67)), closes [#9](https://github.com/vinics12/maker-kit/issues/9) [#10](https://github.com/vinics12/maker-kit/issues/10)


### Bug Fixes

* **addons:** Detecta symlink quebrado no state ([5478bf9](https://github.com/vinics12/maker-kit/commit/5478bf98c7d9023d5b9361312e8e9d657e610e03))
* **addons:** Tolera store de states inválida ([dd33f98](https://github.com/vinics12/maker-kit/commit/dd33f98b8940655fc7f4a2fd3ac769a697c63854))
* Impede sobrescrita silenciosa no init ([2c74ac6](https://github.com/vinics12/maker-kit/commit/2c74ac67c4835e1fbd599e406b2b1f93f4b16173))
* **init:** Evita seguir symlinks com force ([c3308e9](https://github.com/vinics12/maker-kit/commit/c3308e9ce6b4ab2966bac3a73ebcb562e7bf4376))
* **init:** Impede sobrescrita silenciosa ([1064ed2](https://github.com/vinics12/maker-kit/commit/1064ed2e3cd137e0c39542b9b8f369ea6d96429d)), closes [#1](https://github.com/vinics12/maker-kit/issues/1)
* **install:** versiona dist e remove prepare — corrige npm code 127 ([b5d1537](https://github.com/vinics12/maker-kit/commit/b5d1537bfbd6371f9427a9f0d7fadab9fc5c9c7a))
* **wrapper:** estrutura de plugin válida do Claude Code + instruções de uso ([52027b6](https://github.com/vinics12/maker-kit/commit/52027b6eadc852beca094322c13961d72b5b5d62))

## 0.2.0 (2026-09-07)

- Primeira publicação da CLI no npm e distribuição por tarball no GitHub Releases.
