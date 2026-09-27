---
name: "maker-update"
description: "Mediate a maker update: bring in the newest maker templates without losing what the project owner customized. Use when `maker update` reports files that need mediation (conflicts, local customizations without an exact base, add-on targets with a new template, or legacy agents without a shared role)."
argument-hint: "Optional: an export directory (default .maker/mediation) or a subset of paths to mediate."
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

## Purpose

`maker update` merges automatically everything it can prove safe. What remains needs judgment: the owner changed the same lines the new version changed, there is no exact base to compare against, an add-on block lives inside a file whose template changed, or a legacy agent still carries its whole role inline. This skill has you **propose** the final content for those files. The `maker` CLI stays the only writer: it validates every proposal and applies them in one transaction with rollback.

Guiding rule: **the owner's customizations win over template text; the template's new capabilities are brought in around them.** When both cannot coexist, ask the owner.

## Hard rules

- Never edit files listed in the export directly, never edit `.maker/manifest.json`, `.maker/bases/` or `.maker/addons/*.json`. Only write `items/<id>/resolved` (and optionally `items/<id>/notes.md`) inside the export directory.
- Never drop owner content silently. Every line that exists in `local` but not in `base` is a customization and must survive (possibly moved or adapted), unless the owner explicitly agrees to remove it.
- Keep every `<!-- maker:addon:<id>:start -->` … `<!-- maker:addon:<id>:end -->` block byte-for-byte, exactly once. Do not merge template text into an add-on block.
- Do not invent content. Everything in `resolved` must come from `local`, `upstream`, or an explicit owner decision.
- Never leave conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in a proposal.
- Do not run `maker update --apply-resolutions` without `--dry-run` before the owner approves the final diff.
- If no human can answer (non-interactive run, CI, batch mode): stop after step 7 and report the proposals, the dry-run output and every open question. Never apply without an explicit approval.
- Use `--accept-dropped` only after the owner explicitly approved removing each listed line. Never add it to get past a rejection.

## What the CLI checks — and what it does not

The CLI rejects proposals that: target a file that changed since the export or that is not a current mediation item, contain conflict markers, are empty or not UTF-8, remove, alter or add add-on blocks, resolve only part of a group, or leave a legacy adapter without the shared-role instruction (or with add-on blocks). It also rejects a proposal that drops a **customized line** — a line of `local` that is not in `base` (or in `upstream`, when there is no base) and does not appear in any proposal of the group — unless `--accept-dropped` is given. `--dry-run` prints the `local → resolved` diff of every proposal.

That line check is literal. It cannot tell that a customization was **rewritten** into something with a different meaning, that a line was kept but moved out of the section where it had effect, or that a template requirement was silently lost. Those judgments are yours — follow the evaluation below.

## How to evaluate each change

Do this for every item before writing `resolved`, and record the result in `notes.md` using the format at the end.

1. **Inventory the owner's customizations** (`base → local`; without `base`, the differences between `local` and `upstream` that are not template evolution). For each one, note what it does: a project command, a path or glob, a business rule, a tone or format instruction, a removed step, a model/tools setting.
2. **Inventory the template changes** (`base → upstream`; without `base`, what `upstream` has that `local` lacks). For each one, note its purpose: new step or gate, renamed file or command, bug fix in the instructions, wording only.
3. **Classify every pair that touches the same region:**
   - *independent* — both survive as-is;
   - *compatible* — both survive, merged into one text that keeps the owner's intent and the template's requirement;
   - *superseded* — the owner deliberately removed or replaced what the template changed; keep the owner's version and tell them what they are not getting;
   - *contradictory* — they cannot both hold (e.g. different commands, opposite rules); do not pick — ask the owner.
4. **Check the intent, not just the lines:**
   - project commands, paths and globs in `local` must stay exactly as the owner wrote them — never "correct" them toward the template's defaults;
   - instructions an agent follows keep their order and scope (a rule moved to another section may stop applying);
   - references to files, skills, agents and commands must point to things that exist after the update;
   - in agent adapters, only the frontmatter is the owner's; the body is the generated instruction.
5. **Rate the risk** of each item: *low* (template wording, independent changes), *medium* (compatible merges, moved text), *high* (superseded or contradictory decisions, anything touching commands, gates or add-on behavior). Show high-risk items to the owner first.
6. **Self-check before asking for approval:** run `maker update --apply-resolutions --dry-run`; every line it reports as dropped must be either restored or listed in `notes.md` as an owner-approved removal. Re-read the diff: nothing in `resolved` should come from outside `local`, `upstream` or an owner answer.

`notes.md` format:

```markdown
## <path> — risk: low|medium|high
Customizations kept: …
Template changes brought in: …
Decisions (superseded/contradictory): … — approved by the owner? yes/no
Lines removed with approval: … (or "none")
Open questions: …
```

## Workflow

1. **Export.** Run `maker update --export` (or `maker update --export <dir>` if the user gave one). If it reports that the project config was not recovered, stop and ask the owner to create `maker.config.json` with the values used at init; the upstream versions would otherwise be rendered with defaults. If nothing needs mediation, report that and stop.
2. **Read the index.** Open `<dir>/mediation.json`. Each item has `path`, `category`, `reason`, `group`, and the files in `<dir>/items/<id>/`: `upstream` (new version, always present), `local` (current file, absent if the file does not exist) and `base` (the upstream version the local file started from, when known).
3. **Understand each change before writing.**
   - With `base`: diff `base → local` to list the owner's customizations, and `base → upstream` to list what the new version brings.
   - Without `base`: diff `local` against `upstream` and classify each difference as owner customization or template evolution. When unsure, treat it as a customization and ask.
4. **Propose, per category.**
   - `conflict` / `local-edit`: start from `upstream`, re-apply every owner customization in the place it belongs. If an upstream change rewrote a section the owner also changed, keep the owner's intent and fold in the new requirement; ask when they contradict.
   - `addon`: start from `upstream`, re-insert each add-on block exactly where it was relative to the surrounding headings, and re-apply other owner customizations.
   - `legacy-agent` (items share a `group`: a legacy agent file that still carries its whole role inline, and its shared role under `.maker/workflow/agents/`): the agent file must become the generated adapter — its `resolved` is exactly `upstream`, changing only frontmatter fields the owner customized, such as `model`, `color` or `tools` (keep `Read` in `tools`); never keep role instructions in the adapter. Move the role instructions to the shared role: start from the shared role's `upstream`, re-apply the owner's customizations from the legacy agent body, and move its add-on blocks there unchanged. Resolve every item of a group, or none.
5. **Write** each proposal to `<dir>/items/<id>/resolved` — keep the line endings of `local` and end the file with a newline — and a short `notes.md` listing: customizations kept, template changes brought in, anything left out and why.
6. **Review with the owner.** Show, per file, the diff `local → resolved` and the notes. Ask explicit questions for every ambiguity. Adjust until the owner approves. Items the owner wants to postpone simply get no `resolved` file.
7. **Validate.** Run `maker update --apply-resolutions --dry-run` (add the directory if not the default). Fix any rejected proposal (dropped customized lines, lost add-on blocks, conflict markers, adapter without the shared-role instruction, file changed since export) and repeat.
8. **Apply** with `maker update --apply-resolutions` (plus `--accept-dropped` only for owner-approved removals). If the export was made with `--no-merge`, the CLI applies it in the same mode. Then run `maker update` and `maker doctor`: `maker update` exits with code 2 while mediation items or degraded agents remain. Report the final state: files mediated, items postponed, remaining warnings.

## Notes

- If the owner edits a listed file during the process, the CLI rejects the stale proposal; export again. `--export` refuses to overwrite an export that still has `resolved` or `notes.md` files: apply them or move them away first. Item ids are stable per path, so proposals can be copied back into a new export.
- A proposal equal to `upstream` is valid: it means the owner accepted the new version for that file.
- Applied items are removed from the export; the directory is removed once every item is applied. Keep it out of version control (for example, add `.maker/mediation/` to `.gitignore`).
