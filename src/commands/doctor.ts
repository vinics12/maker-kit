import { resolve } from "node:path";
import pc from "picocolors";
import { readManifest, verifyManifest } from "../render/manifest.js";
import { enabledAgents } from "../render/manifest.js";
import { validateAgentIntegration } from "../agents/validate.js";
import { inspectAddons } from "../addons/doctor.js";

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
  const integrations = await Promise.all(
    enabledAgents(manifest).map((agent) => validateAgentIntegration(targetDir, agent)),
  );
  const addons = await inspectAddons(targetDir, manifest);
  console.log(pc.dim(`Projeto "${manifest.project.name}" · maker ${manifest.makerVersion}`));
  console.log(pc.dim(`${result.checked} arquivos verificados`));
  for (const integration of integrations) {
    const status = integration.issues.length ? pc.red("degradada") : pc.green("íntegra");
    console.log(
      `  ${integration.provider}: ${status} · ${integration.skills} skills · ${integration.agents} agentes`,
    );
    for (const issue of integration.issues) console.log(pc.red(`    ${issue}`));
  }

  if (addons.addons.length) {
    console.log(pc.bold("\nAdd-ons aplicados:"));
    for (const addon of addons.addons) {
      const status = addon.ok ? pc.green("íntegro") : pc.red("degradado");
      console.log(`  ${addon.id} · ${addon.name} · v${addon.version ?? "?"} · ${status}`);
      for (const problem of addon.issues) {
        console.log(pc.red(`    problema: ${problem.message}`));
        console.log(pc.yellow(`    ação: ${problem.action}`));
      }
    }
  }

  if (result.ok && integrations.every((integration) => integration.issues.length === 0) && addons.ok) {
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
