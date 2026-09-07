import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { rm } from "node:fs/promises";
import { renderRaw } from "../render/engine.js";
import {
  readManifest,
  writeManifest,
  sha256,
  manifestKey,
  type Manifest,
} from "../render/manifest.js";
import { addonDir } from "./loader.js";
import type { AddonManifest } from "./schema.js";
import { upsertBlock, stripBlock } from "./inject.js";
import {
  writeAddonState,
  readAddonState,
  deleteAddonState,
  type AddonState,
} from "./state.js";

const CONSTITUTION = ".specify/memory/constitution.md";
const PLACEHOLDER = "_(nenhum princípio de projeto definido ainda)_";

function addonContext(manifest: Manifest, knobs: Record<string, string>) {
  return {
    project: manifest.project,
    addon: knobs,
    generatedAt: new Date().toISOString().slice(0, 10),
  };
}

async function renderFrom(dir: string, rel: string, ctx: object): Promise<string> {
  const raw = await readFile(join(dir, rel), "utf-8");
  return rel.endsWith(".hbs") ? renderRaw(raw, ctx) : raw;
}

/** Atualiza (ou insere) a entrada do manifest para um arquivo tocado pelo add-on. */
async function touchManifest(
  manifest: Manifest,
  targetDir: string,
  absPath: string,
  source: string,
): Promise<void> {
  const hash = sha256(await readFile(absPath));
  manifest.files[manifestKey(targetDir, absPath)] = { hash, source };
}

export async function applyAddon(
  targetDir: string,
  addon: AddonManifest,
  knobs: Record<string, string>,
): Promise<{ injectedTargets: string[]; createdFiles: string[] }> {
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new Error(`Nenhum install do maker em ${targetDir} — rode 'maker init' antes de add-ons.`);
  }
  const dir = addonDir(addon.id);
  const ctx = addonContext(manifest, knobs);
  const injectedTargets: string[] = [];
  const createdFiles: { path: string; hash: string }[] = [];

  // Reaplicação: arquivos que ESTE add-on já criou são "nossos" e podem ser sobrescritos;
  // arquivos alheios de mesmo nome são preservados.
  const prior = await readAddonState(targetDir, addon.id);
  const owned = new Set((prior?.createdFiles ?? []).map((f) => f.path));

  // 1. Princípios → injetados na seção "Princípios do Projeto" da constitution.
  if (addon.principles.length) {
    const absConst = join(targetDir, CONSTITUTION);
    if (!existsSync(absConst)) throw new Error(`${CONSTITUTION} ausente no install.`);
    const rendered: string[] = [];
    for (const p of addon.principles) rendered.push((await renderFrom(dir, p, ctx)).trim());
    const block = rendered.join("\n\n");
    const current = await readFile(absConst, "utf-8");
    const next = upsertBlock(current, addon.id, block, {
      replacePlaceholder: PLACEHOLDER,
      beforeHeading: "## Governance",
    });
    await writeFile(absConst, next, "utf-8");
    await touchManifest(manifest, targetDir, absConst, `addon:${addon.id}`);
    injectedTargets.push(CONSTITUTION);
  }

  // 2. Fragmentos de agente → anexados ao fim do agente-alvo.
  for (const frag of addon.agentFragments) {
    const rel = `.claude/agents/${frag.agent}.md`;
    const abs = join(targetDir, rel);
    if (!existsSync(abs)) {
      console.warn(`  aviso: agente ${frag.agent} ausente — fragmento pulado.`);
      continue;
    }
    const block = (await renderFrom(dir, frag.file, ctx)).trim();
    const next = upsertBlock(await readFile(abs, "utf-8"), addon.id, block);
    await writeFile(abs, next, "utf-8");
    await touchManifest(manifest, targetDir, abs, `addon:${addon.id}`);
    injectedTargets.push(rel);
  }

  // 3. Arquivos novos (memória de referência, skills).
  for (const f of addon.files) {
    const abs = join(targetDir, f.to);
    if (existsSync(abs) && !owned.has(f.to)) {
      console.warn(`  aviso: ${f.to} já existe (não é deste add-on) — não sobrescrito.`);
      continue;
    }
    const content = await renderFrom(dir, f.from, ctx);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
    const hash = sha256(Buffer.from(content, "utf-8"));
    manifest.files[manifestKey(targetDir, abs)] = { hash, source: `addon:${addon.id}` };
    createdFiles.push({ path: f.to, hash });
  }

  await writeManifest(targetDir, manifest);

  const state: AddonState = {
    id: addon.id,
    version: addon.version,
    appliedAt: new Date().toISOString(),
    knobs,
    createdFiles,
    injectedTargets,
  };
  await writeAddonState(targetDir, state);

  return { injectedTargets, createdFiles: createdFiles.map((c) => c.path) };
}

export async function removeAddon(
  targetDir: string,
  id: string,
): Promise<{ strippedTargets: string[]; deletedFiles: string[]; keptFiles: string[] }> {
  const state = await readAddonState(targetDir, id);
  if (!state) throw new Error(`Add-on "${id}" não está aplicado em ${targetDir}.`);
  const manifest = await readManifest(targetDir);

  const strippedTargets: string[] = [];
  const deletedFiles: string[] = [];
  const keptFiles: string[] = [];

  // 1. Remove os blocos injetados dos arquivos do motor.
  for (const rel of state.injectedTargets) {
    const abs = join(targetDir, rel);
    if (!existsSync(abs)) continue;
    const next = stripBlock(await readFile(abs, "utf-8"), id);
    await writeFile(abs, next, "utf-8");
    if (manifest) await touchManifest(manifest, targetDir, abs, "engine");
    strippedTargets.push(rel);
  }

  // 2. Deleta arquivos criados — só se intocados desde a aplicação (hash bate).
  for (const f of state.createdFiles) {
    const abs = join(targetDir, f.path);
    if (!existsSync(abs)) continue;
    const current = sha256(await readFile(abs));
    if (current === f.hash) {
      await rm(abs);
      if (manifest) delete manifest.files[manifestKey(targetDir, abs)];
      deletedFiles.push(f.path);
    } else {
      keptFiles.push(f.path); // editado localmente — preserva
    }
  }

  if (manifest) await writeManifest(targetDir, manifest);
  await deleteAddonState(targetDir, id);

  return { strippedTargets, deletedFiles, keptFiles };
}
