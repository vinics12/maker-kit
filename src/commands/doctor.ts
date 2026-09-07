import { resolve } from "node:path";
import pc from "picocolors";
import { readManifest, verifyManifest } from "../render/manifest.js";

export interface DoctorOptions {
  target?: string;
}

/** Verifica integridade de um install contra seu manifest. Sai com código 1 se degradado. */
export async function runDoctor(opts: DoctorOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new Error(`Nenhum install do maker encontrado em ${targetDir} (.maker/manifest.json ausente).`);
  }

  const result = await verifyManifest(targetDir, manifest);
  console.log(pc.dim(`Projeto "${manifest.project.name}" · maker ${manifest.makerVersion}`));
  console.log(pc.dim(`${result.checked} arquivos verificados`));

  if (result.ok) {
    console.log(pc.green("✓ Install íntegro."));
    return;
  }
  for (const m of result.missing) console.log(pc.red(`  ausente:    ${m}`));
  for (const m of result.modified) console.log(pc.yellow(`  modificado: ${m}`));
  console.log(
    pc.dim(`\n${result.missing.length} ausente(s), ${result.modified.length} modificado(s).`),
  );
  process.exitCode = 1;
}
