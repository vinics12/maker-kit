import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { mergeDiff3 } from "node-diff3";
import { parseConfig, type AgentProvider, type MakerConfig } from "../config/schema.js";
import { buildContext, type RenderContext } from "../render/engine.js";
import { enabledAgents, readManifest, sha256, type Manifest, type ManifestEntry } from "../render/manifest.js";
import { applyEngine, legacyAgent } from "../util/engine-scaffold.js";
import type { AppliedFile } from "../util/scaffold.js";
import { makerVersion } from "../util/version.js";
import { resolveConfig } from "../util/upstream.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type ChangePlan, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan, assertNoPendingTransactions } from "../changes/transaction.js";
import { planLegacyAddonAgents, type LegacyAgentReport } from "../agents/migrate.js";
import { sharedRoleReference } from "../agents/reference.js";
import { reinjectBlocks } from "../addons/apply.js";
import { addonBlocks, sameText } from "../addons/inject.js";
import { applyResolutions, exportMediation, mediationHint, type MediationCandidate, type MediationCategory } from "./mediation.js";

const CONFIG_UNKNOWN = "depende de config não recuperada";
const CONFIG_ACTION = "crie maker.config.json com os valores usados no init e execute maker update --dry-run";

export interface UpdateOptions {
  target?: string;
  dryRun?: boolean;
  merge?: boolean;
  /** Exporta o que precisa de mediação (base/local/upstream) sem aplicar o update. */
  export?: string | true;
  /** Aplica as propostas escritas sobre uma exportação. */
  applyResolutions?: string | true;
}

/** Resultado do planejamento, sem escrever nada: usado pelo update, pela mediação e pelo doctor. */
export interface UpdatePlanning {
  plan: ChangePlan;
  reports: LegacyAgentReport[];
  mediation: MediationCandidate[];
  unresolved: string[];
  defaulted: string[];
  config: MakerConfig;
  recovered: boolean;
}

export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  if (opts.export && opts.applyResolutions) throw new Error("Use --export ou --apply-resolutions, não os dois juntos.");
  if (opts.dryRun || opts.export) await assertNoPendingTransactions(targetDir);
  const planning = await planUpdate(targetDir, { merge: opts.merge });
  const { plan, reports, mediation, unresolved, defaulted, config, recovered } = planning;
  if ((opts.export || opts.applyResolutions) && !recovered) {
    throw new Error("Config do projeto não recuperada: crie maker.config.json com os valores usados no init antes de mediar o update.");
  }
  // A mediação usa os candidatos recalculados agora, não o que o índice exportado declara.
  if (opts.applyResolutions) return applyResolutions(targetDir, opts.applyResolutions, config, mediation, { dryRun: opts.dryRun });
  if (opts.export) return exportMediation(targetDir, opts.export, mediation, config);

  if (unresolved.length || defaulted.length) {
    // A 0.2.x não persistia a config: sem maker.config.json no projeto não há fonte fiel.
    console.log(pc.yellow("Config do projeto não recuperada (manifest sem config e sem maker.config.json):"));
    if (unresolved.length) console.log(pc.yellow(`  ${unresolved.length} arquivo(s) existente(s) que dependem dela preservado(s): ${unresolved.join(", ")}`));
    if (defaulted.length) console.log(pc.yellow(`  ${defaulted.length} arquivo(s) ausente(s) criado(s) com valores padrão: ${defaulted.join(", ")}`));
    console.log(pc.yellow("Ação recomendada: crie maker.config.json com os valores usados no init e execute maker update --dry-run; os arquivos acima são então renderizados com ela."));
  }
  const conflicted = plan.changes.some((change) => change.action === "conflict");
  if (mediation.length) {
    console.log(pc.yellow(mediationHint(mediation.length, {
      configKnown: recovered, skillInstalled: skillInstalled(targetDir), updateBlocked: conflicted && !opts.dryRun })));
  }
  if (opts.dryRun) {
    printAgentReports(reports, "planejado");
    console.log(formatPlan(plan));
    if (conflicted) process.exitCode = 1;
    return;
  }
  // Aplica antes de relatar: com conflito a transação é recusada e nenhuma migração acontece.
  await applyChangePlan(plan);
  printAgentReports(reports, "aplicado");
  const merged = plan.changes.filter((change) => change.resolution === "merge").length;
  const updated = plan.changes.filter((change) => (change.action === "update" || change.action === "create") && change.source !== "metadata" && change.resolution !== "merge").length;
  const preserved = plan.changes.filter((change) => change.action === "preserve" && change.source !== "metadata" && change.reason !== "já está atualizado").length;
  console.log(pc.green(`✓ ${updated} arquivo(s) atualizado(s), ${merged} mesclado(s).`));
  if (preserved) console.log(pc.yellow(`${preserved} preservado(s) por segurança.`));
  if (reports.length) {
    const migrated = reports.filter((report) => report.status === "migrated" || report.status === "adapter").length;
    const degraded = reports.length - migrated;
    console.log((degraded ? pc.yellow : pc.green)(`${migrated} agente(s) migrado(s), ${degraded} permanece(m) degradado(s).`));
  }
}

export async function planUpdate(targetDir: string, opts: { merge?: boolean } = {}): Promise<UpdatePlanning> {
  const prior = await readManifest(targetDir);
  if (!prior) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const { config, recovered } = await resolveConfig(targetDir, prior.config, prior.project);
  const agents = enabledAgents(prior);
  const staging = await mkdtemp(join(tmpdir(), "maker-update-plan-"));
  const changes: PlannedChange[] = [];
  let reports: LegacyAgentReport[] = [];
  const unresolved: string[] = [];
  const defaulted: string[] = [];
  const mediation: MediationCandidate[] = [];
  const next: Manifest = structuredClone(prior);
  next.files = { ...prior.files };
  try {
    const ctx = buildContext(config);
    const expected = await applyEngine(staging, ctx, agents);
    const configDependent = recovered ? new Set<string>() : await configDependentFiles(expected, config, agents);
    const migration = await planLegacyAddonAgents(targetDir, staging, expected, next,
      { ctx, migrate: opts.merge !== false, configKnown: recovered, configDependent });
    changes.push(...migration.changes);
    reports = migration.reports;
    for (const file of expected.sort((a, b) => a.rel.localeCompare(b.rel))) {
      if (migration.handled.has(file.rel)) continue;
      const upstream = await readFile(join(staging, file.rel));
      const upstreamHash = sha256(upstream);
      const current = await inspectTarget(targetDir, file.rel);
      const recorded = prior.files[file.rel];
      const mediate = async (category: MediationCategory, reason: string, baseHash?: string) => {
        mediation.push({ path: file.rel, source: recorded?.source ?? file.entry.source, engineSource: file.entry.source,
          category, reason, local: current.content ?? null, base: baseHash ? await readBase(targetDir, baseHash) : null, upstream });
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
            preserve("arquivo controlado por add-on; template atual com os blocos");
            next.files[file.rel] = { ...withoutEdited(recorded), baseHash: upstreamHash };
          } else if (recorded.baseHash === upstreamHash) {
            preserve("arquivo controlado por add-on; customizações locais sobre o template atual");
          } else if (opts.merge === false) {
            preserve("arquivo controlado por add-on; merge desabilitado");
            await mediate("addon", "template novo em arquivo controlado por add-on; merge desabilitado", recorded.baseHash);
          } else {
            const base = recorded.baseHash ? await readBase(targetDir, recorded.baseHash) : null;
            const merged = base ? mergeText(current.content!, base, upstream) : null;
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
      } else if (!recorded || (!recorded.edited && current.hash === (recorded.baseHash ?? recorded.hash))) {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "nova versão upstream", force: true }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (opts.merge === false) {
        preserve("edição local; merge desabilitado");
        await mediate("local-edit", "edição local; merge desabilitado", recorded.baseHash);
      } else if (!recorded.baseHash) {
        preserve("edição local em manifest legado sem base exata");
        await mediate("local-edit", "edição local sem base exata");
      } else {
        const base = await readBase(targetDir, recorded.baseHash);
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
        changes.push(await planWrite({ targetDir, path: `.maker/bases/${upstreamHash}`, content: upstream, source: "metadata", reason: `base upstream de ${file.rel}` }));
      }
    }
    const degraded = reports.filter((report) => report.status === "degraded").map((report) => report.path);
    await groupLegacyAgents(targetDir, staging, expected, prior, mediation, degraded, recovered ? ctx : undefined);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  next.schemaVersion = 3;
  next.agents = agents;
  if (next.config || recovered) next.config = config;
  next.makerVersion = makerVersion();
  const referencedBases = new Set(Object.values(next.files).flatMap((item) => item.baseHash ? [item.baseHash] : []));
  for (const hash of await listBases(targetDir)) {
    if (referencedBases.has(hash)) continue;
    const path = `.maker/bases/${hash}`;
    const current = await inspectTarget(targetDir, path);
    changes.push({ path, action: "remove", source: "metadata", reason: "base upstream não referenciada", expectedHash: current.hash, expectedKind: current.kind });
  }
  changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(next, null, 2) + "\n", source: "metadata", reason: "publicar manifest atualizado", force: true }));
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
  return { plan, reports, mediation, unresolved, defaulted, config, recovered };
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

function skillInstalled(targetDir: string): boolean {
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
 * arquivos que não dependem dela: renderiza com valores sentinela e compara.
 */
async function configDependentFiles(expected: AppliedFile[], config: MakerConfig, agents: AgentProvider[]): Promise<Set<string>> {
  const staging = await mkdtemp(join(tmpdir(), "maker-update-config-"));
  try {
    const sentinel = parseConfig({ ...config,
      layout: { frontendGlobs: ["maker-sentinel-frontend/**"], backendGlobs: ["maker-sentinel-backend/**"] },
      commands: { verify: "maker-sentinel verify", build: "maker-sentinel build", test: "maker-sentinel test", dev: "maker-sentinel dev" } });
    const probe = new Map((await applyEngine(staging, buildContext(sentinel), agents)).map((file) => [file.rel, file.entry.hash]));
    return new Set(expected.filter((file) => probe.get(file.rel) !== file.entry.hash).map((file) => file.rel));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
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
  mediation: MediationCandidate[], degraded: string[], ctx?: RenderContext): Promise<void> {
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
        base: path === adapter ? (legacy ? Buffer.from(legacy) : null) : recorded?.baseHash ? await readBase(targetDir, recorded.baseHash) : null,
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

async function readBase(targetDir: string, hash: string): Promise<Buffer | null> {
  try {
    const content = await readFile(join(targetDir, ".maker", "bases", hash));
    return sha256(content) === hash ? content : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listBases(targetDir: string): Promise<string[]> {
  try {
    return (await readdir(join(targetDir, ".maker", "bases")))
      .filter((name) => /^[a-f0-9]{64}$/.test(name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
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
