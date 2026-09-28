import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runUpdate } from "../../src/commands/update.js";
import { planUpdate, PENDING_EXIT_CODE } from "../../src/commands/update.js";
import { sha256 } from "../../src/render/manifest.js";
import { corruptBase, initInstall, putBase, readManifest, removeBase, writeManifest } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Instala o mesmo config nos dois formatos, para comparar o comportamento do update lado a lado. */
async function installBoth(prefix: string): Promise<{ pack: string; files: string }> {
  const pack = await initInstall(`${prefix}-pack-`, { format: "pack" });
  const files = await initInstall(`${prefix}-files-`, { format: "files" });
  directories.push(pack, files);
  return { pack, files };
}

function managedEntries(plan: Awaited<ReturnType<typeof planUpdate>>["plan"]) {
  return plan.changes.filter((change) => change.source !== "metadata")
    .map((change) => ({ path: change.path, action: change.action, reason: change.reason }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe("paridade pack ↔ files (AC-09/SC-003)", () => {
  it("sem customização: mesmo plano e mesmo código de saída nos dois formatos", async () => {
    const { pack, files } = await installBoth("maker-update-parity-clean");
    const packPlan = await planUpdate(pack, {});
    const filesPlan = await planUpdate(files, {});
    expect(managedEntries(packPlan.plan)).toEqual(managedEntries(filesPlan.plan));
  });

  it("mesclável: mesmo resultado e mesmo conjunto de entradas mescladas", async () => {
    const { pack, files } = await installBoth("maker-update-parity-merge");
    for (const target of [pack, files]) {
      const path = "AGENTS.md";
      const upstream = await readFile(join(target, path), "utf-8");
      const lines = upstream.split("\n");
      const base = lines.slice(0, -2).join("\n") + "\n";
      const local = base.replace(lines[0]!, `${lines[0]} local`);
      const baseHash = sha256(Buffer.from(base));
      await putBase(target, base);
      await writeFile(join(target, path), local);
      const manifest = (await readManifest(target))!;
      manifest.files[path] = { ...manifest.files[path]!, hash: baseHash, baseHash };
      await writeManifest(target, manifest);
    }
    const packPlan = await planUpdate(pack, {});
    const filesPlan = await planUpdate(files, {});
    expect(managedEntries(packPlan.plan)).toEqual(managedEntries(filesPlan.plan));
    await runUpdate({ target: pack });
    await runUpdate({ target: files });
    expect(await readFile(join(pack, "AGENTS.md"), "utf-8")).toBe(await readFile(join(files, "AGENTS.md"), "utf-8"));
  });

  it("conflito: mesmo código de saída (1) nos dois formatos", async () => {
    const { pack, files } = await installBoth("maker-update-parity-conflict");
    for (const target of [pack, files]) {
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
    }
    await expect(runUpdate({ target: pack })).rejects.toThrow("plano contém conflitos");
    await expect(runUpdate({ target: files })).rejects.toThrow("plano contém conflitos");
  });

  it("mediação: mesmo código de saída (pendências) nos dois formatos", async () => {
    const { pack, files } = await installBoth("maker-update-parity-mediation");
    for (const target of [pack, files]) {
      const path = "AGENTS.md";
      const upstream = await readFile(join(target, path), "utf-8");
      const local = upstream + "\ncustomização adicional sem base conhecida\n";
      await writeFile(join(target, path), local);
      const manifest = (await readManifest(target))!;
      // Manifest "legado" (sem baseHash): sem base exata para mesclar, vira mediação (não conflito).
      manifest.files[path] = { source: manifest.files[path]!.source, hash: sha256(Buffer.from(local)), edited: true };
      await writeManifest(target, manifest);
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target: pack, dryRun: true });
    expect(process.exitCode).toBe(PENDING_EXIT_CODE);
    process.exitCode = 0;
    await runUpdate({ target: files, dryRun: true });
    expect(process.exitCode).toBe(PENDING_EXIT_CODE);
  });

  it("base ausente: mesmo tratamento (preservado, mediado) nos dois formatos", async () => {
    const { pack, files } = await installBoth("maker-update-parity-missing");
    for (const target of [pack, files]) {
      const path = ".specify/memory/constitution.md";
      const manifest = (await readManifest(target))!;
      const baseHash = manifest.files[path]!.baseHash!;
      await writeFile(join(target, path), (await readFile(join(target, path), "utf-8")) + "\ncustomização local\n");
      await removeBase(target, baseHash);
      await corruptBase(target, baseHash);
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target: pack, dryRun: true });
    expect(process.exitCode).toBe(PENDING_EXIT_CODE);
    process.exitCode = 0;
    await runUpdate({ target: files, dryRun: true });
    expect(process.exitCode).toBe(PENDING_EXIT_CODE);
  });
});
