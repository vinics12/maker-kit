# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo. As versões são
geradas automaticamente pelo Release Please a partir dos Conventional Commits mergeados em
`main`.

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
