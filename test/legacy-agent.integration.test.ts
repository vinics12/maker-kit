import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runUpdate } from "../src/commands/update.js";
import { runDoctor } from "../src/commands/doctor.js";
import { runAgentAdd, runAgentList } from "../src/commands/agent.js";
import { validateAgentIntegration } from "../src/agents/validate.js";
import { planLegacyAddonAgents } from "../src/agents/migrate.js";
import { buildContext, render } from "../src/render/engine.js";
import { readManifest, sha256, writeManifest, verifyManifest } from "../src/render/manifest.js";
import { applyEngine } from "../src/util/engine-scaffold.js";
import { applyAddon, removeAddon } from "../src/addons/apply.js";
import { loadAddon } from "../src/addons/loader.js";
import { upsertBlock } from "../src/addons/inject.js";
import { readAddonState, writeAddonState } from "../src/addons/state.js";
import { applyChangePlan } from "../src/changes/transaction.js";
import { createPlan } from "../src/changes/plan.js";

const config = join(__dirname, "../fixtures/example.config.json");
const roles = ["architect", "code-reviewer"];
const constitution = ".specify/memory/constitution.md";
const statePath = ".maker/addons/saas.json";
const directories: string[] = [];
async function temporary() {
  const target = await mkdtemp(join(tmpdir(), "maker-legacy-"));
  directories.push(target);
  return target;
}
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function legacy(version: "0.2.0" | "0.4.0") {
  const target = await temporary();
  await runInit({ target, config, yes: true });
  await applyAddon(target, await loadAddon("saas"), { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" });
  const manifest = (await readManifest(target))!;
  const state = (await readAddonState(target, "saas"))!;
  const staging = await temporary();
  await applyEngine(staging, buildContext(manifest.config!), ["claude"]);
  for (const role of roles) {
    const adapterPath = `.claude/agents/${role}.md`;
    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const template = await readFile(join(__dirname, `../fixtures/legacy-0.2.0/${role}.md.hbs`), "utf-8");
    const agent = upsertBlock(render(template, buildContext(manifest.config!)).replace("model: opus", "model: modelo-local"), "saas", `regra SaaS autoral ${role}`);
    await writeFile(join(target, adapterPath), agent);
    manifest.files[adapterPath] = { source: "addon:saas", hash: sha256(agent) };
    await appendFile(join(target, adapterPath), "\nCustomização fora do bloco.\n");
    const stock = await readFile(join(staging, sharedPath));
    await writeFile(join(target, sharedPath), stock);
    manifest.files[sharedPath] = { source: "engine:common", hash: sha256(stock), baseHash: sha256(stock) };
    state.injectedTargets = state.injectedTargets.map((path) => path === sharedPath ? adapterPath : path);
  }
  if (version === "0.2.0") {
    for (const path of Object.keys(manifest.files)) {
      if (path.startsWith(".maker/workflow/agents/")) delete manifest.files[path];
    }
    await rm(join(target, ".maker/workflow"), { recursive: true });
    delete manifest.agents;
    delete manifest.schemaVersion;
  }
  manifest.makerVersion = version;
  await writeManifest(target, manifest);
  await writeAddonState(target, state);
  await writeFile(join(target, statePath), JSON.stringify({ ...state, customMetadata: { preserve: true },
    createdFiles: state.createdFiles.map((file) => ({ ...file, customNote: "preservar" })),
  }));
  return target;
}

async function snapshot(root: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) Object.assign(result, await snapshot(root, path));
    else result[path] = sha256(await readFile(join(root, path)));
  }
  return result;
}

describe("migração de agentes legados", () => {
  it.each(["0.2.0", "0.4.0"] as const)("migra instalação %s preservando conteúdo, remove e repete update", async (version) => {
    const target = await legacy(version);
    const beforeConstitution = await readFile(join(target, constitution));
    const beforeState = JSON.parse(await readFile(join(target, statePath), "utf-8"));
    const bodies = new Map<string, string>();
    for (const role of roles) {
      const content = await readFile(join(target, `.claude/agents/${role}.md`), "utf-8");
      bodies.set(role, content.replace(/^---\n[\s\S]*?\n---\n/, ""));
    }
    await runUpdate({ target });
    await runUpdate({ target });
    expect(await readFile(join(target, constitution))).toEqual(beforeConstitution);
    const afterState = JSON.parse(await readFile(join(target, statePath), "utf-8"));
    expect({ ...afterState, injectedTargets: [] }).toEqual({ ...beforeState, injectedTargets: [] });
    for (const role of roles) {
      expect(await readFile(join(target, `.claude/agents/${role}.md`), "utf-8")).toContain("model: modelo-local");
      expect(await readFile(join(target, `.maker/workflow/agents/${role}.md`), "utf-8")).toBe(bodies.get(role));
      expect(afterState.injectedTargets).toContain(`.maker/workflow/agents/${role}.md`);
      expect(afterState.injectedTargets).not.toContain(`.claude/agents/${role}.md`);
    }
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
    expect((await verifyManifest(target, (await readManifest(target))!)).ok).toBe(true);
    await runAgentAdd("codex", { target });
    expect((await validateAgentIntegration(target, "codex")).issues).toEqual([]);
    await runDoctor({ target });
    expect(process.exitCode).not.toBe(1);
    await removeAddon(target, "saas");
    for (const role of roles) {
      const body = await readFile(join(target, `.maker/workflow/agents/${role}.md`), "utf-8");
      expect(body).not.toContain("regra SaaS autoral");
      expect(body).toContain("Customização fora do bloco.");
    }
    await runDoctor({ target });
    expect(process.exitCode).not.toBe(1);
  });

  it("migra quando o papel compartilhado intacto é de um template anterior", async () => {
    const target = await legacy("0.4.0");
    const shared = ".maker/workflow/agents/architect.md";
    const previous = (await readFile(join(target, shared), "utf-8")) + "\nLinha de um template anterior.\n";
    await writeFile(join(target, shared), previous);
    const manifest = (await readManifest(target))!;
    manifest.files[shared] = { ...manifest.files[shared]!, hash: sha256(previous), baseHash: sha256(previous) };
    await writeManifest(target, manifest);
    const body = (await readFile(join(target, ".claude/agents/architect.md"), "utf-8")).replace(/^---\n[\s\S]*?\n---\n/, "");
    await runUpdate({ target });
    expect(await readFile(join(target, shared), "utf-8")).toBe(body);
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
  });

  it("migra agente legado que apenas menciona o caminho do papel no corpo", async () => {
    const target = await legacy("0.4.0");
    const adapter = ".claude/agents/architect.md";
    await appendFile(join(target, adapter), "Consulte também .maker/workflow/agents/architect.md.\n");
    await runUpdate({ target });
    expect(await readFile(join(target, adapter), "utf-8")).toContain("Read `.maker/workflow/agents/architect.md` completely");
    expect(await readFile(join(target, ".maker/workflow/agents/architect.md"), "utf-8")).toContain("Consulte também");
  });

  it("reporta manifest ilegível sem interromper a validação", async () => {
    const target = await legacy("0.4.0");
    await writeFile(join(target, ".maker/manifest.json"), "{broken");
    const issues = (await validateAgentIntegration(target, "claude")).issues.join("\n");
    expect(issues).toContain(".maker/manifest.json ilegível");
    expect(issues).toContain("referência ao papel compartilhado ausente");
  });

  it("dry-run descreve migração sem alterar arquivos ou timestamps", async () => {
    const target = await legacy("0.4.0");
    const before = await snapshot(target);
    const metadata = await stat(join(target, statePath));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(log.mock.calls.flat().join("\n")).toContain("migrar conteúdo preservado");
    expect(await snapshot(target)).toEqual(before);
    expect((await stat(join(target, statePath))).mtimeMs).toBe(metadata.mtimeMs);
  });

  it("preserva papel compartilhado personalizado e avisa antes da aplicação", async () => {
    const target = await legacy("0.4.0");
    const shared = ".maker/workflow/agents/architect.md";
    const adapter = ".claude/agents/architect.md";
    await appendFile(join(target, shared), "regra nova no papel compartilhado\n");
    const body = await readFile(join(target, shared));
    const adapterBefore = await readFile(join(target, adapter));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("integração continuará degradada");
    expect(output).toContain("já possui conteúdo local");
    expect(await readFile(join(target, shared))).toEqual(body);
    expect(await readFile(join(target, adapter))).toEqual(adapterBefore);
    expect((await readAddonState(target, "saas"))!.injectedTargets).toContain(adapter);
  });

  it.each(["state", "markers"])("preserva agentes quando %s é inválido", async (invalid) => {
    const target = await legacy("0.4.0");
    const adapter = ".claude/agents/architect.md";
    if (invalid === "state") await writeFile(join(target, statePath), "{broken");
    else await appendFile(join(target, adapter), "<!-- maker:addon:saas:start -->");
    const before = await readFile(join(target, adapter));
    await runUpdate({ target });
    expect(await readFile(join(target, adapter))).toEqual(before);
    expect((await validateAgentIntegration(target, "claude")).issues.join("\n")).toContain("referência ao papel compartilhado ausente");
  });

  it("mantém divergence da constitution e distingue referência, papel e adapter ausentes", async () => {
    const target = await legacy("0.4.0");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAgentList({ target });
    expect(log.mock.calls.flat().join("\n")).toContain("origem addon:saas");
    await appendFile(join(target, constitution), "\nPrincípio autoral\n");
    const before = await readFile(join(target, constitution));
    await runUpdate({ target });
    await runDoctor({ target });
    expect(process.exitCode).toBe(1);
    expect(await readFile(join(target, constitution))).toEqual(before);
    await rm(join(target, ".maker/workflow/agents/architect.md"));
    await rm(join(target, ".claude/agents/code-reviewer.md"));
    const issues = (await validateAgentIntegration(target, "claude")).issues.join("\n");
    expect(issues).toContain("arquivo do papel compartilhado ausente: .maker/workflow/agents/architect.md");
    expect(issues).toContain(".claude/agents/code-reviewer.md: arquivo de adapter ausente");
  });

  it("faz rollback do corpo, adapter e state em falha transacional", async () => {
    const target = await legacy("0.4.0");
    const manifest = (await readManifest(target))!;
    const staging = await temporary();
    const expected = await applyEngine(staging, buildContext(manifest.config!), ["claude"]);
    const migration = await planLegacyAddonAgents(target, staging, expected, manifest);
    const before = await snapshot(target);
    const plan = createPlan(target, migration.changes);
    const actions = plan.changes.filter((change) => ["create", "update", "remove"].includes(change.action));
    await expect(applyChangePlan(plan, { failAfter: actions.length - 1 })).rejects.toThrow("Falha injetada");
    expect(await snapshot(target)).toEqual(before);
  });

  it("avisa ao preservar agente legado editado sem origem add-on", async () => {
    const target = await legacy("0.4.0");
    const path = ".claude/agents/e2e-runner.md";
    const content = await readFile(join(target, path), "utf-8");
    const legacyContent = content.replace(/Read [\s\S]*$/, "Instruções locais de e2e.\n");
    await writeFile(join(target, path), legacyContent);
    const manifest = (await readManifest(target))!;
    delete manifest.files[path]!.baseHash;
    await writeManifest(target, manifest);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("e2e-runner.md: preservado");
    expect(output).toContain("referência ausente a .maker/workflow/agents/e2e-runner.md");
    expect(await readFile(join(target, path), "utf-8")).toBe(legacyContent);
  });

  it("rejeita mudança concorrente do state antes de migrar os agentes", async () => {
    const target = await legacy("0.4.0");
    const manifest = (await readManifest(target))!;
    const staging = await temporary();
    const expected = await applyEngine(staging, buildContext(manifest.config!), ["claude"]);
    const migration = await planLegacyAddonAgents(target, staging, expected, manifest);
    await appendFile(join(target, statePath), "\n");
    const before = await snapshot(target);
    await expect(applyChangePlan(createPlan(target, migration.changes))).rejects.toThrow("mudou depois do planejamento");
    expect(await snapshot(target)).toEqual(before);
  });
});
