import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { z } from "zod";
import { addonStateSchema, type AddonState } from "../addons/state.js";
import { sharedRoleReference } from "../agents/reference.js";
import { createPlan, formatPlan, inspectTarget, planWrite, type PlannedChange } from "../changes/plan.js";
import { applyChangePlan, assertNoPendingTransactions } from "../changes/transaction.js";
import { readManifest, sha256 } from "../render/manifest.js";
import { makerVersion } from "../util/version.js";

/**
 * Mediação de update: o que o merge automático não resolve (conflitos, customizações sem base
 * exata, alvos de add-on com template novo, agentes legados degradados) é exportado com as versões
 * base/local/upstream para um agente (skill maker-update) propor o conteúdo final. O maker valida
 * e aplica as propostas na mesma transação do update; o agente nunca escreve nos arquivos gerenciados.
 */
export const DEFAULT_MEDIATION_DIR = ".maker/mediation";
const INDEX = "mediation.json";

export type MediationCategory = "conflict" | "local-edit" | "addon" | "legacy-agent";

export interface MediationCandidate {
  path: string;
  /** Origem registrada no manifest (preservada ao aplicar, exceto em agentes legados). */
  source: string;
  /** Origem que o engine atribui ao caminho. */
  engineSource: string;
  category: MediationCategory;
  reason: string;
  /** Itens do mesmo grupo são resolvidos juntos (adapter legado + papel compartilhado). */
  group?: string;
  local: Buffer | null;
  base: Buffer | null;
  upstream: Buffer;
}

const itemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  path: z.string().min(1),
  category: z.enum(["conflict", "local-edit", "addon", "legacy-agent"]),
  reason: z.string(),
  group: z.string().nullable(),
  source: z.string(),
  engineSource: z.string(),
  localHash: z.string().nullable(),
  baseHash: z.string().nullable(),
  upstreamHash: z.string(),
});
const indexSchema = z.object({
  format: z.literal(1),
  makerVersion: z.string(),
  configHash: z.string(),
  items: z.array(itemSchema),
});
type MediationItem = z.infer<typeof itemSchema>;

const ADDON_MARKER = /<!-- maker:addon:([a-z0-9-]+):(start|end) -->/g;
const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

export function configHash(config: unknown): string {
  return sha256(Buffer.from(JSON.stringify(config)));
}

export function mediationHint(count: number): string {
  return `${count} arquivo(s) precisam de mediação (conflitos ou customizações que o merge automático não resolve): ` +
    "use a skill /maker-update no Claude Code ($maker-update no Codex) ou maker update --export para revisar com base/local/upstream.";
}

export async function exportMediation(
  targetDir: string,
  dirOption: string | true,
  candidates: MediationCandidate[],
  config: unknown,
): Promise<void> {
  const dir = resolve(targetDir, dirOption === true ? DEFAULT_MEDIATION_DIR : dirOption);
  if (existsSync(dir)) {
    const entries = await readdir(dir);
    if (entries.length && !entries.includes(INDEX)) {
      throw new Error(`${dir} já existe e não é uma exportação do maker; escolha outro diretório.`);
    }
    await rm(dir, { recursive: true, force: true });
  }
  const shown = dirOption === true ? DEFAULT_MEDIATION_DIR : dirOption;
  if (!candidates.length) {
    console.log(pc.green("Nada a mediar: o update resolve tudo automaticamente."));
    return;
  }
  await mkdir(join(dir, "items"), { recursive: true });
  const items: MediationItem[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const id = `${String(index + 1).padStart(3, "0")}-${candidate.path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;
    const itemDir = join(dir, "items", id);
    await mkdir(itemDir, { recursive: true });
    await writeFile(join(itemDir, "upstream"), candidate.upstream);
    if (candidate.local) await writeFile(join(itemDir, "local"), candidate.local);
    if (candidate.base) await writeFile(join(itemDir, "base"), candidate.base);
    items.push({
      id, path: candidate.path, category: candidate.category, reason: candidate.reason,
      group: candidate.group ?? null, source: candidate.source, engineSource: candidate.engineSource,
      localHash: candidate.local ? sha256(candidate.local) : null,
      baseHash: candidate.base ? sha256(candidate.base) : null,
      upstreamHash: sha256(candidate.upstream),
    });
  }
  const index = { format: 1 as const, makerVersion: makerVersion(), configHash: configHash(config), items };
  await writeFile(join(dir, INDEX), JSON.stringify(index, null, 2) + "\n");
  await writeFile(join(dir, "README.md"), [
    "# Mediação de update do maker",
    "",
    "Cada item em `items/<id>/` traz `upstream` (nova versão), `local` (conteúdo atual, se existir) e",
    "`base` (versão upstream de onde o local partiu, se conhecida). Escreva a proposta final em",
    "`items/<id>/resolved` e, opcionalmente, a justificativa em `items/<id>/notes.md`.",
    "Itens com o mesmo `group` em `mediation.json` são resolvidos juntos.",
    "",
    "Revise e aplique com `maker update --apply-resolutions" + (dirOption === true ? "" : ` ${dirOption}`) + " --dry-run` e depois sem `--dry-run`.",
    "A skill `maker-update` conduz esse fluxo.",
    "",
  ].join("\n"));
  console.log(pc.bold(`${items.length} item(ns) exportado(s) para mediação em ${shown}:`));
  for (const item of items) {
    console.log(`  ${item.id}  ${item.path} [${item.category}${item.group ? `, grupo ${item.group}` : ""}] — ${item.reason}`);
  }
  console.log(pc.yellow(`Escreva items/<id>/resolved e aplique com maker update --apply-resolutions${dirOption === true ? "" : ` ${shown}`}.`));
}

export interface ApplyResolutionsOptions { dryRun?: boolean }

export async function applyResolutions(
  targetDir: string,
  dirOption: string | true,
  currentConfig: unknown,
  opts: ApplyResolutionsOptions,
): Promise<void> {
  if (opts.dryRun) await assertNoPendingTransactions(targetDir);
  const dir = resolve(targetDir, dirOption === true ? DEFAULT_MEDIATION_DIR : dirOption);
  const index = indexSchema.parse(JSON.parse(await readFile(join(dir, INDEX), "utf-8")));
  if (index.makerVersion !== makerVersion()) {
    throw new Error(`Exportação feita com o maker ${index.makerVersion}; exporte de novo com o ${makerVersion()} (maker update --export).`);
  }
  if (index.configHash !== configHash(currentConfig)) {
    throw new Error("A config do projeto mudou desde a exportação; exporte de novo (maker update --export).");
  }
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);

  const errors: string[] = [];
  const resolved = new Map<string, Buffer>();
  /** Conteúdo atual (já conferido contra localHash): a verificação de blocos não confia na cópia exportada. */
  const locals = new Map<string, string>();
  for (const item of index.items) {
    const path = join(dir, "items", item.id, "resolved");
    if (!existsSync(path)) continue;
    if (!isMediablePath(item, manifest.files)) {
      errors.push(`${item.path}: caminho fora dos arquivos gerenciados que podem ser mediados`);
      continue;
    }
    const content = await readFile(path);
    const problem = validateText(content);
    if (problem) errors.push(`${item.path}: proposta inválida (${problem})`);
    const upstream = await readFile(join(dir, "items", item.id, "upstream"));
    if (sha256(upstream) !== item.upstreamHash) errors.push(`${item.path}: upstream exportado foi alterado`);
    const current = await inspectTarget(targetDir, item.path);
    if (current.kind === "other" || (current.hash ?? null) !== item.localHash) {
      errors.push(`${item.path}: o arquivo mudou desde a exportação; exporte de novo`);
    }
    locals.set(item.id, current.content?.toString("utf-8") ?? "");
    resolved.set(item.id, content);
  }

  const groups = new Map<string, MediationItem[]>();
  for (const item of index.items) {
    const key = item.group ?? `item:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const selected: MediationItem[] = [];
  for (const [key, members] of groups) {
    const done = members.filter((item) => resolved.has(item.id));
    if (!done.length) continue;
    if (done.length !== members.length) {
      errors.push(`grupo ${key}: resolva todos os itens juntos (${members.map((item) => item.path).join(", ")})`);
      continue;
    }
    const before = members.map((item) => locals.get(item.id) ?? "").join("\n");
    const lost = [...markers(before)].filter((marker) => !markers(members.map((item) => resolved.get(item.id)!.toString("utf-8")).join("\n")).has(marker));
    if (lost.length) errors.push(`${members.map((item) => item.path).join(", ")}: blocos de add-on removidos (${lost.join(", ")}); mantenha-os intactos`);
    for (const item of members) {
      const text = resolved.get(item.id)!.toString("utf-8");
      const unbalanced = unbalancedBlocks(text);
      if (unbalanced) errors.push(`${item.path}: ${unbalanced}`);
      const role = legacyAdapterRole(item);
      if (role) {
        if (sharedRoleReference(text) !== `.maker/workflow/agents/${role}.md`) {
          errors.push(`${item.path}: o adapter precisa manter a instrução gerada que lê .maker/workflow/agents/${role}.md`);
        }
        if (markers(text).size) errors.push(`${item.path}: blocos de add-on devem ir para o papel compartilhado, não para o adapter`);
      }
    }
    selected.push(...members);
  }
  if (errors.length) {
    for (const error of errors) console.error(pc.red(`✗ ${error}`));
    throw new Error("Propostas de mediação rejeitadas; nenhuma alteração foi feita.");
  }
  if (!selected.length) {
    console.log(pc.yellow(`Nenhuma proposta em ${dir}/items/<id>/resolved; nada a aplicar.`));
    return;
  }

  const changes: PlannedChange[] = [];
  const next = structuredClone(manifest);
  next.files = { ...manifest.files };
  const stateUpdates = new Map<string, { state: AddonState; hash: string }>();
  for (const item of selected) {
    const content = resolved.get(item.id)!;
    const upstream = await readFile(join(dir, "items", item.id, "upstream"));
    changes.push({ ...await planWrite({ targetDir, path: item.path, content, source: item.source,
      reason: `proposta mediada (${item.category})`, force: true }),
      expectedHash: item.localHash, expectedKind: item.localHash ? "file" : "absent" });
    changes.push(await planWrite({ targetDir, path: `.maker/bases/${item.upstreamHash}`, content: upstream,
      source: "metadata", reason: `base upstream de ${item.path}` }));
    // A origem vem do manifest, não do índice exportado (que o agente pode editar).
    const recorded = manifest.files[item.path];
    next.files[item.path] = { ...recorded, source: resolvedSource({ ...item, source: recorded?.source ?? item.engineSource }, content.toString("utf-8")),
      hash: sha256(content), baseHash: item.upstreamHash };
  }
  // Blocos de add-on movidos do agente legado para o papel compartilhado: o state passa a apontar para o papel.
  for (const item of selected) {
    const role = legacyAdapterRole(item);
    if (!role || !item.localHash) continue;
    const moved = new Set([...(locals.get(item.id) ?? "").matchAll(ADDON_MARKER)].map((match) => match[1]!));
    for (const id of moved) {
      let entry = stateUpdates.get(id);
      if (!entry) {
        const metadata = await inspectTarget(targetDir, `.maker/addons/${id}.json`);
        if (metadata.kind !== "file") continue;
        const raw: unknown = JSON.parse(metadata.content!.toString("utf-8"));
        addonStateSchema.parse(raw);
        entry = { state: raw as AddonState, hash: metadata.hash! };
        stateUpdates.set(id, entry);
      }
      const sharedPath = `.maker/workflow/agents/${role}.md`;
      entry.state.injectedTargets = entry.state.injectedTargets.map((path) => path === item.path ? sharedPath : path)
        .filter((path, position, paths) => paths.indexOf(path) === position);
    }
  }
  for (const [id, entry] of stateUpdates) {
    changes.push({ ...await planWrite({ targetDir, path: `.maker/addons/${id}.json`,
      content: JSON.stringify(entry.state, null, 2) + "\n", source: "metadata",
      reason: "alvos de injeção após mediação do agente legado", force: true }),
      expectedHash: entry.hash, expectedKind: "file" });
  }
  changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(next, null, 2) + "\n",
    source: "metadata", reason: "registrar propostas mediadas", force: true }));
  const plan = createPlan(targetDir, changes);
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    return;
  }
  await applyChangePlan(plan);
  console.log(pc.green(`✓ ${selected.length} proposta(s) mediada(s) aplicada(s).`));
  const remaining = index.items.length - selected.length;
  if (remaining) console.log(pc.yellow(`${remaining} item(ns) sem proposta continuam pendentes.`));
  if (dirOption === true && !remaining) await rm(dir, { recursive: true, force: true });
  console.log("Execute maker update --dry-run e maker doctor para confirmar o estado final.");
}

/** Só arquivos já gerenciados, ou o papel compartilhado de um agente legado; nunca metadados do maker. */
function isMediablePath(item: MediationItem, files: Record<string, unknown>): boolean {
  const { path } = item;
  if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) return false;
  if (path.startsWith(".maker/") && !path.startsWith(".maker/workflow/")) return false;
  if (Object.hasOwn(files, path)) return true;
  return item.category === "legacy-agent" && /^\.maker\/workflow\/agents\/[a-z0-9-]+\.md$/.test(path);
}

function validateText(content: Buffer): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return "não é UTF-8";
  }
  if (text.includes("\0")) return "contém bytes nulos";
  if (!text.trim()) return "vazia";
  if (CONFLICT_MARKER.test(text)) return "contém marcadores de conflito";
  return undefined;
}

function markers(text: string): Set<string> {
  return new Set([...text.matchAll(ADDON_MARKER)].map((match) => `${match[1]}:${match[2]}`));
}

function unbalancedBlocks(text: string): string | undefined {
  const found = [...text.matchAll(ADDON_MARKER)];
  for (const id of new Set(found.map((match) => match[1]!))) {
    const own = found.filter((match) => match[1] === id);
    if (own.length !== 2 || own[0]![2] !== "start" || own[1]![2] !== "end") {
      return `bloco do add-on ${id} incompleto ou duplicado`;
    }
  }
  return undefined;
}

function legacyAdapterRole(item: MediationItem): string | undefined {
  return item.category === "legacy-agent" ? item.path.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1] : undefined;
}

function resolvedSource(item: MediationItem, content: string): string {
  if (item.category !== "legacy-agent") return item.source;
  if (legacyAdapterRole(item)) return item.engineSource;
  const ids = [...new Set([...content.matchAll(ADDON_MARKER)].map((match) => match[1]!))];
  if (ids.length === 1) return `addon:${ids[0]}`;
  return item.source.startsWith("addon:") && ids.includes(item.source.slice("addon:".length)) ? item.source : item.engineSource;
}
