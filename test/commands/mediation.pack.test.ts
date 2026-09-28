import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runUpdate } from "../../src/commands/update.js";
import { DEFAULT_MEDIATION_DIR } from "../../src/commands/mediation.js";
import { sha256 } from "../../src/render/manifest.js";
import { BASES_DIR, MANIFEST_FILE, LOCKFILE, GIT_CONTROL_FILES } from "../../src/state/paths.js";
import { initInstall, lockfileText, putBase, readManifest, writeManifest } from "../helpers/state.js";

const directories: string[] = [];
const constitution = ".specify/memory/constitution.md";

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** AGENTS.md com mudança local e upstream na mesma linha: o merge automático não resolve. */
async function conflicted(target: string): Promise<{ upstream: string; local: string }> {
  const path = "AGENTS.md";
  const upstream = await readFile(join(target, path), "utf-8");
  const first = upstream.split("\n")[0]!;
  const base = upstream.replace(first, "BASE");
  const local = upstream.replace(first, "LOCAL");
  const baseHash = sha256(Buffer.from(base));
  await putBase(target, base);
  await writeFile(join(target, path), local);
  const manifest = (await readManifest(target))!;
  manifest.files[path] = { ...manifest.files[path]!, hash: baseHash, baseHash };
  await writeManifest(target, manifest);
  return { upstream, local };
}

describe("mediação em pack (AC-30, AC-13) e B1", () => {
  it("AC-13: --export grava fora do estado (não cria manifest.json/maker.lock novos, só .maker/mediation)", async () => {
    const target = await initInstall("maker-mediation-pack-export-");
    directories.push(target);
    await conflicted(target);
    const lockBefore = await lockfileText(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, export: true });
    expect(existsSync(join(target, DEFAULT_MEDIATION_DIR, "mediation.json"))).toBe(true);
    expect(await lockfileText(target)).toBe(lockBefore);
  });

  it("AC-30: --apply-resolutions em pack grava a base nova só no lockfile (sem .maker/bases)", async () => {
    const target = await initInstall("maker-mediation-pack-apply-");
    directories.push(target);
    const { upstream } = await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, export: true });
    const dir = join(target, DEFAULT_MEDIATION_DIR);
    const index = JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8"));
    const item = index.items[0];
    await writeFile(join(dir, "items", item.id, "resolved"), upstream);
    await runUpdate({ target, applyResolutions: true, acceptDropped: true });
    expect(existsSync(join(target, BASES_DIR))).toBe(false);
    expect(existsSync(join(target, MANIFEST_FILE))).toBe(false);
    expect(existsSync(join(target, LOCKFILE))).toBe(true);
    expect((await readManifest(target))!.files["AGENTS.md"]!.baseHash).toBe(sha256(Buffer.from(upstream)));
  });

  describe.each(GIT_CONTROL_FILES)("B1: proposta para %s", (controlPath) => {
    it("é aceita e aplicada, registrando baseHash do upstream", async () => {
      const target = await initInstall(`maker-mediation-pack-b1-accept-${controlPath.replace(/\W/g, "-")}-`);
      directories.push(target);
      const before = await readManifest(target);
      const rest = { ...before!.files };
      delete rest[controlPath];
      await writeManifest(target, { ...before!, files: rest });
      await writeFile(join(target, controlPath), "# customizado\n/algo/\n");
      vi.spyOn(console, "log").mockImplementation(() => {});
      await runUpdate({ target, export: true });
      const dir = join(target, DEFAULT_MEDIATION_DIR);
      const index = JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8"));
      const item = index.items.find((i: { path: string }) => i.path === controlPath);
      expect(item).toBeDefined();
      const upstream = await readFile(join(dir, "items", item.id, "upstream"));
      await writeFile(join(dir, "items", item.id, "resolved"), upstream);
      await runUpdate({ target, applyResolutions: true, acceptDropped: true });
      const entry = (await readManifest(target))!.files[controlPath];
      expect(entry).toBeDefined();
      expect(entry!.baseHash).toBe(sha256(upstream));
      expect(await readFile(join(target, controlPath))).toEqual(upstream);
    });
  });

  it("B1: caminhos de metadados do estado continuam recusados ('fora dos arquivos gerenciados')", async () => {
    const target = await initInstall("maker-mediation-pack-b1-reject-");
    directories.push(target);
    const { upstream } = await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runUpdate({ target, export: true });
    const dir = join(target, DEFAULT_MEDIATION_DIR);
    const indexPath = join(dir, "mediation.json");
    const original = JSON.parse(await readFile(indexPath, "utf-8"));
    const forbidden = [".maker/manifest.json", ".maker/maker.lock", `${BASES_DIR}/${"a".repeat(64)}`, ".maker/addons/saas.json"];
    for (const path of forbidden) {
      const index = JSON.parse(JSON.stringify(original));
      index.items[0].path = path;
      await writeFile(indexPath, JSON.stringify(index));
      await writeFile(join(dir, "items", index.items[0].id, "resolved"), upstream);
      await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
      expect(error.mock.calls.flat().join("\n")).toContain("fora dos arquivos gerenciados");
      error.mockClear();
    }
  });
});
