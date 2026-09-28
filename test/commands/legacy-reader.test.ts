import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runUpdate } from "../../src/commands/update.js";
import { runAgentAdd, runAgentList } from "../../src/commands/agent.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { exportMediation } from "../../src/commands/mediation.js";
import { MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall, snapshotTree, writeAddonStateFile } from "../helpers/state.js";
import { legacyCli, runLegacy } from "../helpers/legacy-binary.js";

const REPO_ROOT = join(__dirname, "..", "..");
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

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
    execFileSync("git", ["cat-file", "-e", "v1.0.0"], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tagSource(path: string): string | null {
  try {
    return execFileSync("git", ["show", `v1.0.0:${path}`], { cwd: REPO_ROOT, encoding: "utf-8" });
  } catch {
    return null;
  }
}

// --- Simuladores fiéis da 1.0.0 (só leem; a referência de cada um é a linha citada) ---

/** v1.0.0:src/render/manifest.ts:53-57 (`readManifest`): existência de `.maker/manifest.json`. */
function legacySeesManifest(target: string): boolean {
  return existsSync(join(target, MANIFEST_FILE));
}

function legacyAddonStatePath(target: string, id: string): string {
  return join(target, ".maker", "addons", `${id}.json`);
}

/** v1.0.0:src/addons/state.ts:29-31 (`isAddonApplied`): `existsSync(.maker/addons/<id>.json)`. */
function legacyIsAddonApplied(target: string, id: string): boolean {
  return existsSync(legacyAddonStatePath(target, id));
}

/** v1.0.0:src/addons/state.ts:34-41 (`readAddonState`): `existsSync` + `JSON.parse` + schema. */
function legacyReadAddonState(target: string, id: string): unknown | null {
  const p = legacyAddonStatePath(target, id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

type RemoveOutcome = "not-applied" | "would-proceed";

/**
 * v1.0.0:src/commands/remove.ts:13 (`isAddonApplied`) → v1.0.0:src/addons/state.ts:34-41
 * (`readAddonState`) → v1.0.0:src/addons/apply.ts:224-226 (`readManifest` **opcional**: `null` não
 * bloqueia). Este é o gatilho do aceite: com `.maker/addons/<id>.json` presente e sem
 * `.maker/manifest.json` (install em pack), a 1.0.0 conclui "would-proceed" — a regressão observada.
 */
function legacyRemoveSimulator(target: string, id: string): RemoveOutcome {
  if (!legacyIsAddonApplied(target, id)) return "not-applied";
  legacyReadAddonState(target, id);
  legacySeesManifest(target);
  return "would-proceed";
}

/** v1.0.0:src/commands/add.ts:53 (log) → v1.0.0:src/addons/apply.ts:98-100 (`readManifest`, aborta). */
function legacyAddSimulator(target: string, id: string): "aborts-no-install" | "would-proceed" {
  legacyIsAddonApplied(target, id);
  return legacySeesManifest(target) ? "would-proceed" : "aborts-no-install";
}

/** v1.0.0:src/commands/list.ts:58-61: enumera `.maker/addons/*.json`; sem escrita. */
function legacyListSeesApplied(target: string, id: string): boolean {
  return legacyIsAddonApplied(target, id);
}

describe("leitor legado da 1.0.0 (AC-37): install em pack é 'nenhum install' para cada comando", () => {
  it("update / --export / --apply-resolutions: readManifest → existsSync(.maker/manifest.json)", async () => {
    // v1.0.0:src/commands/update.ts:58-59 (`runUpdate` → `planUpdate`) → 113-114 (`readManifest`, aborta)
    const target = await initInstall("maker-legacy-reader-update-", { format: "pack" });
    directories.push(target);
    const before = await snapshotTree(target);
    expect(legacySeesManifest(target)).toBe(false);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("agent add: v1.0.0:src/commands/agent.ts:21-22", async () => {
    const target = await initInstall("maker-legacy-reader-agent-", { format: "pack" });
    directories.push(target);
    expect(legacySeesManifest(target)).toBe(false);
  });

  it("doctor: v1.0.0:src/commands/doctor.ts:18-20", async () => {
    const target = await initInstall("maker-legacy-reader-doctor-", { format: "pack" });
    directories.push(target);
    expect(legacySeesManifest(target)).toBe(false);
  });

  it("add: log por .maker/addons/<id>.json, aborto real em readManifest", async () => {
    const target = await initInstall("maker-legacy-reader-add-", { format: "pack", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    expect(legacyAddSimulator(target, "saas")).toBe("aborts-no-install");
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("add (fixture de controle): num install em files, o leitor legado vê o manifest e prossegue", async () => {
    const target = await initInstall("maker-legacy-reader-add-control-", { format: "files", addon: "saas" });
    directories.push(target);
    expect(legacyAddSimulator(target, "saas")).toBe("would-proceed");
  });

  it("remove (AC-42): sem .maker/addons/saas.json → not-applied, nunca escreve", async () => {
    const target = await initInstall("maker-legacy-reader-remove-", { format: "pack", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    expect(legacyRemoveSimulator(target, "saas")).toBe("not-applied");
    expect(await snapshotTree(target)).toEqual(before);
  });

  it("remove (AC-42, fixture de controle): com .maker/addons/saas.json recriado → would-proceed (prova a regressão)", async () => {
    const target = await initInstall("maker-legacy-reader-remove-control-", { format: "pack", addon: "saas" });
    directories.push(target);
    // Recria o JSON a partir da unidade do lockfile — como um leitor legado o veria se ele existisse.
    const { readAddonStates } = await import("../helpers/state.js");
    const record = (await readAddonStates(target)).get("saas")!;
    await writeAddonStateFile(target, "saas", record);
    expect(legacyRemoveSimulator(target, "saas")).toBe("would-proceed");
  });

  it("list: enumera .maker/addons/*.json; em pack não vê saas como aplicado", async () => {
    const target = await initInstall("maker-legacy-reader-list-", { format: "pack", addon: "saas" });
    directories.push(target);
    const before = await snapshotTree(target);
    expect(legacyListSeesApplied(target, "saas")).toBe(false);
    expect(await snapshotTree(target)).toEqual(before);
  });

  it.skipIf(!hasGit() || !hasTag())("pino da tag: as linhas citadas ainda contêm os trechos replicados", () => {
    const removeSrc = tagSource("src/commands/remove.ts");
    const stateSrc = tagSource("src/addons/state.ts");
    const applySrc = tagSource("src/addons/apply.ts");
    const manifestSrc = tagSource("src/render/manifest.ts");
    expect(removeSrc).toContain("isAddonApplied(targetDir, id)");
    expect(stateSrc).toContain("readAddonState(");
    expect(applySrc).toContain("readManifest(targetDir)");
    expect(manifestSrc).toContain("readManifest(");
  });
});

describe("um install em pack continua operando pelo maker atual (contraste com o leitor legado)", () => {
  it("add/agent add/mediação/doctor num install em pack: leitor legado conclui 'nenhum install', sem escrever", async () => {
    const target = await initInstall("maker-legacy-reader-cmds-", { format: "pack" });
    directories.push(target);
    expect(legacySeesManifest(target)).toBe(false);

    await expect(runAgentAdd("codex", { target })).resolves.toBeUndefined();
    expect(legacySeesManifest(target)).toBe(false);

    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(exportMediation(target, true, [], {})).resolves.toBeUndefined();
    expect(legacySeesManifest(target)).toBe(false);

    await expect(runDoctor({ target })).resolves.toBeUndefined();
    expect(legacySeesManifest(target)).toBe(false);

    await expect(runAgentList({ target })).resolves.toBeUndefined();
    expect(legacySeesManifest(target)).toBe(false);
  });

  it("update de verdade segue operando no lockfile; nada muda para o leitor legado", async () => {
    const target = await initInstall("maker-legacy-reader-update-real-", { format: "pack" });
    directories.push(target);
    await expect(runUpdate({ target })).resolves.toBeUndefined();
    expect(legacySeesManifest(target)).toBe(false);
  });
});

describe("reforço com o binário real da 1.0.0 (S7)", () => {
  it("remove/update/add/agent add/doctor/list/init contra um install em pack — sem escrita, mensagens do contrato 1.x", async (ctx) => {
    const handle = await legacyCli();
    if ("skip" in handle) {
      ctx.skip(handle.skip);
      return;
    }
    const target = await initInstall("maker-legacy-binary-", { format: "pack", addon: "saas" });
    directories.push(target);
    try {
      let before = await snapshotTree(target);
      let result = runLegacy(handle.cli, ["remove", "saas", "--target", target]);
      expect(result.code).not.toBe(0);
      expect(result.stderr + result.stdout).toContain("não está aplicado");
      expect(await snapshotTree(target)).toEqual(before);

      for (const args of [["update", "--target", target], ["update", "--export", "--target", target]]) {
        before = await snapshotTree(target);
        result = runLegacy(handle.cli, args);
        expect(result.code).not.toBe(0);
        expect(result.stderr + result.stdout).toContain("Nenhum install do maker");
        expect(await snapshotTree(target)).toEqual(before);
      }

      before = await snapshotTree(target);
      result = runLegacy(handle.cli, ["add", "saas", "--yes", "--target", target]);
      expect(result.code).not.toBe(0);
      expect(result.stderr + result.stdout).toContain("Nenhum install do maker");
      expect(await snapshotTree(target)).toEqual(before);

      before = await snapshotTree(target);
      result = runLegacy(handle.cli, ["agent", "add", "codex", "--target", target]);
      expect(result.code).not.toBe(0);
      expect(result.stderr + result.stdout).toContain("Nenhum install do maker");
      expect(await snapshotTree(target)).toEqual(before);

      before = await snapshotTree(target);
      result = runLegacy(handle.cli, ["doctor", "--target", target]);
      expect(result.code).not.toBe(0);
      expect(await snapshotTree(target)).toEqual(before);

      before = await snapshotTree(target);
      result = runLegacy(handle.cli, ["list", "--target", target]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("saas");
      expect(await snapshotTree(target)).toEqual(before);

      before = await snapshotTree(target);
      result = runLegacy(handle.cli, ["init", "--yes", "--name", "X", "--agent", "claude", "--target", target]);
      expect(result.code).not.toBe(0);
      expect(await snapshotTree(target)).toEqual(before);
    } finally {
      await handle.cleanup();
    }
  }, 60_000);
});
