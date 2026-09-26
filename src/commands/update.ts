import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { mergeDiff3 } from "node-diff3";
import { parseConfig, type MakerConfig } from "../config/schema.js";
import { buildContext } from "../render/engine.js";
import { enabledAgents, readManifest, sha256, type Manifest, type ManifestEntry } from "../render/manifest.js";
import { applyEngine } from "../util/engine-scaffold.js";
import { makerVersion } from "../util/version.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan, assertNoPendingTransactions } from "../changes/transaction.js";
import { planLegacyAddonAgents } from "../agents/migrate.js";

export interface UpdateOptions { target?: string; dryRun?: boolean; merge?: boolean }

export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  if (opts.dryRun) await assertNoPendingTransactions(targetDir);
  const prior = await readManifest(targetDir);
  if (!prior) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const { config, recovered } = await resolveConfig(targetDir, prior.config, prior.project);
  const agents = enabledAgents(prior);
  const staging = await mkdtemp(join(tmpdir(), "maker-update-plan-"));
  const changes: PlannedChange[] = [];
  const messages: string[] = [];
  const next: Manifest = structuredClone(prior);
  next.files = { ...prior.files };
  try {
    const expected = await applyEngine(staging, buildContext(config), agents);
    const migration = await planLegacyAddonAgents(targetDir, staging, expected, next);
    changes.push(...migration.changes);
    messages.push(...migration.messages);
    for (const file of expected.sort((a, b) => a.rel.localeCompare(b.rel))) {
      if (migration.handled.has(file.rel)) continue;
      const upstream = await readFile(join(staging, file.rel));
      const upstreamHash = sha256(upstream);
      const current = await inspectTarget(targetDir, file.rel);
      const recorded = prior.files[file.rel];
      changes.push(await planWrite({ targetDir, path: `.maker/bases/${upstreamHash}`, content: upstream, source: "metadata", reason: `base upstream de ${file.rel}` }));
      if (recorded?.source.startsWith("addon:")) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "arquivo controlado por add-on"));
      } else if (current.kind === "other") {
        changes.push(status("conflict", file.rel, file.entry.source, current, "o caminho não é um arquivo regular"));
      } else if (current.kind === "absent") {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "arquivo gerenciado ausente" }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (current.hash === upstreamHash) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "já está atualizado"));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (!recorded || current.hash === (recorded.baseHash ?? recorded.hash)) {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "nova versão upstream", force: true }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (opts.merge === false) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "edição local; merge desabilitado"));
      } else if (!recorded.baseHash) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "edição local em manifest legado sem base exata"));
      } else {
        const base = await readBase(targetDir, recorded.baseHash);
        const merged = base ? mergeText(current.content!, base, upstream) : null;
        if (!base) {
          changes.push(status("preserve", file.rel, file.entry.source, current, "base histórica ausente; preservado por segurança"));
        } else if (!merged) {
          changes.push(status("conflict", file.rel, file.entry.source, current, "mudanças locais e upstream na mesma região"));
        } else {
          const change = await planWrite({ targetDir, path: file.rel, content: merged, source: file.entry.source, reason: "mudanças locais e upstream mescladas", force: true });
          change.resolution = "merge";
          changes.push(change);
          next.files[file.rel] = manifestEntry(file.entry, sha256(merged), upstreamHash);
        }
      }
    }
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
  for (const change of plan.changes) {
    if (change.action !== "preserve" || !/^\.(claude|codex)\/agents\//.test(change.path) ||
        messages.some((message) => message.startsWith(`${change.path} [`))) continue;
    const current = await inspectTarget(targetDir, change.path);
    if (current.kind === "file" && !/\.maker\/workflow\/agents\/[a-z0-9-]+\.md/.test(current.content!.toString("utf-8"))) {
      const role = change.path.split("/").at(-1)!.replace(/\.(md|toml)$/, "");
      messages.push(`${change.path}: preservado (${change.reason}); integração continuará degradada: ` +
        `referência ausente a .maker/workflow/agents/${role}.md. Revise o conteúdo local antes de converter o adapter.`);
    }
  }
  for (const message of messages) console.log(pc.yellow(message));
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    if (plan.changes.some((change) => change.action === "conflict")) process.exitCode = 1;
    return;
  }
  await applyChangePlan(plan);
  const merged = plan.changes.filter((change) => change.resolution === "merge").length;
  const updated = plan.changes.filter((change) => (change.action === "update" || change.action === "create") && !change.path.startsWith(".maker/") && change.resolution !== "merge").length;
  const preserved = plan.changes.filter((change) => change.action === "preserve" && !change.path.startsWith(".maker/") && change.reason !== "já está atualizado").length;
  console.log(pc.green(`✓ ${updated} arquivo(s) atualizado(s), ${merged} mesclado(s).`));
  if (preserved) console.log(pc.yellow(`${preserved} preservado(s) por segurança.`));
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

async function resolveConfig(targetDir: string, stored: MakerConfig | undefined, project: { name: string; slug: string }): Promise<{ config: MakerConfig; recovered: boolean }> {
  if (stored) return { config: parseConfig(stored), recovered: true };
  const configPath = join(targetDir, "maker.config.json");
  if (existsSync(configPath)) return { config: parseConfig(JSON.parse(await readFile(configPath, "utf-8"))), recovered: true };
  return { config: parseConfig({ project }), recovered: false };
}
