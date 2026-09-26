import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runUpdate } from "../src/commands/update.js";
import { DEFAULT_MEDIATION_DIR } from "../src/commands/mediation.js";
import { readManifest, sha256, writeManifest } from "../src/render/manifest.js";
import { applyAddon } from "../src/addons/apply.js";
import { loadAddon } from "../src/addons/loader.js";

const FIXTURE = join(__dirname, "..", "fixtures", "example.config.json");
const constitution = ".specify/memory/constitution.md";
const directories: string[] = [];

interface Item { id: string; path: string; category: string; group: string | null; baseHash: string | null }

async function initialized(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "maker-mediation-"));
  directories.push(target);
  await runInit({ target, config: FIXTURE, yes: true });
  return target;
}

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
  const local = upstream.replace(first, "LOCAL") + "\nRegra local do dono.\n";
  const baseHash = sha256(Buffer.from(base));
  await writeFile(join(target, ".maker", "bases", baseHash), base);
  await writeFile(join(target, path), local);
  const manifest = (await readManifest(target))!;
  manifest.files[path] = { ...manifest.files[path]!, hash: baseHash, baseHash };
  await writeManifest(target, manifest);
  return { upstream, local };
}

async function exported(target: string): Promise<{ dir: string; items: Item[] }> {
  await runUpdate({ target, export: true });
  const dir = join(target, DEFAULT_MEDIATION_DIR);
  if (!existsSync(join(dir, "mediation.json"))) return { dir, items: [] };
  return { dir, items: JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8")).items };
}

describe("mediação de update", () => {
  it("exporta conflito com base/local/upstream e aplica a proposta de forma estável", async () => {
    const target = await initialized();
    const { upstream, local } = await conflicted(target);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(log.mock.calls.flat().join("\n")).toContain("precisam de mediação");
    const { dir, items } = await exported(target);
    expect(items).toEqual([expect.objectContaining({ path: "AGENTS.md", category: "conflict" })]);
    const itemDir = join(dir, "items", items[0]!.id);
    expect(await readFile(join(itemDir, "local"), "utf-8")).toBe(local);
    expect(await readFile(join(itemDir, "upstream"), "utf-8")).toBe(upstream);
    expect(existsSync(join(itemDir, "base"))).toBe(true);
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(local);

    const proposal = upstream + "\nRegra local do dono.\n";
    await writeFile(join(itemDir, "resolved"), proposal);
    await runUpdate({ target, applyResolutions: true, dryRun: true });
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(local);
    await runUpdate({ target, applyResolutions: true });
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(proposal);
    expect(existsSync(dir)).toBe(false);
    const manifest = (await readManifest(target))!;
    expect(manifest.files["AGENTS.md"]!.baseHash).toBe(sha256(Buffer.from(upstream)));

    await runUpdate({ target });
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(proposal);
    expect((await exported(target)).items).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  it.each([
    ["marcadores de conflito", "<<<<<<< local\nA\n=======\nB\n>>>>>>> upstream\n"],
    ["conteúdo vazio", "  \n"],
  ])("rejeita proposta com %s sem alterar nada", async (_name, proposal) => {
    const target = await initialized();
    const { local } = await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { dir, items } = await exported(target);
    await writeFile(join(dir, "items", items[0]!.id, "resolved"), proposal);
    const manifest = await readFile(join(target, ".maker/manifest.json"));
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(local);
    expect(await readFile(join(target, ".maker/manifest.json"))).toEqual(manifest);
  });

  it("rejeita proposta quando o arquivo mudou depois da exportação", async () => {
    const target = await initialized();
    const { upstream } = await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { dir, items } = await exported(target);
    await writeFile(join(dir, "items", items[0]!.id, "resolved"), upstream);
    await appendFile(join(target, "AGENTS.md"), "edição concorrente\n");
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(error.mock.calls.flat().join("\n")).toContain("mudou desde a exportação");
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toContain("edição concorrente");
  });

  it("media alvo de add-on com template novo sem perder o bloco", async () => {
    const target = await initialized();
    await applyAddon(target, await loadAddon("saas"), { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" });
    // Simula um install feito com um template anterior da constitution.
    const current = await readFile(join(target, constitution), "utf-8");
    const previous = "Linha do template anterior.\n";
    const previousHash = sha256(Buffer.from(previous));
    await writeFile(join(target, ".maker", "bases", previousHash), previous);
    const manifest = (await readManifest(target))!;
    manifest.files[constitution] = { ...manifest.files[constitution]!, baseHash: previousHash };
    await writeManifest(target, manifest);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { dir, items } = await exported(target);
    const item = items.find((entry) => entry.path === constitution)!;
    expect(item).toMatchObject({ category: "addon", baseHash: previousHash });
    const itemDir = join(dir, "items", item.id);
    await writeFile(join(itemDir, "resolved"), await readFile(join(itemDir, "upstream"), "utf-8"));
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(await readFile(join(target, constitution), "utf-8")).toBe(current);

    const proposal = current + "\nPrincípio autoral do dono.\n";
    await writeFile(join(itemDir, "resolved"), proposal);
    await runUpdate({ target, applyResolutions: true });
    expect(await readFile(join(target, constitution), "utf-8")).toBe(proposal);
    const after = (await readManifest(target))!.files[constitution]!;
    expect(after.source).toBe("addon:saas");
    expect(after.baseHash).toBe(sha256(await readFile(join(target, ".maker", "bases", after.baseHash!))));
    expect((await exported(target)).items.some((entry) => entry.path === constitution)).toBe(false);
  });

  it("não confia no índice nem na cópia local exportados", async () => {
    const target = await initialized();
    await applyAddon(target, await loadAddon("saas"), { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" });
    const previous = "Linha do template anterior.\n";
    const previousHash = sha256(Buffer.from(previous));
    await writeFile(join(target, ".maker", "bases", previousHash), previous);
    const manifest = (await readManifest(target))!;
    manifest.files[constitution] = { ...manifest.files[constitution]!, baseHash: previousHash };
    await writeManifest(target, manifest);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { dir, items } = await exported(target);
    const item = items.find((entry) => entry.path === constitution)!;
    const itemDir = join(dir, "items", item.id);
    const upstream = await readFile(join(itemDir, "upstream"), "utf-8");
    // Apagar os blocos da cópia local exportada não libera uma proposta que os remove.
    await writeFile(join(itemDir, "local"), upstream);
    await writeFile(join(itemDir, "resolved"), upstream);
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(error.mock.calls.flat().join("\n")).toContain("blocos de add-on removidos");
    // Caminho adulterado no índice não escreve fora dos arquivos gerenciados.
    const index = JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8"));
    index.items = index.items.map((entry: Item) => entry.id === item.id ? { ...entry, path: ".maker/manifest.json" } : entry);
    await writeFile(join(dir, "mediation.json"), JSON.stringify(index));
    const manifestBefore = await readFile(join(target, ".maker/manifest.json"));
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(error.mock.calls.flat().join("\n")).toContain("fora dos arquivos gerenciados");
    expect(await readFile(join(target, ".maker/manifest.json"))).toEqual(manifestBefore);
  });

  it("recusa exportar sem config recuperável", async () => {
    const target = await initialized();
    const manifest = (await readManifest(target))!;
    delete manifest.config;
    await writeManifest(target, manifest);
    await rm(join(target, "maker.config.json"), { force: true });
    await expect(runUpdate({ target, export: true })).rejects.toThrow("Config do projeto não recuperada");
  });

  it("não sobrescreve diretório que não é uma exportação", async () => {
    const target = await initialized();
    await conflicted(target);
    const dir = join(target, "notas");
    await mkdir(dir);
    await writeFile(join(dir, "importante.md"), "não apagar\n");
    await expect(runUpdate({ target, export: "notas" })).rejects.toThrow("não é uma exportação do maker");
    expect(await readFile(join(dir, "importante.md"), "utf-8")).toBe("não apagar\n");
  });
});
