import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { z } from "zod";
import { diffComm } from "node-diff3";
import { addonStateSchema, type AddonState } from "../addons/state.js";
import { sharedRoleReference } from "../agents/reference.js";
import { addonBlocks } from "../addons/inject.js";
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
  /** Modo do update na exportação: o apply recalcula os candidatos no mesmo modo. */
  merge: z.boolean().optional(),
  items: z.array(itemSchema),
});
type MediationItem = z.infer<typeof itemSchema>;

const ADDON_MARKER = /<!-- maker:addon:([a-z0-9-]+):(start|end) -->/g;
const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

export function configHash(config: unknown): string {
  return sha256(Buffer.from(JSON.stringify(config)));
}

/** Aviso do update: só sugere o que está disponível agora (skill instalada, config para exportar, update aplicável). */
export function mediationHint(count: number, state: { configKnown: boolean; skillInstalled: boolean; updateBlocked: boolean }): string {
  const lead = `${count} arquivo(s) precisam de mediação (conflitos ou customizações que o merge automático não resolve): `;
  if (!state.configKnown) return lead + "crie maker.config.json com os valores usados no init; a mediação precisa da config do projeto.";
  if (state.skillInstalled) return lead + "use a skill /maker-update no Claude Code ($maker-update no Codex) ou maker update --export.";
  if (state.updateBlocked) return lead + "use maker update --export para revisar base/local/upstream e resolver os conflitos.";
  return lead + "aplique este update para instalar a skill maker-update (/maker-update no Claude Code, $maker-update no Codex) ou use maker update --export.";
}

/** Id estável por caminho: reexportar não embaralha itens nem propostas. */
function itemId(path: string): string {
  const slug = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(-48).replace(/^-/, "");
  return `${slug}-${sha256(Buffer.from(path)).slice(0, 8)}`;
}

async function proposalsIn(dir: string): Promise<string[]> {
  if (!existsSync(join(dir, "items"))) return [];
  const found: string[] = [];
  for (const id of await readdir(join(dir, "items"))) {
    for (const name of ["resolved", "notes.md"]) {
      if (existsSync(join(dir, "items", id, name))) found.push(`items/${id}/${name}`);
    }
  }
  return found;
}

/** Modo `--no-merge` registrado numa exportação, se houver uma legível em `dirOption`. */
export async function exportedMergeMode(targetDir: string, dirOption: string | true): Promise<boolean | undefined> {
  try {
    const dir = resolve(targetDir, dirOption === true ? DEFAULT_MEDIATION_DIR : dirOption);
    return indexSchema.parse(JSON.parse(await readFile(join(dir, INDEX), "utf-8"))).merge;
  } catch {
    return undefined;
  }
}

export async function exportMediation(
  targetDir: string,
  dirOption: string | true,
  candidates: MediationCandidate[],
  config: unknown,
  mode: { merge: boolean } = { merge: true },
): Promise<void> {
  const dir = resolve(targetDir, dirOption === true ? DEFAULT_MEDIATION_DIR : dirOption);
  if (existsSync(dir)) {
    const entries = await readdir(dir);
    if (entries.length && !entries.includes(INDEX)) {
      throw new Error(`${dir} já existe e não é uma exportação do maker; escolha outro diretório.`);
    }
    const pending = await proposalsIn(dir);
    if (pending.length) {
      throw new Error(`${dir} tem propostas em andamento (${pending.join(", ")}); aplique-as com maker update --apply-resolutions ` +
        "ou mova-as antes de exportar de novo.");
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
  for (const candidate of candidates) {
    const id = itemId(candidate.path);
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
  const index = { format: 1 as const, makerVersion: makerVersion(), configHash: configHash(config), merge: mode.merge, items };
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

export interface ApplyResolutionsOptions {
  dryRun?: boolean;
  /** Aceita propostas que descartam linhas customizadas pelo dono (exige aprovação explícita dele). */
  acceptDropped?: boolean;
}

/**
 * `candidates` é o que o maker exportaria agora. Cada proposta só é aceita para um item que ainda
 * corresponde a um candidato (mesmo caminho, categoria, grupo, local e upstream): o índice exportado,
 * que o agente pode editar, nunca decide caminho, upstream, base ou origem.
 */
export async function applyResolutions(
  targetDir: string,
  dirOption: string | true,
  currentConfig: unknown,
  candidates: MediationCandidate[],
  opts: ApplyResolutionsOptions,
): Promise<void> {
  if (opts.dryRun) await assertNoPendingTransactions(targetDir);
  const byPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
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
  const matched = new Map<string, MediationCandidate>();
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
    const current = await inspectTarget(targetDir, item.path);
    const candidate = byPath.get(item.path);
    if (current.kind === "other" || (current.hash ?? null) !== item.localHash) {
      errors.push(`${item.path}: o arquivo mudou desde a exportação; exporte de novo`);
    } else if (!candidate || candidate.category !== item.category || (candidate.group ?? null) !== item.group ||
        sha256(candidate.upstream) !== item.upstreamHash || (candidate.local ? sha256(candidate.local) : null) !== item.localHash) {
      errors.push(`${item.path}: o item não corresponde ao que o maker exportaria agora; exporte de novo`);
    } else {
      matched.set(item.id, candidate);
    }
    resolved.set(item.id, content);
  }

  const groups = new Map<string, MediationItem[]>();
  for (const item of index.items) {
    const key = item.group ?? `item:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const selected: MediationItem[] = [];
  const dropped = new Map<string, string[]>();
  for (const [key, members] of groups) {
    const done = members.filter((item) => resolved.has(item.id));
    if (!done.length) continue;
    if (done.length !== members.length) {
      errors.push(`grupo ${key}: resolva todos os itens juntos (${members.map((item) => item.path).join(", ")})`);
      continue;
    }
    if (!members.every((item) => matched.has(item.id))) continue;
    // Blocos de add-on: os mesmos ids, com o mesmo conteúdo, antes e depois (podem mudar de arquivo no grupo).
    const paths = members.map((item) => item.path).join(", ");
    const before = blocksOf(members.map((item) => matched.get(item.id)!.local?.toString("utf-8") ?? ""));
    const after = blocksOf(members.map((item) => resolved.get(item.id)!.toString("utf-8")));
    for (const [id, content] of before) {
      if (!after.has(id)) errors.push(`${paths}: bloco do add-on ${id} removido; mantenha-o intacto`);
      else if (after.get(id)!.trim() !== content.trim()) errors.push(`${paths}: conteúdo do bloco do add-on ${id} alterado; mantenha-o byte a byte`);
    }
    for (const id of after.keys()) {
      if (!before.has(id)) errors.push(`${paths}: bloco do add-on ${id} não existia; blocos só são criados por maker add`);
    }
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
    // Linhas que o dono acrescentou ou mudou (local sem equivalente na base) precisam estar em alguma
    // proposta do grupo; descartá-las exige a aprovação explícita do dono (--accept-dropped).
    const kept = new Set(members.flatMap((item) => contentLines(resolved.get(item.id)!.toString("utf-8"))));
    const lost = members.flatMap((item) => customizedLines(matched.get(item.id)!)).filter((line) => !kept.has(line));
    if (lost.length) dropped.set(paths, [...new Set(lost)]);
    selected.push(...members);
  }
  for (const [paths, lines] of dropped) {
    const listed = lines.slice(0, 20).map((line) => `\n    - ${line}`).join("") + (lines.length > 20 ? `\n    … e mais ${lines.length - 20}` : "");
    const message = `${paths}: a proposta descarta ${lines.length} linha(s) customizada(s):${listed}`;
    if (opts.acceptDropped) console.log(pc.yellow(`! ${message}\n  aceito com --accept-dropped.`));
    else errors.push(`${message}\n  mantenha-as, ou reaplique com --accept-dropped se o dono aprovou a remoção`);
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
    const candidate = matched.get(item.id)!;
    const source = resolvedSource(candidate, content.toString("utf-8"));
    changes.push({ ...await planWrite({ targetDir, path: item.path, content, source,
      reason: `proposta mediada (${item.category})`, force: true }),
      expectedHash: item.localHash, expectedKind: item.localHash ? "file" : "absent" });
    changes.push(await planWrite({ targetDir, path: `.maker/bases/${item.upstreamHash}`, content: candidate.upstream,
      source: "metadata", reason: `base upstream de ${item.path}` }));
    const { edited: _edited, ...recorded } = manifest.files[item.path] ?? { hash: "", source };
    next.files[item.path] = { ...recorded, source, hash: sha256(content), baseHash: item.upstreamHash };
  }
  // Blocos de add-on movidos do agente legado para o papel compartilhado: o state passa a apontar para o papel.
  for (const item of selected) {
    const role = legacyAdapterRole(item);
    if (!role || !item.localHash) continue;
    const moved = addonBlocks(matched.get(item.id)!.local?.toString("utf-8") ?? "").keys();
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
    for (const item of selected) printDiff(item.path, matched.get(item.id)!.local?.toString("utf-8") ?? "", resolved.get(item.id)!.toString("utf-8"));
    console.log(formatPlan(plan));
    return;
  }
  await applyChangePlan(plan);
  console.log(pc.green(`✓ ${selected.length} proposta(s) mediada(s) aplicada(s).`));
  // Itens aplicados saem da exportação: o que sobra pode ser reaplicado depois sem conflitar com eles.
  const applied = new Set(selected.map((item) => item.id));
  const remaining = index.items.filter((item) => !applied.has(item.id));
  for (const id of applied) await rm(join(dir, "items", id), { recursive: true, force: true });
  if (remaining.length) {
    await writeFile(join(dir, INDEX), JSON.stringify({ ...index, items: remaining }, null, 2) + "\n");
    console.log(pc.yellow(`${remaining.length} item(ns) sem proposta continuam pendentes em ${dir}.`));
  } else {
    await rm(dir, { recursive: true, force: true });
  }
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

/** Linhas com conteúdo, sem bordas e sem marcadores de add-on (checados à parte). */
function contentLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^<!-- maker:addon:[a-z0-9-]+:(start|end) -->$/.test(line));
}

/** Linhas do local ausentes da base (ou, sem base, do upstream): o que o dono acrescentou ou mudou. */
function customizedLines(candidate: MediationCandidate): string[] {
  if (!candidate.local) return [];
  const reference = new Set(contentLines((candidate.base ?? candidate.upstream).toString("utf-8")));
  return contentLines(candidate.local.toString("utf-8")).filter((line) => !reference.has(line));
}

/** Diff local → proposta, só com as linhas alteradas, para revisão no --dry-run. */
function printDiff(path: string, local: string, proposal: string): void {
  const chunks = diffComm(local.split("\n"), proposal.split("\n"));
  const changed = chunks.filter((chunk) => !chunk.common);
  console.log(pc.bold(`--- ${path} (local) → proposta: ${changed.length ? `${changed.length} trecho(s) alterado(s)` : "sem mudanças"}`));
  for (const chunk of changed) {
    for (const line of chunk.buffer1 ?? []) console.log(pc.red(`- ${line}`));
    for (const line of chunk.buffer2 ?? []) console.log(pc.green(`+ ${line}`));
  }
}

function markers(text: string): Set<string> {
  return new Set([...text.matchAll(ADDON_MARKER)].map((match) => `${match[1]}:${match[2]}`));
}

function blocksOf(texts: string[]): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const text of texts) for (const [id, content] of addonBlocks(text)) blocks.set(id, content);
  return blocks;
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

function resolvedSource(item: MediationCandidate, content: string): string {
  if (item.category !== "legacy-agent") return item.source;
  if (/^\.claude\/agents\//.test(item.path)) return item.engineSource;
  const ids = [...new Set([...content.matchAll(ADDON_MARKER)].map((match) => match[1]!))];
  if (ids.length === 1) return `addon:${ids[0]}`;
  return item.source.startsWith("addon:") && ids.includes(item.source.slice("addon:".length)) ? item.source : item.engineSource;
}
