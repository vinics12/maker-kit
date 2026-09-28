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
import { serializeLockfile } from "../../src/state/lockfile.js";

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
 * Localiza o bloco `@base sha256=<hash> ... @end sha256=<hash>\n\n` no texto cru do lockfile, pelo
 * `size` declarado (a mesma referência que o parser usa) — nunca por `parseLockfile`, cujo resultado
 * só tem bases *verificadas* e already descartaria um bloco que outro `corruptBase` deixou inválido.
 * Devolve `null` sem lançar quando o hash não aparece (a chamada é no-op).
 */
function findBaseBlock(text: string, hash: string): { start: number; end: number; content: Buffer } | null {
  const headerRe = new RegExp(`^@base sha256=${hash} size=(\\d+) encoding=(utf8|base64)$`, "m");
  const headerMatch = headerRe.exec(text);
  if (!headerMatch) return null;
  const size = Number(headerMatch[1]);
  const encoding = headerMatch[2] as "utf8" | "base64";
  const bodyStart = headerMatch.index + headerMatch[0].length + 1;
  const endMarker = `@end sha256=${hash}`;
  const endIndex = text.indexOf(endMarker, bodyStart);
  if (endIndex < 0) return null;
  const payload = text.slice(bodyStart, endIndex - 1); // exclui o "\n" delimitador antes do "@end"
  const content = encoding === "utf8"
    ? Buffer.from(payload, "utf-8")
    : Buffer.from(payload.replace(/\n/g, ""), "base64");
  // O bloco (para recorte/substituição) vai do cabeçalho até a linha em branco depois do "@end".
  const blockEnd = endIndex + endMarker.length + "\n\n".length;
  return { start: headerMatch.index, end: blockEnd, content: content.subarray(0, size) };
}

/** Serializa um lockfile só com essa base e extrai o bloco `@base ... @end ...\n\n` gerado. */
function renderBaseBlock(hash: string, content: Buffer): string {
  const placeholder: Manifest = { makerVersion: "0.0.0", project: { name: "x", slug: "x" }, installedAt: "1970-01-01T00:00:00.000Z", files: {} };
  const text = serializeLockfile(placeholder, new Map([[hash, content]])).toString("utf-8");
  return text.slice(text.indexOf("[bases]\n\n") + "[bases]\n\n".length);
}

/**
 * Corrompe uma base nos dois formatos (o que existir). No pack, edita só o bloco-alvo no texto cru
 * (recorte + substituição por um bloco estruturalmente íntegro com o mesmo hash declarado, size/
 * encoding recalculados para o conteúdo transformado) e preserva o resto do arquivo byte a byte —
 * inclusive outros blocos já corrompidos/truncados, marcadores de conflito e linhas com `\r`, que
 * `parseLockfile` (só bases verificadas) apagaria silenciosamente se fosse usado para reserializar.
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
  const text = (await readFile(lockfilePath)).toString("utf-8");
  const block = findBaseBlock(text, hash);
  if (!block) return;
  const replacement = renderBaseBlock(hash, transform(block.content));
  await writeFile(lockfilePath, text.slice(0, block.start) + replacement + text.slice(block.end));
}

/** Remove uma base dos dois formatos (o que existir): no pack, recorta só o bloco-alvo, byte a byte. */
export async function removeBase(target: string, hash: string): Promise<void> {
  await rm(join(target, basePath(hash)), { force: true });
  const lockfilePath = join(target, LOCKFILE);
  if (!existsSync(lockfilePath)) return;
  const text = (await readFile(lockfilePath)).toString("utf-8");
  const block = findBaseBlock(text, hash);
  if (!block) return;
  await writeFile(lockfilePath, text.slice(0, block.start) + text.slice(block.end));
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
