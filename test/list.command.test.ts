import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAddonCatalog } from "../src/addons/loader.js";
import { loadAddon } from "../src/addons/loader.js";
import { applyAddon } from "../src/addons/apply.js";
import { addonStatePath, readAddonState } from "../src/addons/state.js";
import { runInit } from "../src/commands/init.js";
import { runList } from "../src/commands/list.js";

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

  it("continua a listagem quando o state é inválido", async () => {
    const target = await mkdtemp(join(tmpdir(), "maker-list-degraded-"));
    await runInit({ target, config: FIXTURE, yes: true });
    await mkdir(join(target, ".maker", "addons"), { recursive: true });
    await writeFile(addonStatePath(target, "saas"), "{ json inválido\n", "utf-8");

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
    const state = (await readAddonState(target, "saas"))!;
    await writeFile(
      addonStatePath(target, "saas"),
      JSON.stringify({ ...state, version: "9.9.9" }),
      "utf-8",
    );

    const output = await outputOf(() => runList({ target }));
    expect(output).toContain("saas · Base SaaS · v0.1.0 · degraded");
    expect(output).toContain("state v9.9.9 difere do catálogo v0.1.0");
  });
});
