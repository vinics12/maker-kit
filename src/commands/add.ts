import { resolve } from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { loadAddon } from "../addons/loader.js";
import { applyAddon } from "../addons/apply.js";
import { isAddonApplied } from "../addons/state.js";
import type { AddonKnob } from "../addons/schema.js";

export interface AddOptions {
  target?: string;
  set?: string[]; // ["tenantColumn=tenant_id", ...]
  yes?: boolean;
}

function parseSet(pairs: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) throw new Error(`--set inválido: "${pair}" (use nome=valor)`);
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

async function collectKnobs(
  knobs: AddonKnob[],
  provided: Record<string, string>,
  yes: boolean,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const k of knobs) {
    if (k.name in provided) {
      values[k.name] = provided[k.name]!;
      continue;
    }
    if (yes) {
      values[k.name] = k.default;
      continue;
    }
    const answer = await p.text({ message: k.prompt, initialValue: k.default });
    if (p.isCancel(answer)) {
      p.cancel("Operação cancelada.");
      process.exit(1);
    }
    values[k.name] = answer as string;
  }
  return values;
}

export async function runAdd(id: string, opts: AddOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  if (isAddonApplied(targetDir, id)) {
    console.log(pc.yellow(`Add-on "${id}" já aplicado — reaplicando (idempotente).`));
  }
  const addon = await loadAddon(id);
  const provided = parseSet(opts.set);
  const knobs = await collectKnobs(addon.knobs, provided, !!opts.yes);

  const res = await applyAddon(targetDir, addon, knobs);

  console.log(pc.green(`\n✓ Add-on "${addon.name}" aplicado em ${targetDir}`));
  if (res.injectedTargets.length)
    console.log(pc.dim(`  injetado em: ${res.injectedTargets.join(", ")}`));
  if (res.createdFiles.length)
    console.log(pc.dim(`  arquivos criados: ${res.createdFiles.join(", ")}`));
  console.log(pc.dim(`  reversível com: maker remove ${id}`));
}
