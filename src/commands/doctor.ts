import { resolve } from "node:path";
import pc from "picocolors";
import { verifyManifest } from "../render/manifest.js";
import { enabledAgents } from "../render/manifest.js";
import { inspectState, openState } from "../state/store.js";
import { LOCKFILE, MANIFEST_FILE } from "../state/paths.js";
import { configuredBasesFormat } from "../state/format.js";
import { diagnoseState, type DoctorFinding } from "../state/diagnose.js";
import { validateAgentIntegration } from "../agents/validate.js";
import { inspectAddons } from "../addons/doctor.js";
import { planUpdate, skillInstalled } from "./update.js";
import { mediationHint } from "./mediation.js";

export interface DoctorOptions {
  target?: string;
}

function printStateFindings(findings: readonly DoctorFinding[]): void {
  for (const finding of findings) {
    const label = finding.severity === "fail" ? pc.red("falha")
      : finding.severity === "warn" ? pc.yellow("aviso")
        : pc.dim("info ");
    console.log(`  ${label}  ${finding.message}`);
    console.log(`         ${pc.dim("ação:")} ${finding.action}`);
  }
}

/** Verifica integridade de um install contra seu manifest. Sai com código 1 se degradado. */
export async function runDoctor(opts: DoctorOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const snapshot = await inspectState(targetDir);
  const configured = await configuredBasesFormat(targetDir, { inspect: true });
  const findings = diagnoseState(snapshot, configured);

  // Transação pendente ou estado ilegível: nada mais a verificar (não há manifest confiável).
  if (snapshot.pendingTransactions || snapshot.error) {
    console.log(pc.bold("Estado (.maker):"));
    printStateFindings(findings);
    process.exitCode = 1;
    return;
  }

  if (!snapshot.manifest) {
    throw new Error(`Nenhum install do maker encontrado em ${targetDir} (${MANIFEST_FILE} e ${LOCKFILE} ausentes).`);
  }

  // Sem error/pendingTransactions, a releitura via openState não lança e não recupera nada (mode "read").
  const state = (await openState(targetDir, { mode: "read" }))!;
  const manifest = state.manifest;
  const hasFailFinding = findings.some((finding) => finding.severity === "fail");

  const result = await verifyManifest(targetDir, manifest);
  const integrations = await Promise.all(
    enabledAgents(manifest).map((agent) => validateAgentIntegration(targetDir, agent)),
  );
  const addons = await inspectAddons(targetDir, manifest, state.hasBase);
  console.log(pc.dim(`Projeto "${manifest.project.name}" · maker ${manifest.makerVersion}`));
  console.log(pc.dim(`${result.checked} arquivos verificados`));
  for (const integration of integrations) {
    const status = integration.issues.length ? pc.red("degradada") : pc.green("íntegra");
    console.log(
      `  ${integration.provider}: ${status} · ${integration.skills} skills · ${integration.agents} agentes`,
    );
    for (const issue of integration.issues) console.log(pc.red(`    ${issue}`));
  }

  if (findings.length) {
    console.log(pc.bold("\nEstado (.maker):"));
    printStateFindings(findings);
  } else {
    console.log(pc.dim(`\nEstado (.maker): íntegro (${state.inUse})`));
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
  // Reaproveita o `state` já lido em modo "read": abrir de novo em "mutate" recuperaria uma transação
  // pendente e criaria .maker/ à toa — o doctor só lê, nunca escreve.
  const pending = await pendingMediation(targetDir, state);
  if ("error" in pending) {
    console.log(pc.red(`  não foi possível planejar o update: ${pending.error}`));
  } else if (pending.count) {
    console.log(pc.yellow(mediationHint(pending.count, pending.state).replace("precisam de mediação", "aguardam mediação do update")));
  }

  // Arquivo editado com base upstream registrada é customização: o update a preserva e mescla.
  const customized = result.modified.filter((path) => {
    const baseHash = manifest.files[path]?.baseHash;
    return baseHash && state.hasBase(baseHash);
  });
  const modified = result.modified.filter((path) => !customized.includes(path));
  for (const path of customized) console.log(pc.dim(`  personalizado: ${path} (preservado e mesclado pelo update)`));

  if (!result.missing.length && !modified.length && integrations.every((integration) => integration.issues.length === 0) &&
      addons.ok && !("error" in pending) && !hasFailFinding) {
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

async function pendingMediation(targetDir: string, installState: Awaited<ReturnType<typeof openState>>): Promise<
  { count: number; state: Parameters<typeof mediationHint>[1] } | { error: string }> {
  try {
    const planning = await planUpdate(targetDir, { state: installState });
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
