import { resolve } from "node:path";
import pc from "picocolors";
import { removeAddon } from "../addons/apply.js";
import { isAddonApplied } from "../addons/state.js";

export interface RemoveOptions {
  target?: string;
}

export async function runRemove(id: string, opts: RemoveOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  if (!isAddonApplied(targetDir, id)) {
    throw new Error(`Add-on "${id}" não está aplicado em ${targetDir}.`);
  }
  const res = await removeAddon(targetDir, id);

  console.log(pc.green(`\n✓ Add-on "${id}" removido de ${targetDir}`));
  if (res.strippedTargets.length)
    console.log(pc.dim(`  blocos removidos de: ${res.strippedTargets.join(", ")}`));
  if (res.deletedFiles.length)
    console.log(pc.dim(`  arquivos deletados: ${res.deletedFiles.join(", ")}`));
  if (res.keptFiles.length)
    console.log(
      pc.yellow(`  preservados (editados localmente): ${res.keptFiles.join(", ")}`),
    );
}
