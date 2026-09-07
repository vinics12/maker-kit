---
name: maker
description: "Instala e mantém o motor de criação de produtos (SpecKit + orquestração multi-agente) num projeto, delegando para a CLI `maker`. Use quando o usuário quiser instalar/verificar/atualizar o motor ou gerenciar add-ons: 'instala o maker aqui', 'roda o maker init', 'verifica a instalação', 'atualiza o motor', 'adiciona a base saas', 'remove o add-on saas'. Expõe init | doctor | update | add | remove."
argument-hint: "init | doctor | update | add <addon> | remove <addon>"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

## O que este skill faz

Este é o **wrapper** do `maker`. Ele **não reimplementa** nada: mapeia o pedido do usuário para a
CLI `maker` (a fonte única de verdade) e conduz, pela conversa, a coleta dos knobs de configuração.
Ele cobre **`init`**, **`doctor`**, **`update`** (o motor) e **`add`**/**`remove`** (add-ons).

> Pré-requisito: a CLI precisa estar disponível. Verifique com `maker --version`. Se não estiver,
> oriente o usuário a instalar (`npm i -g @arruda-eng/maker` ou rodar via `npx @arruda-eng/maker`) —
> **não** tente instalar globalmente sem o ok do usuário.

## Roteamento

Interprete `$ARGUMENTS`:

### `init` — instalar o motor no projeto

1. Confirme o diretório-alvo (default: cwd) e cheque se já existe `.specify/` (se sim, avise que
   `--force` sobrescreve; peça confirmação).
2. Se **não** houver `maker.config.json` no alvo, **colete os knobs na conversa** (só mecânica, nada
   de regra de negócio):
   - `project.name` e `project.slug` (kebab-case; derive do nome e confirme).
   - `layout.frontendGlobs` / `layout.backendGlobs` (globs de roteamento de dev).
   - `commands.verify | build | test | dev`.
   Monte um `maker.config.json` com esses valores (ou passe via prompts da própria CLI).
3. Rode a CLI de forma não-interativa quando você já tem a config:
   ```bash
   maker init --target <dir> --config <arquivo> [--force]
   ```
   Ou, se preferir a coleta interativa da própria CLI, rode `maker init` e deixe o usuário responder.
4. Ao terminar, relate o resumo do install e os próximos passos que a CLI imprimiu (preencher
   `.specify/memory/project-rules.md` e revisar `constitution.md`).

### `doctor` — verificar a instalação

```bash
maker doctor --target <dir>
```
Relate arquivos ausentes/modificados. Não conserte nada sem o usuário pedir.

### `update` — atualizar arquivos do motor não modificados

```bash
maker update --target <dir>
```
Explique que só arquivos intocados localmente são atualizados; edições do usuário são preservadas e
listadas.

### `add <addon>` — aplicar um add-on sobre o install

Exige um install de motor válido. Colete os **knobs do add-on** na conversa (o add-on os declara) e
passe via `--set nome=valor` (repetível), ou use `--yes` para os defaults:

```bash
maker add <addon> --target <dir> --set knob1=valor1 --set knob2=valor2
```

Ex.: a base SaaS (`saas`) injeta princípios de multi-tenant, whitelabel e service-roles na
constitution + fragmentos nos agentes, e aceita `tenantColumn`, `brandVarPrefix`, `roles`:

```bash
maker add saas --set tenantColumn=tenant_id --set brandVarPrefix=--brand- --set roles=admin,member
```

Relate o que foi injetado e lembre que é reversível com `maker remove <addon>`.

### `remove <addon>` — remover um add-on aplicado

```bash
maker remove <addon> --target <dir>
```
Reverte as injeções (por marcador) e deleta os arquivos criados pelo add-on que não foram editados
localmente. Relate o que foi revertido e o que foi preservado por edição local.

## Regras

- **Delegue, não reimplemente.** Toda ação efetiva é um comando `maker`. Você só orquestra e coleta input.
- **Só knobs mecânicos.** Nunca peça nem invente regra de negócio, banco, observabilidade — isso o
  projeto declara depois nos stubs (`project-rules.md`, `constitution.md`).
- **Confirme antes de `--force`.** Sobrescrever um install existente precisa do ok explícito do usuário.
