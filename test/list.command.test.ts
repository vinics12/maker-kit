import { describe, expect, it } from "vitest";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAddonCatalog } from "../src/addons/loader.js";
import { loadAddon } from "../src/addons/loader.js";
import { applyAddon } from "../src/addons/apply.js";
import { runInit } from "../src/commands/init.js";
import { runList } from "../src/commands/list.js";
import { initInstall, readAddonStates, writeAddonState, writeAddonStateFile } from "./helpers/state.js";

const FIXTURE = join(__dirname, "..", "fixtures", "example.config.json");
const ANSI_ESCAPE = /\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g;

async function outputOf(action: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try {
    await action();
  } finally {
    console.log = originalLog;
  }
  return messages.join("\n").replace(ANSI_ESCAPE, "");
}

describe("maker list", () => {
  it("trata catálogo local vazio", async () => {
    const empty = await mkdtemp(join(tmpdir(), "maker-empty-catalog-"));
    expect(await listAddonCatalog(empty)).toEqual([]);
  });

  it("lista add-on disponível fora de um projeto inicializado", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-list-available-"));
    const output = await outputOf(() => runList({ target }));

    expect(output).toContain("saas · Base SaaS · v0.1.0 · available");
    expect(output).toContain("knobs: tenantColumn, brandVarPrefix, roles");
    expect(output).toContain("próximo: maker add saas");
  });

  it("classifica add-on aplicado com state compatível", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-list-applied-"));
    await runInit({ target, config: FIXTURE, yes: true });
    await applyAddon(target, await loadAddon("saas"), {
      tenantColumn: "org_id",
      brandVarPrefix: "--tema-",
      roles: "owner,staff",
    });

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · applied");
    expect(output).toContain("próximo: maker doctor");
  });

  it("continua a listagem quando o state é inválido (files)", async () => {
    const target = await initInstall("maker-list-degraded-", { format: "files" });
    await writeAddonStateFile(target, "saas", "{ json inválido\n");

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · degraded");
    expect(output).toContain("problema: state inválido");
    expect(output).toContain("próximo: maker doctor");
  });

  it("classifica versão incompatível como degradada", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-list-version-"));
    await runInit({ target, config: FIXTURE, yes: true });
    await applyAddon(target, await loadAddon("saas"), {
      tenantColumn: "org_id",
      brandVarPrefix: "--tema-",
      roles: "owner,staff",
    });
    const state = (await readAddonStates(target)).get("saas")!;
    await writeAddonState(target, { ...state, version: "9.9.9" });

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · degraded");
    expect(output).toContain("state v9.9.9 difere do catálogo v0.1.0");
  });

  it("continua a listagem quando o diretório de states tem tipo inválido (files)", async () => {
    const target = await initInstall("maker-list-state-dir-", { format: "files" });
    await writeFile(join(target, ".maker", "addons"), "não é diretório\n", "utf-8");

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · degraded");
    expect(output).toContain("problema: .maker/addons deveria ser um diretório");
    expect(output).toContain("próximo: maker doctor");
  });

  it("classifica symlink quebrado no diretório de states como degradado (files)", async () => {
    const target = await initInstall("maker-list-state-link-", { format: "files" });
    await symlink(join(target, "diretório-ausente"), join(target, ".maker", "addons"));

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · degraded");
    expect(output).toContain("problema: .maker/addons deveria ser um diretório");
  });
});
