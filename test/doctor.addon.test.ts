import { describe, expect, it } from "vitest";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BasesFormat } from "../src/render/manifest.js";
import { runDoctor } from "../src/commands/doctor.js";
import { initInstall } from "./helpers/state.js";

const REF = ".specify/memory/saas-reference.md";
const CONST = ".specify/memory/constitution.md";

async function outputOf(action: () => Promise<void>): Promise<string> {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  try { await action(); } finally { console.log = originalLog; }
  return messages.join("\n").replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "");
}

async function installedAddon(format: BasesFormat) {
  return initInstall("maker-doctor-addon-", { format, addon: "saas" });
}

describe.each<BasesFormat>(["files", "pack"])("maker doctor: add-ons (formato %s)", (format) => {
  it("lista um add-on íntegro", async () => {
    const target = await installedAddon(format);
    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("Add-ons aplicados:");
    expect(output).toContain("saas · Base SaaS · v0.1.0 · íntegro");
    expect(process.exitCode).not.toBe(1);
  });

  it("reporta arquivo ausente e retorna exit code degradado", async () => {
    const target = await installedAddon(format);
    await unlink(join(target, REF));
    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("arquivo criado ausente: .specify/memory/saas-reference.md");
    expect(output).toContain("ação:");
    process.exitCode = 0;
  });

  it("reporta state inválido, versão divergente e marcador incompleto", async () => {
    const target = await installedAddon(format);
    const statePath = join(target, ".maker/addons/saas.json");
    const state = JSON.parse(await readFile(statePath, "utf-8"));
    await writeFile(statePath, JSON.stringify({ ...state, version: "9.9.9" }), "utf-8");
    const constitution = await readFile(join(target, CONST), "utf-8");
    await writeFile(join(target, CONST), constitution.replace("<!-- maker:addon:saas:end -->", ""), "utf-8");
    const output = await outputOf(() => runDoctor({ target }));
    expect(output).toContain("state v9.9.9 difere do catálogo v0.1.0");
    expect(output).toContain("marcadores do add-on incompletos");
    process.exitCode = 0;
  });

  it("mantém instalação sem add-ons íntegra", async () => {
    const target = await initInstall("maker-doctor-no-addon-", { format });
    const output = await outputOf(() => runDoctor({ target }));
    expect(output).not.toContain("Add-ons aplicados:");
    expect(output).toContain("✓ Install íntegro.");
  });
});
