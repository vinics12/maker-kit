import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BasesFormat } from "../../src/render/manifest.js";
import { runUpdate } from "../../src/commands/update.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { loadAddon } from "../../src/addons/loader.js";
import { applyAddon } from "../../src/addons/apply.js";
import { hasGit, initInstall, readManifest, writeManifest } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temp(prefix: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), prefix));
  directories.push(target);
  return target;
}

function git(cwd: string, args: string[]): string {
  // stderr silenciado: o autocrlf=true do caso AC-20 imprime um aviso de conversão por arquivo.
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

async function gitRepo(target: string, opts?: { autocrlf?: boolean }): Promise<void> {
  git(target, ["init", "-q"]);
  git(target, ["config", "user.name", "Maker Test"]);
  git(target, ["config", "user.email", "maker-test@example.com"]);
  if (opts?.autocrlf) git(target, ["config", "core.autocrlf", "true"]);
}

function commitAll(target: string, message: string): void {
  git(target, ["add", "-A"]);
  git(target, ["commit", "-q", "-m", message]);
}

async function doctorOutput(target: string): Promise<{ output: string; exitCode: number }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = 0;
  await runDoctor({ target });
  const output = log.mock.calls.flat().join("\n");
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = 0;
  log.mockRestore();
  return { output, exitCode };
}

async function expectGreenDoctor(target: string): Promise<void> {
  const { output, exitCode } = await doctorOutput(target);
  expect(output).toContain("Install íntegro");
  expect(exitCode).not.toBe(1);
}

describe.each<BasesFormat>(["files", "pack"])("interop com o git (formato %s)", (format) => {
  it.skipIf(!hasGit())("AC-20/SC-006: core.autocrlf=true, commit e clone novo — bases conferem, doctor verde", async () => {
    const target = await initInstall(`maker-git-autocrlf-${format}-`, { format });
    directories.push(target);
    await gitRepo(target, { autocrlf: true });
    commitAll(target, "install inicial");

    const clone = await temp(`maker-git-autocrlf-clone-${format}-`);
    await rm(clone, { recursive: true, force: true }); // git clone exige o destino ausente
    git(process.cwd(), ["clone", "-q", target, clone]);
    git(clone, ["config", "core.autocrlf", "true"]);
    git(clone, ["checkout", "-f", "-q", "HEAD"]); // reaplica o checkout já com autocrlf ligado

    await expectGreenDoctor(clone);
  });
});

describe("interop com o git — temporários e atributos (AC-21, AC-22)", () => {
  it.skipIf(!hasGit())("AC-21: git status --porcelain não lista os temporários ignorados", async () => {
    const target = await initInstall("maker-git-ignore-");
    directories.push(target);
    await gitRepo(target);
    commitAll(target, "install inicial");

    await writeFile(join(target, ".maker/transaction.lock"), "lock");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(target, ".maker/transactions"), { recursive: true });
    await writeFile(join(target, ".maker/transactions/pending.json"), "{}");
    await mkdir(join(target, ".maker/mediation/items"), { recursive: true });
    await writeFile(join(target, ".maker/mediation/mediation.json"), "{}");
    await mkdir(join(target, ".maker/runs"), { recursive: true });
    await writeFile(join(target, ".maker/runs/run.jsonl"), "{}");

    const status = git(target, ["status", "--porcelain", "--untracked-files=all"]);
    expect(status).toBe("");
  });

  it.skipIf(!hasGit())("AC-22: git check-attr linguist-generated marca maker.lock e uma base em .maker/bases", async () => {
    const pack = await initInstall("maker-git-attr-pack-");
    directories.push(pack);
    await gitRepo(pack);
    // `linguist-generated=true` no .gitattributes reflete como valor "true" no check-attr (não "set").
    const lockAttr = git(pack, ["check-attr", "linguist-generated", "--", ".maker/maker.lock"]);
    expect(lockAttr.trim()).toBe(".maker/maker.lock: linguist-generated: true");

    const files = await initInstall("maker-git-attr-files-", { format: "files" });
    directories.push(files);
    await gitRepo(files);
    const manifest = await readManifest(files);
    const hash = Object.values(manifest!.files).find((entry) => entry.baseHash)!.baseHash!;
    const baseAttr = git(files, ["check-attr", "linguist-generated", "--", `.maker/bases/${hash}`]);
    expect(baseAttr.trim()).toBe(`.maker/bases/${hash}: linguist-generated: true`);
  });
});

describe("interop com o git — merge de duas branches (AC-40, D1)", () => {
  /** Cria o install de referência (pack) e o commit comum de onde as duas branches partem. */
  async function commonAncestor(prefix: string): Promise<string> {
    const target = await initInstall(prefix, { agents: ["claude"] });
    directories.push(target);
    await gitRepo(target);
    commitAll(target, "install comum");
    return target;
  }

  /** Edita `path` localmente e roda `maker update` para que a mudança entre no lockfile pela via normal. */
  async function editAndUpdate(target: string, path: string, suffix: string): Promise<void> {
    const current = await readFile(join(target, path), "utf-8");
    await writeFile(join(target, path), `${current}${suffix}\n`);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    vi.restoreAllMocks();
  }

  it.skipIf(!hasGit())("caso 1: entradas não adjacentes (AGENTS.md × architect.md) mesclam sem conflito", async () => {
    const target = await commonAncestor("maker-git-merge-nonadjacent-");
    const base = git(target, ["symbolic-ref", "--short", "HEAD"]).trim();

    git(target, ["checkout", "-q", "-b", "branch-a"]);
    await editAndUpdate(target, "AGENTS.md", "edição da branch A");
    commitAll(target, "branch A: AGENTS.md");

    git(target, ["checkout", "-q", base]);
    git(target, ["checkout", "-q", "-b", "branch-b"]);
    await editAndUpdate(target, ".maker/workflow/agents/architect.md", "edição da branch B");
    commitAll(target, "branch B: architect.md");

    git(target, ["checkout", "-q", "branch-a"]);
    git(target, ["merge", "--no-edit", "-q", "branch-b"]);

    const lockfile = await readFile(join(target, ".maker/maker.lock"), "utf-8");
    expect(lockfile).not.toMatch(/^(<{7}|={7}|>{7}|\|{7})/m);
    await expectGreenDoctor(target);
  });

  it.skipIf(!hasGit())("caso 2: entradas adjacentes (architect.md × code-reviewer.md) mesclam sem conflito", async () => {
    const target = await commonAncestor("maker-git-merge-adjacent-");
    const base = git(target, ["symbolic-ref", "--short", "HEAD"]).trim();

    git(target, ["checkout", "-q", "-b", "branch-a"]);
    await editAndUpdate(target, ".maker/workflow/agents/architect.md", "edição da branch A");
    commitAll(target, "branch A: architect.md");

    git(target, ["checkout", "-q", base]);
    git(target, ["checkout", "-q", "-b", "branch-b"]);
    await editAndUpdate(target, ".maker/workflow/agents/code-reviewer.md", "edição da branch B");
    commitAll(target, "branch B: code-reviewer.md");

    git(target, ["checkout", "-q", "branch-a"]);
    git(target, ["merge", "--no-edit", "-q", "branch-b"]);

    const lockfile = await readFile(join(target, ".maker/maker.lock"), "utf-8");
    expect(lockfile).not.toMatch(/^(<{7}|={7}|>{7}|\|{7})/m);
    await expectGreenDoctor(target);
  });

  it.skipIf(!hasGit())("caso 3: campo novo numa entrada (X) × edição da vizinha (Y) mesclam sem conflito", async () => {
    const target = await commonAncestor("maker-git-merge-newfield-");
    const base = git(target, ["symbolic-ref", "--short", "HEAD"]).trim();
    const x = ".maker/workflow/agents/architect.md";
    const y = ".maker/workflow/agents/code-reviewer.md";

    git(target, ["checkout", "-q", "-b", "branch-a"]);
    const manifest = (await readManifest(target))!;
    manifest.files[x] = { ...manifest.files[x]!, edited: true };
    await writeManifest(target, manifest);
    commitAll(target, "branch A: campo edited em architect.md");

    git(target, ["checkout", "-q", base]);
    git(target, ["checkout", "-q", "-b", "branch-b"]);
    await editAndUpdate(target, y, "edição da branch B");
    commitAll(target, "branch B: code-reviewer.md");

    git(target, ["checkout", "-q", "branch-a"]);
    git(target, ["merge", "--no-edit", "-q", "branch-b"]);

    const lockfile = await readFile(join(target, ".maker/maker.lock"), "utf-8");
    expect(lockfile).not.toMatch(/^(<{7}|={7}|>{7}|\|{7})/m);
    await expectGreenDoctor(target);
  });

  it.skipIf(!hasGit())("caso 4: unidade file nova (add-on saas) × edição da entrada vizinha mesclam sem conflito", async () => {
    const target = await commonAncestor("maker-git-merge-newunit-");
    const base = git(target, ["symbolic-ref", "--short", "HEAD"]).trim();
    const neighbor = ".specify/memory/project-rules.md";

    git(target, ["checkout", "-q", "-b", "branch-a"]);
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, {});
    commitAll(target, "branch A: add-on saas aplicado");

    git(target, ["checkout", "-q", base]);
    git(target, ["checkout", "-q", "-b", "branch-b"]);
    await editAndUpdate(target, neighbor, "edição da branch B");
    commitAll(target, "branch B: project-rules.md");

    git(target, ["checkout", "-q", "branch-a"]);
    git(target, ["merge", "--no-edit", "-q", "branch-b"]);

    const lockfile = await readFile(join(target, ".maker/maker.lock"), "utf-8");
    expect(lockfile).not.toMatch(/^(<{7}|={7}|>{7}|\|{7})/m);
    await expectGreenDoctor(target);
  });
});
