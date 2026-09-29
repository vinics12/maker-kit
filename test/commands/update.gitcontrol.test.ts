import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runUpdate } from "../../src/commands/update.js";
import { sha256 } from "../../src/render/manifest.js";
import { GIT_CONTROL_FILES } from "../../src/state/paths.js";
import { initInstall, readManifest, snapshotTree, writeManifest } from "../helpers/state.js";

const ROOT_GITATTRIBUTES = "templates/engine/common/.gitattributes";
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("update e os arquivos de controle do git (AC-23, FR-029, FR-030)", () => {
  it("AC-23: edição local em .maker/.gitignore (já rastreado) sobrevive ao update, mesclada como qualquer arquivo gerenciado", async () => {
    const target = await initInstall("maker-update-gitcontrol-ac23-");
    directories.push(target);
    const path = ".maker/.gitignore";
    const upstream = await readFile(join(target, path), "utf-8");
    const customized = `${upstream}/algo-do-dono/\n`;
    await writeFile(join(target, path), customized);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(log.mock.calls.flat().join("\n")).toMatch(/\d+ mesclado\(s\)\./);
    expect(await readFile(join(target, path), "utf-8")).toBe(customized);
    const entry = (await readManifest(target))!.files[path];
    expect(entry?.hash).toBe(sha256(Buffer.from(customized)));
    expect(entry?.baseHash).toBe(sha256(Buffer.from(upstream)));
    expect(process.exitCode).not.toBe(1);
  });

  it("FR-029: update cria os dois arquivos de controle em install existente que ainda não os tinha, e os registra com base", async () => {
    const target = await initInstall("maker-update-gitcontrol-create-");
    directories.push(target);
    const before = (await readManifest(target))!;
    const rest = { ...before.files };
    const upstreamByPath = new Map<string, Buffer>();
    for (const path of GIT_CONTROL_FILES) {
      upstreamByPath.set(path, await readFile(join(target, path)));
      delete rest[path];
      await unlink(join(target, path));
    }
    await writeManifest(target, { ...before, files: rest });

    await runUpdate({ target });

    const after = (await readManifest(target))!;
    for (const path of GIT_CONTROL_FILES) {
      const upstream = upstreamByPath.get(path)!;
      expect(await readFile(join(target, path))).toEqual(upstream);
      expect(after.files[path]?.baseHash).toBe(sha256(upstream));
      expect(after.files[path]?.hash).toBe(sha256(upstream));
    }
  });

  it("FR-030: init + update não tocam o .gitattributes de raiz e não criam .gitignore de raiz", async () => {
    const engineRoot = await readFile(join(__dirname, "..", "..", ROOT_GITATTRIBUTES), "utf-8");
    const target = await initInstall("maker-update-gitcontrol-root-");
    directories.push(target);
    expect(await readFile(join(target, ".gitattributes"), "utf-8")).toBe(engineRoot);
    expect(await stat(join(target, ".gitignore")).then(() => true, () => false)).toBe(false);

    const before = await snapshotTree(target);
    await runUpdate({ target });

    expect(await readFile(join(target, ".gitattributes"), "utf-8")).toBe(engineRoot);
    expect(await stat(join(target, ".gitignore")).then(() => true, () => false)).toBe(false);
    // O update não tocou nenhum arquivo de raiz além do que já era gerenciado (nenhum novo controle git fora de `.maker`).
    const after = await snapshotTree(target);
    expect(after.get(".gitattributes")).toBe(before.get(".gitattributes"));
  });
});
