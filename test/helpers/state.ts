import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { AgentProvider } from "../../src/config/schema.js";
import { runInit } from "../../src/commands/init.js";
import { runAgentAdd } from "../../src/commands/agent.js";
import { loadAddon } from "../../src/addons/loader.js";
import { applyAddon } from "../../src/addons/apply.js";
import { createPlan } from "../../src/changes/plan.js";
import { applyChangePlan } from "../../src/changes/transaction.js";
import type { BasesFormat } from "../../src/render/manifest.js";
import type { Manifest } from "../../src/render/manifest.js";
import { openState, planStateWrite } from "../../src/state/store.js";
import { basePath, LOCKFILE } from "../../src/state/paths.js";
import { parseLockfile, serializeLockfile } from "../../src/state/lockfile.js";

export { readManifest } from "../../src/state/store.js";

const FIXTURE_CONFIG = join(__dirname, "..", "..", "fixtures", "example.config.json");

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Grava o manifest via `planStateWrite` + `applyChangePlan` (transacional, formato em uso). */
export async function writeManifest(target: string, manifest: Manifest): Promise<void> {
  const state = await openState(target, { mode: "mutate" });
  const changes = await planStateWrite(state, target, {
    manifest,
    format: state?.inUse ?? "files",
    bases: new Map(),
    prune: false,
  });
  await applyChangePlan(createPlan(target, changes));
}

/** Grava uma base no formato em uso (ou "files" sem install) e devolve o hash. */
export async function putBase(target: string, content: Buffer | string): Promise<string> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = sha256(buffer);
  const state = await openState(target, { mode: "mutate" });
  if (!state) {
    // Sem install: grava só o arquivo de base em `files` (uso isolado, ex.: fixtures de teste do lockfile).
    const changes = await planStateWrite(null, target, {
      manifest: { makerVersion: "0.0.0", project: { name: "x", slug: "x" }, installedAt: new Date().toISOString(), files: {} },
      format: "files",
      bases: new Map([[hash, buffer]]),
      prune: false,
    });
    await applyChangePlan(createPlan(target, changes));
    return hash;
  }
  const changes = await planStateWrite(state, target, {
    manifest: state.manifest,
    format: state.inUse,
    bases: new Map([[hash, buffer]]),
    prune: false,
  });
  await applyChangePlan(createPlan(target, changes));
  return hash;
}

/** Mesmo tamanho do conteúdo original: garante `hash-mismatch` (nunca `size-mismatch`/`truncated`). */
function flipFirstByte(content: Buffer): Buffer {
  if (!content.length) return Buffer.from("x");
  const copy = Buffer.from(content);
  copy[0] = copy[0]! ^ 0xff;
  return copy;
}

/**
 * Corrompe uma base nos dois formatos (o que existir), preservando a estrutura ao redor: no pack,
 * reserializa o lockfile inteiro com o conteúdo transformado sob o mesmo hash declarado (size/encoding
 * recalculados para esse conteúdo), então o parser sempre vê um bloco estruturalmente íntegro cujo
 * sha256 não bate — nunca `truncated`/`malformed` por causa só da corrupção.
 */
export async function corruptBase(target: string, hash: string, mutate?: (b: Buffer) => Buffer): Promise<void> {
  const transform = mutate ?? flipFirstByte;
  const filesPath = join(target, basePath(hash));
  try {
    const current = await readFile(filesPath);
    await writeFile(filesPath, transform(current));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lockfilePath = join(target, LOCKFILE);
  if (!existsSync(lockfilePath)) return;
  const raw = await readFile(lockfilePath);
  const parsed = parseLockfile(raw);
  if (!parsed.bases.has(hash)) return;
  const corrupted = new Map(parsed.bases);
  corrupted.set(hash, transform(parsed.bases.get(hash)!));
  await writeFile(lockfilePath, serializeLockfile(parsed.manifest, corrupted));
}

/** Remove uma base dos dois formatos (o que existir): no pack, reserializa o lockfile sem ela. */
export async function removeBase(target: string, hash: string): Promise<void> {
  await rm(join(target, basePath(hash)), { force: true });
  const lockfilePath = join(target, LOCKFILE);
  if (!existsSync(lockfilePath)) return;
  const raw = await readFile(lockfilePath);
  const parsed = parseLockfile(raw);
  if (!parsed.bases.has(hash)) return;
  const remaining = new Map(parsed.bases);
  remaining.delete(hash);
  await writeFile(lockfilePath, serializeLockfile(parsed.manifest, remaining));
}

export async function lockfileText(target: string): Promise<string> {
  return readFile(join(target, LOCKFILE), "utf-8");
}

/** path → sha256, inclui `.maker`. */
export async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const rel = relative(dir, abs).split("\\").join("/");
        out.set(rel, sha256(await readFile(abs)));
      }
    }
  }
  if (await stat(dir).then(() => true).catch(() => false)) await walk(dir);
  return out;
}

/**
 * Produz o formato pedido SEM depender do default do `init`: roda `runInit` e, em seguida, converte
 * o estado via `planStateWrite({ consolidate: true })` + `applyChangePlan` para o formato pedido,
 * gravando `basesFormat` = format. `"unset"` = formato files sem `basesFormat` e sem `state.bases`
 * na config (install "não migrado").
 */
export async function initInstall(
  prefix: string,
  opts?: { format?: BasesFormat | "unset"; agents?: AgentProvider[]; addon?: string },
): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), prefix));
  const agents = opts?.agents ?? [];
  await runInit({ target, config: FIXTURE_CONFIG, yes: true, agent: agents[0] });
  for (const agent of agents.slice(1)) {
    await runAgentAdd(agent, { target });
  }
  if (opts?.addon) {
    const addon = await loadAddon(opts.addon);
    await applyAddon(target, addon, {});
  }
  const format = opts?.format;
  if (format === "unset") {
    await toLegacyFiles(target);
  } else if (format) {
    const state = await openState(target, { mode: "mutate" });
    if (state && state.inUse !== format) {
      const next: Manifest = { ...state.manifest, basesFormat: format };
      const changes = await planStateWrite(state, target, {
        manifest: next, format, bases: new Map(), consolidate: true, prune: false,
      });
      await applyChangePlan(createPlan(target, changes));
    } else if (state) {
      const next: Manifest = { ...state.manifest, basesFormat: format };
      await writeManifest(target, next);
    }
  }
  return target;
}

/** Converte um install para "files" sem `basesFormat` (install "não migrado" pela 0.2.x/1.0.0). */
export async function toLegacyFiles(target: string): Promise<void> {
  const state = await openState(target, { mode: "mutate" });
  if (!state) throw new Error(`Nenhum install do maker em ${target}.`);
  const { basesFormat: _basesFormat, ...rest } = state.manifest;
  const next = rest as Manifest;
  const changes = await planStateWrite(state, target, {
    manifest: next, format: "files", bases: new Map(), consolidate: true, prune: false,
  });
  await applyChangePlan(createPlan(target, changes));
}

let gitAvailable: boolean | undefined;
export function hasGit(): boolean {
  if (gitAvailable !== undefined) return gitAvailable;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}
