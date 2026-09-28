import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { PENDING_EXIT_CODE, runUpdate, sentinelConfig } from "../src/commands/update.js";
import { runDoctor } from "../src/commands/doctor.js";
import { parseConfig } from "../src/config/schema.js";
import { upsertBlock } from "../src/addons/inject.js";
import { DEFAULT_MEDIATION_DIR, mediationHint } from "../src/commands/mediation.js";
import { sha256 } from "../src/render/manifest.js";
import { readManifest, writeManifest, putBase } from "./helpers/state.js";
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
  await putBase(target, base);
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

async function addonInstall(): Promise<string> {
  const target = await initialized();
  await applyAddon(target, await loadAddon("saas"), { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" });
  return target;
}

async function upstreamOf(target: string, path: string): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), "maker-mediation-up-"));
  directories.push(staging);
  await runInit({ target: staging, config: FIXTURE, yes: true });
  return readFile(join(staging, path), "utf-8");
}

/** Registra `template` como base (template da versão anterior) e grava `content` como o arquivo atual. */
async function simulatePreviousTemplate(target: string, template: string, content: string): Promise<void> {
  const baseHash = sha256(Buffer.from(template));
  await putBase(target, template);
  await writeFile(join(target, constitution), content);
  const manifest = (await readManifest(target))!;
  manifest.files[constitution] = { ...manifest.files[constitution]!, hash: sha256(Buffer.from(content)), baseHash };
  await writeManifest(target, manifest);
}

/** O dono e o template novo mudaram a mesma linha da constitution com o add-on aplicado. */
async function addonConflict(target: string): Promise<{ dir: string; item: Item; current: string }> {
  const applied = await readFile(join(target, constitution), "utf-8");
  const [first] = applied.split("\n");
  const previousTemplate = (await upstreamOf(target, constitution)).replace(first!, "# Constitution antiga");
  const current = applied.replace(first!, "Linha do dono.");
  await simulatePreviousTemplate(target, previousTemplate, current);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { dir, items } = await exported(target);
  const item = items.find((entry) => entry.path === constitution)!;
  expect(item).toMatchObject({ category: "addon" });
  return { dir, item, current };
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

    // A proposta troca a linha "LOCAL" do dono pela do template: sem aprovação explícita, é recusada.
    const proposal = upstream + "\nRegra local do dono.\n";
    await writeFile(join(itemDir, "resolved"), proposal);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runUpdate({ target, applyResolutions: true, dryRun: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(error.mock.calls.flat().join("\n")).toMatch(/descarta 1 linha\(s\) customizada\(s\):\n +- LOCAL/);
    await runUpdate({ target, applyResolutions: true, dryRun: true, acceptDropped: true });
    expect(log.mock.calls.flat().join("\n")).toContain("- LOCAL");
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(local);
    await runUpdate({ target, applyResolutions: true, acceptDropped: true });
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

  it("mescla template novo em alvo de add-on sem mediação quando não há sobreposição", async () => {
    const target = await addonInstall();
    const current = await readFile(join(target, constitution), "utf-8");
    // Install feito com um template anterior: a primeira linha era outra e o dono não a mudou.
    const [first] = current.split("\n");
    const previousTemplate = (await upstreamOf(target, constitution)).replace(first!, "# Constitution antiga");
    await simulatePreviousTemplate(target, previousTemplate, current.replace(first!, "# Constitution antiga"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    const merged = await readFile(join(target, constitution), "utf-8");
    expect(merged).toBe(current);
    expect(log.mock.calls.flat().join("\n")).not.toContain("precisam de mediação");
    const entry = (await readManifest(target))!.files[constitution]!;
    expect(entry.source).toBe("addon:saas");
    expect(entry.baseHash).toBe(sha256(Buffer.from(await upstreamOf(target, constitution))));
  });

  it("media conflito real em alvo de add-on e protege os blocos", async () => {
    const target = await addonInstall();
    const { dir, item, current } = await addonConflict(target);
    const itemDir = join(dir, "items", item.id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const block = current.match(/<!-- maker:addon:saas:start -->\n([\s\S]*?)\n<!-- maker:addon:saas:end -->/)!;
    const reject = async (proposal: string, message: string) => {
      await writeFile(join(itemDir, "resolved"), proposal);
      await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
      expect(error.mock.calls.flat().join("\n")).toContain(message);
      expect(await readFile(join(target, constitution), "utf-8")).toBe(current);
    };
    await reject(await readFile(join(itemDir, "upstream"), "utf-8"), "bloco do add-on saas removido");
    await reject(current.replace(block[0], "<!-- maker:addon:saas:start -->\n<!-- maker:addon:saas:end -->"), "conteúdo do bloco do add-on saas alterado");
    await reject(current.replace(block[1]!, `${block[1]} `), "conteúdo do bloco do add-on saas alterado");
    await reject(`${current}\n<!-- maker:addon:evil:start -->\nregra\n<!-- maker:addon:evil:end -->\n`, "bloco do add-on evil não existia");

    const proposal = current.replace("Linha do dono.", "Linha do dono, revisada com o template novo.");
    await writeFile(join(itemDir, "resolved"), proposal);
    await reject(proposal, "descarta 1 linha(s) customizada(s)");
    await runUpdate({ target, applyResolutions: true, acceptDropped: true });
    expect(await readFile(join(target, constitution), "utf-8")).toBe(proposal);
    const entry = (await readManifest(target))!.files[constitution]!;
    expect(entry.source).toBe("addon:saas");
    expect(existsSync(dir)).toBe(false);
    expect((await exported(target)).items).toEqual([]);
  });

  it("não confia no índice nem nas cópias exportados", async () => {
    const target = await addonInstall();
    const { dir, item, current } = await addonConflict(target);
    const itemDir = join(dir, "items", item.id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const indexPath = join(dir, "mediation.json");
    const original = await readFile(indexPath, "utf-8");
    const tamper = async (edit: (index: { items: Item[] }) => void, message: string) => {
      const index = JSON.parse(original);
      edit(index);
      await writeFile(indexPath, JSON.stringify(index));
      await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
      expect(error.mock.calls.flat().join("\n")).toContain(message);
    };
    await writeFile(join(itemDir, "resolved"), current);
    // Upstream forjado (arquivo e hash coerentes entre si) não vira base.
    const forged = "UPSTREAM FORJADO\n";
    await writeFile(join(itemDir, "upstream"), forged);
    await tamper((index) => { index.items[0]!.upstreamHash = sha256(Buffer.from(forged)) as never; }, "não corresponde ao que o maker exportaria");
    // Item redirecionado para outro arquivo gerenciado ou para metadados.
    const claude = sha256(await readFile(join(target, "CLAUDE.md")));
    await tamper((index) => { Object.assign(index.items[0]!, { path: "CLAUDE.md", localHash: claude }); }, "não corresponde ao que o maker exportaria");
    await tamper((index) => { index.items[0]!.path = ".maker/manifest.json"; }, "fora dos arquivos gerenciados");
    expect(await readFile(join(target, constitution), "utf-8")).toBe(current);
    expect((await readManifest(target))!.files["CLAUDE.md"]!.baseHash).not.toBe(sha256(Buffer.from(forged)));
  });

  it("não descarta propostas em andamento ao reexportar e mantém ids estáveis", async () => {
    const target = await initialized();
    await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const first = await exported(target);
    await writeFile(join(first.dir, "items", first.items[0]!.id, "notes.md"), "rascunho\n");
    await expect(runUpdate({ target, export: true })).rejects.toThrow("propostas em andamento");
    expect(await readFile(join(first.dir, "items", first.items[0]!.id, "notes.md"), "utf-8")).toBe("rascunho\n");
    await rm(join(first.dir, "items", first.items[0]!.id, "notes.md"));
    const second = await exported(target);
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
  });

  it("template que muda no fim de um papel com bloco de add-on é aplicado sem mediação", async () => {
    const target = await addonInstall();
    const role = ".maker/workflow/agents/architect.md";
    const current = await readFile(join(target, role), "utf-8");
    const upstream = await upstreamOf(target, role);
    const block = current.match(/<!-- maker:addon:saas:start -->\n([\s\S]*?)\n<!-- maker:addon:saas:end -->/)![1]!;
    // Versão anterior do template sem a última linha; o bloco foi anexado no fim, como faz o maker add.
    const lines = upstream.trimEnd().split("\n");
    const previous = lines.slice(0, -1).join("\n") + "\n";
    const local = upsertBlock(previous, "saas", block);
    const baseHash = sha256(Buffer.from(previous));
    await putBase(target, previous);
    await writeFile(join(target, role), local);
    const manifest = (await readManifest(target))!;
    manifest.files[role] = { ...manifest.files[role]!, hash: sha256(Buffer.from(local)), baseHash };
    await writeManifest(target, manifest);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(log.mock.calls.flat().join("\n")).not.toContain("precisam de mediação");
    expect(await readFile(join(target, role), "utf-8")).toBe(upsertBlock(upstream, "saas", block));
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("aplica exportação feita com --no-merge no mesmo modo", async () => {
    const target = await initialized();
    const { local } = await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, export: true, merge: false });
    const dir = join(target, DEFAULT_MEDIATION_DIR);
    const items: Item[] = JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8")).items;
    const item = items.find((entry) => entry.path === "AGENTS.md")!;
    expect(item.category).toBe("local-edit");
    await writeFile(join(dir, "items", item.id, "resolved"), local);
    await runUpdate({ target, applyResolutions: true });
    expect(existsSync(dir)).toBe(false);
  });

  it("update com mediação pendente sai com exit code próprio", async () => {
    const target = await initialized();
    await appendFile(join(target, "AGENTS.md"), "\nRegra local sem base.\n");
    const manifest = (await readManifest(target))!;
    manifest.files["AGENTS.md"] = { hash: "0".repeat(64), source: manifest.files["AGENTS.md"]!.source };
    await writeManifest(target, manifest);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(process.exitCode).toBe(PENDING_EXIT_CODE);
    process.exitCode = 0;
    await runUpdate({ target });
    expect(process.exitCode).toBe(PENDING_EXIT_CODE);
    expect(log.mock.calls.flat().join("\n")).toContain("Update aplicado com pendências");
    expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toContain("Regra local sem base.");
  });

  it("doctor não declara íntegro quando não consegue planejar o update", async () => {
    const target = await initialized();
    const manifest = (await readManifest(target))!;
    (manifest.config!.layout as { frontendGlobs: unknown }).frontendGlobs = "não é lista";
    await writeManifest(target, manifest);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDoctor({ target });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("não foi possível planejar o update");
    expect(output).not.toContain("Install íntegro");
    expect(process.exitCode).toBe(1);
  });

  it("sentinela de config cobre todas as folhas de texto, exceto projeto e agente", () => {
    const config = parseConfig({ project: { name: "Nimbus" }, commands: { dev: "just dev" } });
    const sentinel = sentinelConfig(config);
    expect(sentinel.project).toEqual(config.project);
    expect(sentinel.agent).toBe(config.agent);
    const leaves = JSON.stringify({ layout: sentinel.layout, commands: sentinel.commands }).match(/"[^"]*"/g)!
      .filter((value) => !["\"layout\"", "\"commands\"", "\"frontendGlobs\"", "\"backendGlobs\"", "\"verify\"", "\"build\"", "\"test\"", "\"dev\""].includes(value));
    expect(leaves.every((value) => value.startsWith("\"maker-sentinel-"))).toBe(true);
  });

  it("só sugere caminhos disponíveis no aviso de mediação", () => {
    expect(mediationHint(2, { configKnown: false, skillInstalled: true, updateBlocked: false })).toContain("crie maker.config.json");
    expect(mediationHint(2, { configKnown: false, skillInstalled: true, updateBlocked: false })).not.toContain("--export");
    expect(mediationHint(2, { configKnown: true, skillInstalled: true, updateBlocked: false })).toContain("/maker-update");
    expect(mediationHint(2, { configKnown: true, skillInstalled: false, updateBlocked: true })).not.toContain("/maker-update");
    expect(mediationHint(2, { configKnown: true, skillInstalled: false, updateBlocked: false })).toContain("aplique este update para instalar");
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

  it("não apaga arquivos alheios colocados numa exportação ao reexportar", async () => {
    const target = await initialized();
    await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { dir } = await exported(target);
    await writeFile(join(dir, "anotacoes-do-dono.md"), "não apagar\n");
    await expect(runUpdate({ target, export: true })).rejects.toThrow("arquivos alheios");
    expect(await readFile(join(dir, "anotacoes-do-dono.md"), "utf-8")).toBe("não apagar\n");
  });

  it("não apaga arquivos alheios da exportação ao aplicar a última proposta", async () => {
    const target = await initialized();
    await conflicted(target);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { dir, items } = await exported(target);
    await writeFile(join(dir, "anotacoes-do-dono.md"), "não apagar\n");
    await writeFile(join(dir, "items", items[0]!.id, "resolved"), await readFile(join(dir, "items", items[0]!.id, "local")));
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("arquivos alheios");
    expect(await readFile(join(dir, "anotacoes-do-dono.md"), "utf-8")).toBe("não apagar\n");
  });
});
