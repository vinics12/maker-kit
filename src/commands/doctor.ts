import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { readManifest, verifyManifest } from "../render/manifest.js";
import { enabledAgents } from "../render/manifest.js";
import { validateAgentIntegration } from "../agents/validate.js";
import { inspectAddons } from "../addons/doctor.js";
import { planUpdate, skillInstalled } from "./update.js";
import { mediationHint } from "./mediation.js";

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

  // Mediação pendente é informativa (não degrada o install); falhar ao planejar o update, não.
  const pending = await pendingMediation(targetDir);
  if ("error" in pending) {
    console.log(pc.red(`  não foi possível planejar o update: ${pending.error}`));
  } else if (pending.count) {
    console.log(pc.yellow(mediationHint(pending.count, pending.state).replace("precisam de mediação", "aguardam mediação do update")));
  }

  // Arquivo editado com base upstream registrada é customização: o update a preserva e mescla.
  const customized = result.modified.filter((path) => {
    const baseHash = manifest.files[path]?.baseHash;
    return baseHash && existsSync(join(targetDir, ".maker", "bases", baseHash));
  });
  const modified = result.modified.filter((path) => !customized.includes(path));
  for (const path of customized) console.log(pc.dim(`  personalizado: ${path} (preservado e mesclado pelo update)`));

  if (!result.missing.length && !modified.length && integrations.every((integration) => integration.issues.length === 0) &&
      addons.ok && !("error" in pending)) {
    console.log(pc.green("✓ Install íntegro."));
    return;
  }
  const reported = new Set(integrations.flatMap((integration) => integration.missingAdapters));
  for (const m of result.missing) if (!reported.has(m)) console.log(pc.red(`  ausente:    ${m}`));
  for (const m of modified) console.log(pc.yellow(`  modificado: ${m} (sem base registrada; execute maker update --dry-run)`));
  console.log(
    pc.dim(`\n${result.missing.length} ausente(s), ${modified.length} modificado(s) sem base, ${customized.length} personalizado(s).`),
  );
  process.exitCode = 1;
}

async function pendingMediation(targetDir: string): Promise<
  { count: number; state: Parameters<typeof mediationHint>[1] } | { error: string }> {
  try {
    const planning = await planUpdate(targetDir);
    return {
      count: planning.mediation.length,
      state: {
        configKnown: planning.recovered,
        skillInstalled: skillInstalled(targetDir),
        updateBlocked: planning.plan.changes.some((change) => change.action === "conflict"),
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
  }
}
