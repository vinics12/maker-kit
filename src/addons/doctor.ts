import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { listAddonCatalog, type AddonCatalogEntry } from "./loader.js";
import { endMarker, startMarker } from "./inject.js";
import { addonStatePath, readAddonState, type AddonState } from "./state.js";
import { sha256, type Manifest } from "../render/manifest.js";

export interface AddonDoctorIssue {
  message: string;
  action: string;
}

export interface AddonDoctorResult {
  id: string;
  name: string;
  version?: string;
  ok: boolean;
  issues: AddonDoctorIssue[];
}

export interface AddonDoctorSummary {
  addons: AddonDoctorResult[];
  ok: boolean;
}

/** Reconciles every applied add-on with its state, catalog, files and manifest. */
export async function inspectAddons(
  targetDir: string,
  manifest: Manifest,
): Promise<AddonDoctorSummary> {
  const catalog = await listAddonCatalog();
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const ids = await appliedAddonIds(targetDir);
  const addons = await Promise.all(ids.map((id) => inspectAddon(targetDir, id, byId.get(id) ?? null, manifest)));
  return { addons, ok: addons.every((addon) => addon.ok) };
}

async function inspectAddon(
  targetDir: string,
  id: string,
  catalog: AddonCatalogEntry | null,
  manifest: Manifest,
): Promise<AddonDoctorResult> {
  const issues: AddonDoctorIssue[] = [];
  const name = catalog?.manifest?.name ?? "manifest indisponível";
  let state: AddonState | null = null;
  let version = catalog?.manifest?.version;

  if (!catalog) {
    issues.push(issue(`add-on não está disponível no catálogo local`, `instale a versão que originou o add-on ou remova-o com segurança`));
  } else if (!catalog.manifest) {
    issues.push(issue(`manifest do catálogo inválido: ${catalog.issue ?? "erro desconhecido"}`, `corrija o catálogo antes de reaplicar ou remover o add-on`));
  }

  try {
    state = await readAddonState(targetDir, id);
    if (!state) {
      issues.push(issue(`state ausente em ${addonStatePath(targetDir, id)}`, `reaplique o add-on ou restaure o state a partir do controle de versão`));
    } else {
      if (state.id !== id) issues.push(issue(`state declara id "${state.id}"`, `corrija o state ou remova e reaplique o add-on correto`));
      version = state.version;
      if (catalog?.manifest && state.version !== catalog.manifest.version) {
        issues.push(issue(`state v${state.version} difere do catálogo v${catalog.manifest.version}`, `atualize o add-on ou remova e reaplique a versão compatível`));
      }
    }
  } catch (error) {
    issues.push(issue(`state inválido: ${error instanceof Error ? error.message : String(error)}`, `restaure o state válido ou remova o add-on após revisar seus arquivos`));
  }

  if (state) {
    for (const file of state.createdFiles) {
      await checkCreatedFile(targetDir, id, file.path, file.hash, manifest, issues);
    }
    for (const rel of state.injectedTargets) {
      await checkInjectedTarget(targetDir, id, rel, manifest, issues);
    }
  }

  return { id, name, version, ok: issues.length === 0, issues };
}

async function checkCreatedFile(
  targetDir: string,
  id: string,
  rel: string,
  expectedHash: string,
  manifest: Manifest,
  issues: AddonDoctorIssue[],
): Promise<void> {
  const abs = join(targetDir, rel);
  if (!existsSync(abs)) {
    issues.push(issue(`arquivo criado ausente: ${rel}`, `reaplique o add-on ou restaure o arquivo antes de removê-lo`));
    return;
  }
  const currentHash = sha256(await readFile(abs));
  if (currentHash !== expectedHash) {
    issues.push(issue(`arquivo criado modificado: ${rel}`, `revise a edição local e reaplique ou remova o add-on conscientemente`));
  }
  const entry = manifest.files[rel];
  if (!entry) {
    issues.push(issue(`arquivo ${rel} não possui entrada no manifest`, `reaplique o add-on para reconciliar o manifest`));
  } else if (entry.source !== `addon:${id}`) {
    issues.push(issue(`entrada do manifest para ${rel} aponta para ${entry.source}`, `reconcilie o manifest antes de reaplicar o add-on`));
  } else if (entry.hash !== expectedHash) {
    issues.push(issue(`hash do manifest diverge do state em ${rel}`, `reaplique o add-on para reconciliar os metadados`));
  }
}

async function checkInjectedTarget(
  targetDir: string,
  id: string,
  rel: string,
  manifest: Manifest,
  issues: AddonDoctorIssue[],
): Promise<void> {
  const abs = join(targetDir, rel);
  if (!existsSync(abs)) {
    issues.push(issue(`alvo de injeção ausente: ${rel}`, `reaplique o add-on ou restaure o arquivo do motor`));
    return;
  }
  const content = await readFile(abs, "utf-8");
  const start = startMarker(id);
  const end = endMarker(id);
  const starts = content.split(start).length - 1;
  const ends = content.split(end).length - 1;
  if (starts !== 1 || ends !== 1 || content.indexOf(start) > content.indexOf(end)) {
    issues.push(issue(`marcadores do add-on incompletos ou duplicados em ${rel}`, `reaplique ou remova o bloco manualmente antes de executar nova operação`));
  }
  const entry = manifest.files[rel];
  if (!entry) {
    issues.push(issue(`alvo ${rel} não possui entrada no manifest`, `reaplique o add-on para reconciliar o manifest`));
  } else if (entry.source !== `addon:${id}`) {
    issues.push(issue(`entrada do manifest para ${rel} aponta para ${entry.source}`, `reconcilie o manifest antes de reaplicar o add-on`));
  } else {
    const currentHash = sha256(await readFile(abs));
    if (entry.hash !== currentHash) issues.push(issue(`alvo injetado modificado: ${rel}`, `revise a edição local e reaplique ou remova o add-on conscientemente`));
  }
}

async function appliedAddonIds(targetDir: string): Promise<string[]> {
  const dir = join(targetDir, ".maker", "addons");
  try {
    const metadata = await lstat(dir);
    if (!metadata.isDirectory()) return [];
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => basename(entry.name, ".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

function issue(message: string, action: string): AddonDoctorIssue {
  return { message, action };
}
