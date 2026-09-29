import { resolve } from "node:path";
import pc from "picocolors";
import { removeAddon } from "../addons/apply.js";

export interface RemoveOptions {
  target?: string;
  dryRun?: boolean;
}

export async function runRemove(id: string, opts: RemoveOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  // Sem pré-checagem: `removeAddon` abre o estado (StateError de coexistência/ilegibilidade propaga
  // antes de qualquer resposta "não está aplicado").
  const res = await removeAddon(targetDir, id, { dryRun: opts.dryRun });
  if (opts.dryRun) return;

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
