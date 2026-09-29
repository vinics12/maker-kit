import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const CACHE_DIR = join(REPO_ROOT, "node_modules", ".cache");
const TAG = "v1.0.0";

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasTag(): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", TAG], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function dependenciesDiverge(): Promise<string | null> {
  const current = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf-8")).dependencies;
  let legacy: unknown;
  try {
    legacy = JSON.parse(execFileSync("git", ["show", `${TAG}:package.json`], { cwd: REPO_ROOT, encoding: "utf-8" })).dependencies;
  } catch {
    return "não foi possível ler package.json da tag";
  }
  return JSON.stringify(current) === JSON.stringify(legacy) ? null : "dependencies da tag divergem das atuais";
}

/**
 * Extrai `git archive v1.0.0 dist addons templates package.json` para um `mkdtemp` dentro de
 * `<repo>/node_modules/.cache/` (ignorado pelo git; as deps de runtime do bundle resolvem pelo
 * `node_modules` do repo, dois níveis acima). Devolve `{ skip }` sem git, sem a tag, ou com
 * `dependencies` divergentes da tag.
 */
export async function legacyCli(): Promise<{ cli: string; cleanup(): Promise<void> } | { skip: string }> {
  if (!hasGit()) return { skip: "git indisponível" };
  if (!hasTag()) return { skip: `tag ${TAG} ausente no clone (CI rasa)` };
  const divergence = await dependenciesDiverge();
  if (divergence) return { skip: divergence };

  await mkdir(CACHE_DIR, { recursive: true });
  const dir = await mkdtemp(join(CACHE_DIR, "legacy-v1-0-0-"));
  try {
    const tarball = execFileSync("git", ["archive", TAG, "dist", "addons", "templates", "package.json"], {
      cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", dir], { input: tarball, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    await rm(dir, { recursive: true, force: true });
    return { skip: "falha ao extrair o arquivo da tag (git archive/tar indisponível)" };
  }
  const cli = join(dir, "dist", "cli.js");
  if (!existsSync(cli)) {
    await rm(dir, { recursive: true, force: true });
    return { skip: "dist/cli.js ausente no arquivo extraído da tag" };
  }
  return { cli, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** `execFileSync(process.execPath, [cli, ...args])` sem lançar: `{ code, stdout, stderr }`. */
export function runLegacy(cli: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { encoding: "utf-8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}
