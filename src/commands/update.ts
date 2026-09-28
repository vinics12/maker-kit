import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { mergeDiff3 } from "node-diff3";
import { z } from "zod";
import { parseConfig, type AgentProvider, type MakerConfig } from "../config/schema.js";
import { buildContext, type RenderContext } from "../render/engine.js";
import { enabledAgents, sha256, type Manifest, type ManifestEntry } from "../render/manifest.js";
import { applyEngine, legacyAgent, legacyBase } from "../util/engine-scaffold.js";
import type { AppliedFile } from "../util/scaffold.js";
import { makerVersion } from "../util/version.js";
import { resolveConfig } from "../util/upstream.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type ChangePlan, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan } from "../changes/transaction.js";
import { openState, planStateWrite, type InstallState } from "../state/store.js";
import { configuredBasesFormat, effectiveBasesFormat, planFormatTransition, type ConfiguredFormat, type FormatTransition } from "../state/format.js";
import { GIT_CONTROL_FILES } from "../state/paths.js";
import type { BaseProblem } from "../state/lockfile.js";
import { planLegacyAddonAgents, type LegacyAgentReport } from "../agents/migrate.js";
import { sharedRoleReference } from "../agents/reference.js";
import { afterBlockRemoval, reinjectBlocks } from "../addons/apply.js";
import { addonBlocks, sameText } from "../addons/inject.js";
import { applyResolutions, exportMediation, exportedMergeMode, mediationHint, type MediationCandidate, type MediationCategory } from "./mediation.js";

const CONFIG_UNKNOWN = "depende de config não recuperada";
/** Alvo de add-on já no template atual: conta como atualizado, não como preservado por segurança. */
const UP_TO_DATE_ADDON = "já está atualizado (template atual com os blocos de add-on)";
const CONFIG_ACTION = "crie maker.config.json com os valores usados no init e execute maker update --dry-run";

export interface UpdateOptions {
  target?: string;
  dryRun?: boolean;
  merge?: boolean;
  /** Exporta o que precisa de mediação (base/local/upstream) sem aplicar o update. */
  export?: string | true;
  /** Aplica as propostas escritas sobre uma exportação. */
  applyResolutions?: string | true;
  /** Aceita propostas que descartam linhas customizadas (só com aprovação explícita do dono). */
  acceptDropped?: boolean;
}

/** Exit code do update aplicado (ou do dry-run) quando sobra trabalho que ele não resolve sozinho. */
export const PENDING_EXIT_CODE = 2;

/** Resultado do planejamento, sem escrever nada: usado pelo update, pela mediação e pelo doctor. */
export interface UpdatePlanning {
  plan: ChangePlan;
  reports: LegacyAgentReport[];
  mediation: MediationCandidate[];
  unresolved: string[];
  defaulted: string[];
  config: MakerConfig;
  recovered: boolean;
  /** Transição de formato planejada (migração e/ou consolidação de bases soltas); `null` sem transição. */
  transition: FormatTransition | null;
  /** `maker.config.json` ilegível: formato mantido sem migrar, aviso para o usuário. */
  configWarning?: string;
  /** Sem transição, entradas do lockfile em pack que não verificam e somem ao regravá-lo. */
  invalidEntries: BaseProblem[];
}

/**
 * Lê `state.bases` de `maker.config.json` do alvo; `state.bases` fora do enum aborta antes de
 * qualquer escrita com uma mensagem legível — nunca o ZodError cru.
 */
async function configuredFormatOrAbort(targetDir: string): Promise<ConfiguredFormat> {
  try {
    return await configuredBasesFormat(targetDir);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`maker.config.json: ${error.issues[0]?.message ?? "state.bases inválido"}`);
    }
    throw error;
  }
}

/** `3f9a…(64)` para um hash conhecido, `linha N` para um problema sem hash (ex.: bloco malformado). */
function problemLabel(problem: BaseProblem): string {
  return problem.hash ? `${problem.hash.slice(0, 4)}…(${problem.hash.length})` : `linha ${problem.line ?? "?"}`;
}

/** Anúncio de migração/consolidação de bases (`cli-output.md` §1), impresso antes do plano/resumo. */
export function announceTransition(transition: FormatTransition, opts: { applied: boolean }): void {
  const isConsolidationOnly = transition.from === transition.to;
  const head = isConsolidationOnly
    ? `Consolidação das bases: bases por arquivo → ${transition.to}`
    : `Migração do formato das bases: ${transition.from} → ${transition.to}`;
  const paint = opts.applied ? pc.green : pc.bold;
  console.log(paint(opts.applied ? `✓ ${head}` : head));
  console.log(`  ${transition.migrated} base(s) migrada(s), ${transition.discarded.length} descartada(s).`);
  for (const problem of transition.discarded) {
    const files = problem.hash ? transition.affected[problem.hash] ?? [] : [];
    console.log(pc.yellow(`  descartada ${problemLabel(problem)} [${problem.origin}] ${problem.detail}${files.length ? ` → afeta: ${files.join(", ")}` : ""}`));
  }
  if (transition.reason === "default") {
    console.log(`  O formato "${transition.to}" é o padrão; para manter as bases por arquivo, declare ${optOutSnippet()} em maker.config.json.`);
  }
}

/** Sem transição de formato, um lockfile em pack ainda pode ser regravado descartando entradas que não verificam — nunca em silêncio. */
function announceInvalidEntries(problems: readonly BaseProblem[]): void {
  if (!problems.length) return;
  const list = problems.map((problem) => `${problemLabel(problem)} (${problem.detail})`).join(", ");
  console.log(pc.yellow(`${problems.length} entrada(s) inválida(s) do lockfile descartada(s): ${list}`));
}

/** Trecho de config do opt-out de formato, montado a partir da própria estrutura (nunca um literal de caminho). */
function optOutSnippet(): string {
  return JSON.stringify({ state: { bases: "files" } }, null, 1).replace(/\s*\n\s*/g, " ").slice(2, -2);
}

export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  if (opts.export && opts.applyResolutions) throw new Error("Use --export ou --apply-resolutions, não os dois juntos.");
  // dry-run/export não escrevem estado: só verificam que não há transação pendente. Os demais
  // caminhos (aplicado, --apply-resolutions) recuperam uma transação pendente antes de ler.
  const state = await openState(targetDir, { mode: opts.dryRun || opts.export ? "dry-run" : "mutate" });
  // As propostas são validadas contra os candidatos do mesmo modo (--no-merge ou não) da exportação.
  const merge = opts.applyResolutions ? (await exportedMergeMode(targetDir, opts.applyResolutions)) ?? opts.merge : opts.merge;
  const planning = await planUpdate(targetDir, { merge, state });
  const { plan, reports, mediation, unresolved, defaulted, config, recovered, transition, configWarning, invalidEntries } = planning;
  if ((opts.export || opts.applyResolutions) && !recovered) {
    throw new Error("Config do projeto não recuperada: crie maker.config.json com os valores usados no init antes de mediar o update.");
  }
  // A mediação usa os candidatos recalculados agora, não o que o índice exportado declara.
  if (opts.applyResolutions) {
    return applyResolutions(targetDir, opts.applyResolutions, config, mediation, state!, { dryRun: opts.dryRun, acceptDropped: opts.acceptDropped });
  }
  if (opts.export) return exportMediation(targetDir, opts.export, mediation, config, { merge: merge !== false });

  if (unresolved.length || defaulted.length) {
    // A 0.2.x não persistia a config: sem maker.config.json no projeto não há fonte fiel.
    console.log(pc.yellow("Config do projeto não recuperada (manifest sem config e sem maker.config.json):"));
    if (unresolved.length) console.log(pc.yellow(`  ${unresolved.length} arquivo(s) existente(s) que dependem dela preservado(s): ${unresolved.join(", ")}`));
    if (defaulted.length) console.log(pc.yellow(`  ${defaulted.length} arquivo(s) ausente(s) criado(s) com valores padrão: ${defaulted.join(", ")}`));
    console.log(pc.yellow("Ação recomendada: crie maker.config.json com os valores usados no init e execute maker update --dry-run; os arquivos acima são então renderizados com ela."));
  }
  const conflicted = plan.changes.some((change) => change.action === "conflict");
  const degradedAgents = reports.filter((report) => report.status === "degraded").length;
  const hint = () => mediation.length && console.log(pc.yellow(mediationHint(mediation.length, {
    configKnown: recovered, skillInstalled: skillInstalled(targetDir), updateBlocked: conflicted && !opts.dryRun })));
  if (opts.dryRun) {
    hint();
    if (configWarning) console.log(pc.yellow(configWarning));
    if (transition) announceTransition(transition, { applied: false });
    else announceInvalidEntries(invalidEntries);
    printAgentReports(reports, "planejado");
    console.log(formatPlan(plan));
    if (conflicted) process.exitCode = 1;
    else if (mediation.length || degradedAgents) process.exitCode = PENDING_EXIT_CODE;
    return;
  }
  // Com conflito a transação é recusada: o aviso vem antes, e só pode sugerir o que já existe.
  if (conflicted) hint();
  // Aplica antes de relatar: com conflito a transação é recusada e nenhuma migração acontece.
  await applyChangePlan(plan);
  // Depois de aplicar, a skill maker-update já está instalada.
  hint();
  if (configWarning) console.log(pc.yellow(configWarning));
  if (transition) announceTransition(transition, { applied: true });
  else announceInvalidEntries(invalidEntries);
  printAgentReports(reports, "aplicado");
  const merged = plan.changes.filter((change) => change.resolution === "merge").length;
  const updated = plan.changes.filter((change) => (change.action === "update" || change.action === "create") && change.source !== "metadata" && change.resolution !== "merge").length;
  const preserved = plan.changes.filter((change) => change.action === "preserve" && change.source !== "metadata" && !change.reason.startsWith("já está atualizado")).length;
  console.log(pc.green(`✓ ${updated} arquivo(s) atualizado(s), ${merged} mesclado(s).`));
  if (preserved) console.log(pc.yellow(`${preserved} preservado(s) por segurança.`));
  if (reports.length) {
    const migrated = reports.filter((report) => report.status === "migrated" || report.status === "adapter").length;
    const degraded = reports.length - migrated;
    console.log((degraded ? pc.yellow : pc.green)(`${migrated} agente(s) migrado(s), ${degraded} permanece(m) degradado(s).`));
  }
  if (mediation.length || degradedAgents) {
    console.log(pc.yellow(`Update aplicado com pendências (exit code ${PENDING_EXIT_CODE}): resolva a mediação e os agentes degradados acima.`));
    process.exitCode = PENDING_EXIT_CODE;
  }
}

export async function planUpdate(targetDir: string, opts: { merge?: boolean; state?: InstallState | null } = {}): Promise<UpdatePlanning> {
  // `state: null` (o alvo já foi aberto e não há install) é diferente de `state` ausente (abre agora,
  // em modo mutate): usar `??` aqui reabriria o estado sempre que o chamador já soubesse que não há
  // install — inclusive em --dry-run, criando .maker/ à toa (regressão de comportamento externo).
  const priorState = "state" in opts ? opts.state : await openState(targetDir, { mode: "mutate" });
  if (!priorState) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const prior = priorState.manifest;
  // Fonte do formato é maker.config.json do alvo, não a config renderizada (que vem do manifest ou
  // do --config recuperado): o update não lê esse arquivo para renderizar, só para o formato.
  const configured = await configuredFormatOrAbort(targetDir);
  const effective = effectiveBasesFormat(configured, priorState.recorded, priorState.inUse);
  const configWarning = configured.kind === "unreadable"
    ? `maker.config.json ilegível (${configured.message.replace(/^maker\.config\.json ilegível: /, "")}); formato das bases mantido (${effective.format}) — corrija o arquivo para escolher o formato`
    : undefined;
  const { config, recovered } = await resolveConfig(targetDir, prior.config, prior.project);
  const agents = enabledAgents(prior);
  const staging = await mkdtemp(join(tmpdir(), "maker-update-plan-"));
  const changes: PlannedChange[] = [];
  const bases = new Map<string, Buffer>();
  let reports: LegacyAgentReport[] = [];
  const unresolved: string[] = [];
  const defaulted: string[] = [];
  const mediation: MediationCandidate[] = [];
  const next: Manifest = structuredClone(prior);
  next.files = { ...prior.files };
  try {
    const ctx = buildContext(config, prior.installedAt);
    const expected = await applyEngine(staging, ctx, agents);
    const configDependent = recovered ? new Set<string>() : await configDependentFiles(expected, config, agents, prior.installedAt);
    const migration = await planLegacyAddonAgents(targetDir, staging, expected, next,
      { ctx, migrate: opts.merge !== false, configKnown: recovered, configDependent });
    changes.push(...migration.changes);
    reports = migration.reports;
    for (const [hash, content] of migration.bases) bases.set(hash, content);
    for (const file of expected.sort((a, b) => a.rel.localeCompare(b.rel))) {
      if (migration.handled.has(file.rel)) continue;
      const upstream = await readFile(join(staging, file.rel));
      const upstreamHash = sha256(upstream);
      const current = await inspectTarget(targetDir, file.rel);
      const recorded = prior.files[file.rel];
      const mediate = async (category: MediationCategory, reason: string, baseHash?: string) => {
        mediation.push({ path: file.rel, source: recorded?.source ?? file.entry.source, engineSource: file.entry.source,
          category, reason, local: current.content ?? null, base: baseHash ? priorState.readBase(baseHash) : null, upstream });
      };
      const preserve = (reason: string, action: "preserve" | "conflict" = "preserve") =>
        changes.push(status(action, file.rel, file.entry.source, current, reason));
      if (recorded?.source.startsWith("addon:")) {
        if (current.kind !== "file") {
          preserve("arquivo controlado por add-on");
        } else if (configDependent.has(file.rel)) {
          preserve(CONFIG_UNKNOWN);
          unresolved.push(file.rel);
        } else {
          // Os blocos de add-on são tratados como edições locais: o template segue o mesmo 3-way merge
          // dos demais arquivos, e só o que o merge não resolve vai para mediação.
          const local = current.content!.toString("utf-8");
          if (sameText(reinjectBlocks(file.rel, upstream.toString("utf-8"), local), local)) {
            preserve(UP_TO_DATE_ADDON);
            next.files[file.rel] = { ...withoutEdited(recorded), baseHash: upstreamHash };
          } else if (recorded.baseHash === upstreamHash) {
            preserve("arquivo controlado por add-on; customizações locais sobre o template atual");
          } else if (opts.merge === false) {
            preserve("arquivo controlado por add-on; merge desabilitado");
            await mediate("addon", "template novo em arquivo controlado por add-on; merge desabilitado", recorded.baseHash);
          } else {
            // Sem base registrada (add-on aplicado pela 0.2.x), o template 0.2.x empacotado é a base exata.
            const legacy = !recorded.baseHash && recovered ? await legacyBase(ctx, file.rel) : undefined;
            const base = recorded.baseHash ? priorState.readBase(recorded.baseHash) : legacy ? Buffer.from(legacy) : null;
            // Sem customização além dos blocos: reinjeta-os no template novo. O diff3 acusaria conflito
            // quando o template muda na mesma região onde o bloco foi inserido (ex.: fim do papel).
            const reinjected = base && sameText(reinjectBlocks(file.rel, base.toString("utf-8"), local), local)
              ? Buffer.from(reinjectBlocks(file.rel, upstream.toString("utf-8"), local)) : null;
            const merged = reinjected ?? (base ? mergeText(current.content!, base, upstream) : null);
            if (merged && sameBlocks(local, merged.toString("utf-8"))) {
              changes.push(mergeChange(await planWrite({ targetDir, path: file.rel, content: merged, source: recorded.source,
                reason: "template novo mesclado preservando os blocos de add-on", force: true })));
              next.files[file.rel] = { ...withoutEdited(recorded), hash: sha256(merged), baseHash: upstreamHash };
            } else {
              const reason = base ? "template novo e customizações na mesma região de um arquivo de add-on"
                : "arquivo controlado por add-on sem base exata para o template novo";
              preserve(reason);
              await mediate("addon", reason, recorded.baseHash);
            }
          }
        }
      } else if (current.kind === "other") {
        preserve("o caminho não é um arquivo regular", "conflict");
      } else if (current.kind === "absent") {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "arquivo gerenciado ausente" }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
        if (configDependent.has(file.rel)) defaulted.push(file.rel);
      } else if (current.hash === upstreamHash) {
        preserve("já está atualizado");
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (configDependent.has(file.rel) || configDependent.has(sharedRoleOf(file.rel))) {
        preserve(CONFIG_UNKNOWN);
        unresolved.push(file.rel);
      } else if (!recorded && (GIT_CONTROL_FILES as readonly string[]).includes(file.rel)) {
        // Arquivo de controle do git pré-existente e ainda não rastreado, com conteúdo diferente do
        // upstream — nunca sobrescrito; vai para mediação com base nula (não há versão anterior
        // conhecida do maker para essa cópia).
        const reason = "arquivo pré-existente não rastreado pelo maker";
        preserve(reason);
        await mediate("local-edit", reason);
      } else if (!recorded || (!recorded.edited && current.hash === (recorded.baseHash ?? recorded.hash)) ||
          (recorded.edited && await matchesRemovedTemplate(file.rel, current.content!, upstream, recovered ? ctx : undefined))) {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "nova versão upstream", force: true }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (opts.merge === false) {
        preserve("edição local; merge desabilitado");
        await mediate("local-edit", "edição local; merge desabilitado", recorded.baseHash);
      } else if (!recorded.baseHash) {
        preserve("edição local em manifest legado sem base exata");
        await mediate("local-edit", "edição local sem base exata");
      } else {
        const base = priorState.readBase(recorded.baseHash);
        const merged = base ? mergeText(current.content!, base, upstream) : null;
        if (!base) {
          preserve("base histórica ausente; preservado por segurança");
          await mediate("local-edit", "base histórica ausente");
        } else if (!merged) {
          preserve("mudanças locais e upstream na mesma região", "conflict");
          await mediate("conflict", "mudanças locais e upstream na mesma região", recorded.baseHash);
        } else {
          changes.push(mergeChange(await planWrite({ targetDir, path: file.rel, content: merged, source: file.entry.source, reason: "mudanças locais e upstream mescladas", force: true })));
          next.files[file.rel] = manifestEntry(file.entry, sha256(merged), upstreamHash);
        }
      }
      // Só grava a base que o manifest passa a referenciar; senão o próximo update a removeria.
      if (next.files[file.rel]?.baseHash === upstreamHash) {
        bases.set(upstreamHash, upstream);
      }
    }
    // Agentes parados só por falta de config migram sozinhos quando ela existir: não são mediação.
    const degraded = reports.filter((report) => report.status === "degraded" && !report.reason.startsWith(CONFIG_UNKNOWN))
      .map((report) => report.path);
    await groupLegacyAgents(targetDir, staging, expected, prior, mediation, degraded, priorState, recovered ? ctx : undefined);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  next.schemaVersion = 3;
  next.agents = agents;
  if (next.config || recovered) next.config = config;
  next.makerVersion = makerVersion();
  // Só as bases ainda referenciadas pelo manifest final entram no armazenamento; o resto é podado. Uma
  // base referenciada cujo conteúdo não pôde ser lido (corrompida) fica de fora de `finalBases`, mas
  // continua em `referencedBases`: é achado de diagnóstico do doctor, a poda nunca a remove do disco.
  const referencedBases = new Set(Object.values(next.files).flatMap((item) => item.baseHash ? [item.baseHash] : []));
  const finalBases = new Map<string, Buffer>();
  for (const hash of referencedBases) {
    const content = bases.get(hash) ?? priorState.readBase(hash);
    if (content) finalBases.set(hash, content);
  }
  // O update sempre grava o formato efetivo: registrado nunca fica "esquecido" atrás da config.
  const transition = planFormatTransition(priorState, effective, referencedBases);
  // Sem transição, o lockfile em pack ainda é regravado (planStateWrite/serializeLockfile só
  // reproduz o que verificou): entradas que não verificaram somem do arquivo — nunca em silêncio.
  const invalidEntries = !transition && effective.format === "pack"
    ? priorState.problems.filter((problem) => problem.origin === "pack" && !problem.recovered)
    : [];
  next.basesFormat = effective.format;
  changes.push(...await planStateWrite(priorState, targetDir, {
    manifest: next, format: effective.format, bases: finalBases, consolidate: true, prune: true, preserve: referencedBases,
  }));
  const plan = createPlan(targetDir, changes);
  const reported = new Set(reports.map((report) => report.path));
  for (const change of plan.changes) {
    if (change.action !== "preserve" || !/^\.(claude|codex)\/agents\//.test(change.path) || reported.has(change.path)) continue;
    const current = await inspectTarget(targetDir, change.path);
    if (current.kind === "file" && !sharedRoleReference(current.content!.toString("utf-8"))) {
      const role = change.path.split("/").at(-1)!.replace(/\.(md|toml)$/, "");
      reports.push({ path: change.path, sharedPath: `.maker/workflow/agents/${role}.md`, status: "degraded",
        reason: `${change.reason}; sem referência ao papel compartilhado`,
        action: change.reason === CONFIG_UNKNOWN
          ? CONFIG_ACTION
          : "revise o conteúdo local, leve-o para o papel compartilhado e restaure o adapter gerado (maker update --export e a skill maker-update ajudam)" });
    }
  }
  return { plan, reports, mediation, unresolved, defaulted, config, recovered, transition, configWarning, invalidEntries };
}

/**
 * Arquivo marcado como editado por um `remove` feito sem config: com a config disponível, é reavaliado
 * contra os templates conhecidos como o `remove` os deixaria; sem customização, recebe o upstream.
 */
async function matchesRemovedTemplate(path: string, content: Buffer, upstream: Buffer, ctx?: RenderContext): Promise<boolean> {
  if (!ctx) return false;
  const role = path.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
  const templates = [upstream.toString("utf-8"), ...(role ? [await legacyAgent(ctx, role)] : [])].filter((t): t is string => !!t);
  const text = content.toString("utf-8");
  return templates.some((template) => sameText(text, afterBlockRemoval(path, template)) || sameText(text, template));
}

/** Merge cujo resultado já é o conteúdo atual não é anunciado como mesclado. */
function mergeChange(change: PlannedChange): PlannedChange {
  if (change.action !== "preserve") change.resolution = "merge";
  return change;
}

function withoutEdited(entry: ManifestEntry): ManifestEntry {
  const { edited: _edited, ...rest } = entry;
  return rest;
}

/** O merge não pode alterar nem perder blocos de add-on. */
function sameBlocks(before: string, after: string): boolean {
  const a = addonBlocks(before);
  const b = addonBlocks(after);
  return a.size === b.size && [...a].every(([id, content]) => b.get(id) === content);
}

export function skillInstalled(targetDir: string): boolean {
  return existsSync(join(targetDir, ".claude/skills/maker-update/SKILL.md")) ||
    existsSync(join(targetDir, ".agents/skills/maker-update/SKILL.md"));
}

/** Uma linha por agente legado e, se algum ficou degradado, um bloco único de ação recomendada. */
function printAgentReports(reports: LegacyAgentReport[], phase: "planejado" | "aplicado"): void {
  if (!reports.length) return;
  console.log(pc.bold(`Agentes legados (${phase}):`));
  for (const report of reports) {
    if (report.status === "migrated" || report.status === "adapter") {
      const verb = phase === "planejado" ? "migrar" : "migrado";
      const target = report.status === "migrated" ? ` → ${report.sharedPath}` : " (só o adapter)";
      console.log(pc.cyan(`  ${verb}   ${report.path}${target}: ${report.reason}`));
    } else if (report.status === "pending") {
      console.log(pc.dim(`  pendente ${report.path} → ${report.sharedPath}: ${report.reason}; não migrado com --no-merge`));
    } else {
      console.log(pc.yellow(`  degradado ${report.path}: ${report.reason}`));
    }
  }
  const actions = [...new Set(reports.flatMap((report) => report.action ? [report.action] : []))];
  if (reports.some((report) => report.status === "pending")) actions.push("execute maker update sem --no-merge para migrar os agentes pendentes");
  if (!actions.length) return;
  console.log(pc.yellow("Ação recomendada para os agentes que continuam sem referência ao papel compartilhado:"));
  for (const action of actions) console.log(pc.yellow(`  - ${action}`));
}

/**
 * Sem config registrada (manifests 0.2.x, que não a persistiam), os padrões só são fiéis para
 * arquivos que não dependem dela: renderiza também com valores sentinela e compara.
 */
async function configDependentFiles(expected: AppliedFile[], config: MakerConfig, agents: AgentProvider[], installedAt: string): Promise<Set<string>> {
  const staging = await mkdtemp(join(tmpdir(), "maker-update-config-"));
  try {
    const probe = new Map((await applyEngine(staging, buildContext(sentinelConfig(config), installedAt), agents)).map((file) => [file.rel, file.entry.hash]));
    return new Set(expected.filter((file) => probe.get(file.rel) !== file.entry.hash).map((file) => file.rel));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Troca toda folha de texto da config por um sentinela, para que campos novos do schema entrem na
 * detecção sem manutenção. `project` (conhecido pelo manifest), `agent` (enum) e `state` (o enum de
 * `state.bases` rejeitaria o sentinela, e o formato das bases não afeta o conteúdo renderizado) ficam
 * como estão.
 */
export function sentinelConfig(config: MakerConfig): MakerConfig {
  const replace = (value: unknown, path: string): unknown => {
    if (typeof value === "string") return `maker-sentinel-${path}`;
    if (Array.isArray(value)) return value.length ? value.map((item, index) => replace(item, `${path}-${index}`)) : [`maker-sentinel-${path}`];
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item, path ? `${path}-${key}` : key)]));
    }
    return value;
  };
  const { project, agent, state, ...rest } = config;
  return parseConfig({ ...(replace(rest, "") as object), project, agent, state });
}

/**
 * Papel compartilhado de um adapter Claude. Na 0.2.x o agente completo carregava o corpo renderizado
 * do papel: trocá-lo pelo adapter levaria esse conteúdo para um papel renderizado com os padrões.
 */
function sharedRoleOf(path: string): string {
  const role = path.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
  return role ? `.maker/workflow/agents/${role}.md` : "";
}

/**
 * Agente Claude sem referência ao papel compartilhado: o adapter e o papel são mediados juntos,
 * para as customizações do corpo legado irem para o papel e o adapter voltar ao formato gerado.
 */
async function groupLegacyAgents(targetDir: string, staging: string, expected: AppliedFile[], prior: Manifest,
  mediation: MediationCandidate[], degraded: string[], state: InstallState, ctx?: RenderContext): Promise<void> {
  const engineSources = new Map(expected.map((file) => [file.rel, file.entry.source]));
  const adapters = new Set(degraded);
  for (const candidate of mediation) {
    if (sharedRoleOf(candidate.path) && candidate.local && !sharedRoleReference(candidate.local.toString("utf-8"))) adapters.add(candidate.path);
  }
  for (const adapter of [...adapters].sort()) {
    const shared = sharedRoleOf(adapter);
    if (!shared || !engineSources.has(adapter) || !engineSources.has(shared)) continue;
    // Base do agente legado: o agente completo que a 0.2.x gerava, para separar customizações da evolução do template.
    const role = adapter.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)![1]!;
    const legacy = ctx ? await legacyAgent(ctx, role) : undefined;
    for (const path of [adapter, shared]) {
      const existing = mediation.find((candidate) => candidate.path === path);
      if (existing) {
        existing.category = "legacy-agent";
        existing.group = adapter;
        if (path === adapter && !existing.base && legacy) existing.base = Buffer.from(legacy);
        continue;
      }
      const current = await inspectTarget(targetDir, path);
      if (current.kind === "other") continue;
      const recorded = prior.files[path];
      mediation.push({ path, source: recorded?.source ?? engineSources.get(path)!, engineSource: engineSources.get(path)!,
        category: "legacy-agent", group: adapter,
        reason: path === adapter ? "agente legado sem referência ao papel compartilhado" : "papel compartilhado do agente legado",
        local: current.content ?? null,
        base: path === adapter ? (legacy ? Buffer.from(legacy) : null) : recorded?.baseHash ? state.readBase(recorded.baseHash) : null,
        upstream: await readFile(join(staging, path)) });
    }
  }
}

function manifestEntry(source: ManifestEntry, hash: string, baseHash: string): ManifestEntry {
  return { ...source, hash, baseHash };
}

function status(action: "preserve" | "conflict", path: string, source: string, current: Awaited<ReturnType<typeof inspectTarget>>, reason: string): PlannedChange {
  return { path, action, source, reason, expectedHash: current.hash, expectedKind: current.kind };
}


export function mergeText(local: Buffer, base: Buffer, upstream: Buffer): Buffer | null {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let values: string[];
  try { values = [decoder.decode(local), decoder.decode(base), decoder.decode(upstream)]; } catch { return null; }
  if (values.some((value) => value.includes("\0"))) return null;
  const split = (value: string): string[] => value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const result = mergeDiff3(split(values[0]!), split(values[1]!), split(values[2]!), {
    excludeFalseConflicts: true,
    label: { a: "local", o: "base", b: "upstream" },
  });
  return result.conflict ? null : Buffer.from(result.result.join(""), "utf-8");
}
