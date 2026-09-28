import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { mergeText, runUpdate } from "../src/commands/update.js";
import { sha256 } from "../src/render/manifest.js";
import { readManifest, writeManifest, putBase } from "./helpers/state.js";

const FIXTURE = join(__dirname, "..", "fixtures", "example.config.json");

async function initialized(prefix: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), prefix));
  await runInit({ target, config: FIXTURE, yes: true });
  return target;
}

describe("maker update transacional", () => {
  it("mescla regiões independentes e rejeita conflitos ou binários", () => {
    const base = Buffer.from("primeira\nsegunda\nterceira\n");
    const local = Buffer.from("primeira local\nsegunda\nterceira\n");
    const upstream = Buffer.from("primeira\nsegunda\nterceira upstream\n");
    expect(mergeText(local, base, upstream)?.toString()).toBe("primeira local\nsegunda\nterceira upstream\n");
    expect(mergeText(Buffer.from("local\n"), Buffer.from("base\n"), Buffer.from("upstream\n"))).toBeNull();
    expect(mergeText(Buffer.from([0]), Buffer.from([0]), Buffer.from([1]))).toBeNull();
  });

  it("mescla mudanças locais e upstream independentes", async () => {
    const target = await initialized("maker-update-merge-");
    const path = "AGENTS.md";
    const upstream = await readFile(join(target, path), "utf-8");
    const lines = upstream.split("\n");
    const base = lines.slice(0, -2).join("\n") + "\n";
    const local = base.replace(lines[0]!, `${lines[0]} local`);
    const baseHash = sha256(base);
    await mkdir(join(target, ".maker", "bases"), { recursive: true });
    await putBase(target, base);
    await writeFile(join(target, path), local);
    const manifest = (await readManifest(target))!;
    manifest.files[path] = { ...manifest.files[path]!, hash: baseHash, baseHash };
    await writeManifest(target, manifest);
    await runUpdate({ target });
    const result = await readFile(join(target, path), "utf-8");
    expect(result).toContain(`${lines[0]} local`);
    expect(result).toContain(lines.at(-2)!);
  });

  it("preserva edições já mescladas em updates seguintes", async () => {
    const target = await initialized("maker-update-remerge-");
    const path = "AGENTS.md";
    const upstream = await readFile(join(target, path), "utf-8");
    const lines = upstream.split("\n");
    const base = lines.slice(0, -2).join("\n") + "\n";
    const local = base.replace(lines[0]!, `${lines[0]} local`);
    const baseHash = sha256(base);
    await mkdir(join(target, ".maker", "bases"), { recursive: true });
    await putBase(target, base);
    await writeFile(join(target, path), local);
    const manifest = (await readManifest(target))!;
    manifest.files[path] = { ...manifest.files[path]!, hash: baseHash, baseHash };
    await writeManifest(target, manifest);
    await runUpdate({ target });
    const merged = await readFile(join(target, path), "utf-8");
    expect(merged).toContain(`${lines[0]} local`);
    await runUpdate({ target });
    expect(await readFile(join(target, path), "utf-8")).toBe(merged);
    // Merge cujo resultado já é o conteúdo atual não aparece como mesclado.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(log.mock.calls.flat().join("\n")).not.toMatch(/^merge\s/m);
    log.mockRestore();
  });

  it("update em outro dia não reescreve arquivos intactos pela data de geração", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
      const target = await initialized("maker-update-day-");
      const constitution = join(target, ".specify/memory/constitution.md");
      const before = await readFile(constitution, "utf-8");
      expect(before).toContain("maker em 2026-01-01");
      vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await runUpdate({ target, dryRun: true });
      expect(log.mock.calls.flat().join("\n")).not.toMatch(/^(create|update|remove|merge)\s/m);
      await runUpdate({ target });
      expect(await readFile(constitution, "utf-8")).toBe(before);
      log.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("conflito preserva arquivos e manifest", async () => {
    const target = await initialized("maker-update-conflict-");
    const path = "AGENTS.md";
    const upstream = await readFile(join(target, path), "utf-8");
    const first = upstream.split("\n")[0]!;
    const base = upstream.replace(first, "BASE");
    const local = upstream.replace(first, "LOCAL");
    const baseHash = sha256(base);
    await putBase(target, base);
    await writeFile(join(target, path), local);
    const manifest = (await readManifest(target))!;
    manifest.files[path] = { ...manifest.files[path]!, hash: baseHash, baseHash };
    await writeManifest(target, manifest);
    const manifestBefore = await readFile(join(target, ".maker", "manifest.json"));
    await expect(runUpdate({ target })).rejects.toThrow("plano contém conflitos");
    expect(await readFile(join(target, path), "utf-8")).toBe(local);
    expect(await readFile(join(target, ".maker", "manifest.json"))).toEqual(manifestBefore);
  });

  it("dry-run não altera conteúdo nem timestamp controlado", async () => {
    const target = await initialized("maker-update-dry-");
    const manifestPath = join(target, ".maker", "manifest.json");
    const before = await readFile(manifestPath);
    const mtime = (await stat(manifestPath)).mtimeMs;
    await runUpdate({ target, dryRun: true });
    expect(await readFile(manifestPath)).toEqual(before);
    expect((await stat(manifestPath)).mtimeMs).toBe(mtime);
  });

  it("sem install, --dry-run lança e não cria .maker/ (regressão: antes deixava o diretório)", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-update-noinstall-dry-"));
    await expect(runUpdate({ target, dryRun: true })).rejects.toThrow("Nenhum install");
    await expect(stat(join(target, ".maker"))).rejects.toThrow();
  });

  it("sem install, aplicado lança e não cria .maker/", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-update-noinstall-apply-"));
    await expect(runUpdate({ target })).rejects.toThrow("Nenhum install");
    await expect(stat(join(target, ".maker"))).rejects.toThrow();
  });
});
