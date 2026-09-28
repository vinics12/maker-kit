import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runUpdate } from "../src/commands/update.js";
import { DEFAULT_MEDIATION_DIR } from "../src/commands/mediation.js";
import { runDoctor } from "../src/commands/doctor.js";
import { runAgentAdd, runAgentList } from "../src/commands/agent.js";
import { validateAgentIntegration } from "../src/agents/validate.js";
import { parseConfig } from "../src/config/schema.js";
import { sharedRoleReference } from "../src/agents/reference.js";
import { planLegacyAddonAgents } from "../src/agents/migrate.js";
import { buildContext, render } from "../src/render/engine.js";
import { sha256, verifyManifest } from "../src/render/manifest.js";
import { readManifest, writeManifest } from "./helpers/state.js";
import { applyEngine, sharedAgentText } from "../src/util/engine-scaffold.js";
import { applyAddon, removeAddon } from "../src/addons/apply.js";
import { loadAddon } from "../src/addons/loader.js";
import { upsertBlock } from "../src/addons/inject.js";
import { readAddonState, writeAddonState } from "../src/addons/state.js";
import { applyChangePlan } from "../src/changes/transaction.js";
import { createPlan } from "../src/changes/plan.js";

const config = join(__dirname, "../fixtures/example.config.json");
const project020 = join(__dirname, "../fixtures/legacy-0.2.0/project");
const knobs = { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" };
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

async function legacy(version: "0.2.0" | "0.4.0", customized = true) {
  const target = await temporary();
  await runInit({ target, config, yes: true });
  await applyAddon(target, await loadAddon("saas"), knobs);
  const manifest = (await readManifest(target))!;
  const state = (await readAddonState(target, "saas"))!;
  const staging = await temporary();
  await applyEngine(staging, buildContext(manifest.config!), ["claude"]);
  for (const role of roles) {
    const adapterPath = `.claude/agents/${role}.md`;
    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const template = await readFile(join(__dirname, `../templates/legacy/0.2.0/agents/${role}.md.hbs`), "utf-8");
    const agent = upsertBlock(render(template, buildContext(manifest.config!)).replace("model: opus", "model: modelo-local"), "saas", `regra SaaS autoral ${role}`);
    await writeFile(join(target, adapterPath), agent);
    manifest.files[adapterPath] = { source: "addon:saas", hash: sha256(agent) };
    if (customized) await appendFile(join(target, adapterPath), "\nCustomização fora do bloco.\n");
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

/** Instalação real da 0.2.0 (snapshot em fixtures/legacy-0.2.0/project). */
async function project(withConfig = true) {
  const target = await temporary();
  await cp(project020, target, { recursive: true });
  if (!withConfig) await rm(join(target, "maker.config.json"));
  return target;
}

/** Instalação nova da versão atual com o mesmo add-on, para comparação byte a byte. */
async function fresh() {
  const target = await temporary();
  await runInit({ target, config, yes: true });
  await applyAddon(target, await loadAddon("saas"), knobs);
  return target;
}

function output(log: { mock: { calls: unknown[][] } }): string {
  return log.mock.calls.flat().join("\n");
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
      expect(await readFile(join(target, `.maker/workflow/agents/${role}.md`), "utf-8")).toBe(sharedAgentText(bodies.get(role)!));
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
    expect(await readFile(join(target, shared), "utf-8")).toBe(sharedAgentText(body));
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

  it("reporta estado ilegível sem interromper a validação", async () => {
    const target = await legacy("0.4.0");
    await writeFile(join(target, ".maker/maker.lock"), "{broken");
    const issues = (await validateAgentIntegration(target, "claude")).issues.join("\n");
    expect(issues).toContain("estado do maker ilegível");
    expect(issues).toContain("referência ao papel compartilhado ausente");
  });

  it("dry-run descreve migração sem alterar arquivos ou timestamps", async () => {
    const target = await legacy("0.4.0");
    const before = await snapshot(target);
    const metadata = await stat(join(target, statePath));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    expect(output(log)).toContain("migrar   .claude/agents/architect.md → .maker/workflow/agents/architect.md");
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
    expect(output).toContain("degradado .claude/agents/architect.md: papel compartilhado");
    expect(output).toContain("já possui conteúdo local");
    expect(output).toContain("1 agente(s) migrado(s), 1 permanece(m) degradado(s).");
    expect(await readFile(join(target, shared))).toEqual(body);
    expect(await readFile(join(target, adapter))).toEqual(adapterBefore);
    expect((await readAddonState(target, "saas"))!.injectedTargets).toContain(adapter);
    // O merge do update grava o hash do papel customizado; o update seguinte não pode tratá-lo como intacto.
    await runUpdate({ target });
    expect(await readFile(join(target, shared))).toEqual(body);
    expect(await readFile(join(target, adapter))).toEqual(adapterBefore);
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
    // Customização com base registrada: o doctor a mostra como personalizada, sem degradar o install.
    await runDoctor({ target });
    expect(log.mock.calls.flat().join("\n")).not.toContain(`modificado: ${constitution}`);
    expect(process.exitCode).not.toBe(1);
    expect(await readFile(join(target, constitution))).toEqual(before);
    await appendFile(join(target, constitution), "\nOutro princípio autoral\n");
    await runDoctor({ target });
    expect(log.mock.calls.flat().join("\n")).toContain(`personalizado: ${constitution}`);
    expect(process.exitCode).not.toBe(1);
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
    const migration = await planLegacyAddonAgents(target, staging, expected, manifest, { ctx: buildContext(manifest.config!) });
    const before = await snapshot(target);
    const plan = createPlan(target, migration.changes);
    const actions = plan.changes.filter((change) => ["create", "update", "remove"].includes(change.action));
    await expect(applyChangePlan(plan, { failAfter: actions.length - 1 })).rejects.toThrow("Falha injetada");
    expect(await snapshot(target)).toEqual(before);
  });

  it("migra agente legado do engine editado sem origem add-on para o papel compartilhado", async () => {
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
    expect(output).toContain("migrado   .claude/agents/e2e-runner.md → .maker/workflow/agents/e2e-runner.md");
    expect(output).not.toContain("precisam de mediação");
    expect(sharedRoleReference(await readFile(join(target, path), "utf-8"))).toBe(".maker/workflow/agents/e2e-runner.md");
    expect(await readFile(join(target, ".maker/workflow/agents/e2e-runner.md"), "utf-8")).toContain("Instruções locais de e2e.");
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
  });

  it("rejeita mudança concorrente do state antes de migrar os agentes", async () => {
    const target = await legacy("0.4.0");
    const manifest = (await readManifest(target))!;
    const staging = await temporary();
    const expected = await applyEngine(staging, buildContext(manifest.config!), ["claude"]);
    const migration = await planLegacyAddonAgents(target, staging, expected, manifest, { ctx: buildContext(manifest.config!) });
    await appendFile(join(target, statePath), "\n");
    const before = await snapshot(target);
    await expect(applyChangePlan(createPlan(target, migration.changes))).rejects.toThrow("mudou depois do planejamento");
    expect(await snapshot(target)).toEqual(before);
  });
});

describe("migração de agentes legados: template, remove e reaplicação", () => {
  it.each(["0.2.0", "0.4.0"] as const)("papel sem customização (%s) fica igual ao de uma instalação nova com o add-on", async (version) => {
    const target = await legacy(version, false);
    const reference = await fresh();
    await runUpdate({ target });
    for (const role of roles) {
      const path = `.maker/workflow/agents/${role}.md`;
      // O helper injeta um bloco sintético; fora dele o papel tem que ser idêntico ao da instalação nova.
      const expected = upsertBlock(await readFile(join(reference, path), "utf-8"), "saas", `regra SaaS autoral ${role}`);
      expect(await readFile(join(target, path), "utf-8")).toBe(expected);
      expect(await readFile(join(target, `.claude/agents/${role}.md`), "utf-8"))
        .toBe((await readFile(join(reference, `.claude/agents/${role}.md`), "utf-8")).replace("model: opus", "model: modelo-local"));
    }
  });

  it("aplica o template atual quando ele difere do legado e só congela o corpo personalizado, com aviso", async () => {
    const target = await legacy("0.4.0", false);
    await appendFile(join(target, ".claude/agents/code-reviewer.md"), "Regra local do revisor.\n");
    const manifest = (await readManifest(target))!;
    const staging = await temporary();
    const expected = await applyEngine(staging, buildContext(manifest.config!), ["claude"]);
    for (const role of roles) await appendFile(join(staging, `.maker/workflow/agents/${role}.md`), "\nNovidade do template.\n");
    const migration = await planLegacyAddonAgents(target, staging, expected, manifest, { ctx: buildContext(manifest.config!) });
    await applyChangePlan(createPlan(target, migration.changes));
    const architect = await readFile(join(target, ".maker/workflow/agents/architect.md"), "utf-8");
    expect(architect).toContain("Novidade do template.");
    expect(architect).toContain("<!-- maker:addon:saas:start -->");
    const reviewer = await readFile(join(target, ".maker/workflow/agents/code-reviewer.md"), "utf-8");
    expect(reviewer).not.toContain("Novidade do template.");
    expect(reviewer).toContain("Regra local do revisor.");
    const byPath = new Map(migration.reports.map((report) => [report.path, report]));
    expect(byPath.get(".claude/agents/architect.md")!.reason).toContain("template atual");
    expect(byPath.get(".claude/agents/code-reviewer.md")!.reason).toContain("copiado como está; updates do template chegam por merge");
  });

  it("maker remove seguido de update preserva customizações migradas e da constitution", async () => {
    const target = await legacy("0.4.0");
    await appendFile(join(target, constitution), "\nPrincípio autoral\n");
    await runUpdate({ target });
    await removeAddon(target, "saas");
    const manifest = (await readManifest(target))!;
    expect(manifest.files[".maker/workflow/agents/architect.md"]).toMatchObject({ source: "engine:common", baseHash: expect.any(String) });
    await runUpdate({ target });
    for (const role of roles) {
      const body = await readFile(join(target, `.maker/workflow/agents/${role}.md`), "utf-8");
      expect(body).toContain("Customização fora do bloco.");
      expect(body).not.toContain("<!-- maker:addon:saas:start -->");
    }
    expect(await readFile(join(target, constitution), "utf-8")).toContain("Princípio autoral");
    await runUpdate({ target });
    expect(await readFile(join(target, ".maker/workflow/agents/architect.md"), "utf-8")).toContain("Customização fora do bloco.");
  });

  it("repara adapter de add-on reaplicado depois de um update sem migração", async () => {
    const target = await project();
    await runUpdate({ target, merge: false });
    expect((await validateAgentIntegration(target, "claude")).issues.join("\n")).toContain("referência ao papel compartilhado ausente");
    await applyAddon(target, await loadAddon("saas"), knobs);
    const state = await readFile(join(target, statePath));
    const shared = await snapshot(join(target, ".maker/workflow/agents"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(output(log)).toContain("(só o adapter)");
    expect(output(log)).toContain("2 agente(s) migrado(s), 0 permanece(m) degradado(s).");
    expect(await readFile(join(target, statePath))).toEqual(state);
    expect(await snapshot(join(target, ".maker/workflow/agents"))).toEqual(shared);
    const manifest = (await readManifest(target))!;
    for (const role of roles) {
      expect(manifest.files[`.claude/agents/${role}.md`]!.source).toBe("engine:claude");
      expect(await readFile(join(target, `.claude/agents/${role}.md`), "utf-8")).toContain(`Read \`.maker/workflow/agents/${role}.md\``);
    }
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
  });

  it("preserva e orienta quando o agente de add-on reaplicado tem customização", async () => {
    const target = await project();
    await runUpdate({ target, merge: false });
    await applyAddon(target, await loadAddon("saas"), knobs);
    const adapter = ".claude/agents/architect.md";
    await appendFile(join(target, adapter), "\nRegra local legada.\n");
    const before = await readFile(join(target, adapter));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(output(log)).toContain("degradado .claude/agents/architect.md: o corpo legado tem customizações ausentes de .maker/workflow/agents/architect.md");
    expect(output(log)).toContain("mova as customizações de .claude/agents/architect.md para .maker/workflow/agents/architect.md");
    expect(await readFile(join(target, adapter))).toEqual(before);
    const legacyBody = before.toString("utf-8").replace("\nRegra local legada.\n", "");
    await writeFile(join(target, adapter), legacyBody);
    await runUpdate({ target });
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
  });

  it("preserva agente cujo frontmatter restringe tools sem Read", async () => {
    const target = await legacy("0.4.0");
    const adapter = ".claude/agents/architect.md";
    const restricted = (await readFile(join(target, adapter), "utf-8")).replace(/^tools: .*$/m, 'tools: ["Write", "Bash"]');
    await writeFile(join(target, adapter), restricted);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(output(log)).toContain("restringe tools sem Read");
    expect(output(log)).toContain("inclua Read em tools: de .claude/agents/architect.md");
    expect(await readFile(join(target, adapter), "utf-8")).toBe(restricted);
    expect(await readFile(join(target, ".claude/agents/code-reviewer.md"), "utf-8")).toContain("Read `.maker/workflow/agents/code-reviewer.md`");
  });

  it("--no-merge apenas lista a migração pendente", async () => {
    const target = await legacy("0.4.0");
    const agents = await snapshot(join(target, ".claude/agents"));
    const state = await readFile(join(target, statePath));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, merge: false });
    expect(output(log)).toContain("pendente .claude/agents/architect.md → .maker/workflow/agents/architect.md");
    expect(output(log)).toContain("execute maker update sem --no-merge");
    expect(await snapshot(join(target, ".claude/agents"))).toEqual(agents);
    expect(await readFile(join(target, statePath))).toEqual(state);
  });

  it("não anuncia migração quando o plano tem conflito", async () => {
    const target = await legacy("0.4.0");
    await rm(join(target, "CLAUDE.md"));
    await mkdir(join(target, "CLAUDE.md"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(runUpdate({ target })).rejects.toThrow("nenhuma alteração foi feita");
    expect(output(log)).not.toContain(".claude/agents/architect.md");
    expect(await readFile(join(target, ".claude/agents/architect.md"), "utf-8")).not.toContain("Read `.maker");
  });

  it("doctor reporta uma única vez o adapter ausente", async () => {
    const target = await legacy("0.4.0");
    await runUpdate({ target });
    await rm(join(target, ".claude/agents/dev.md"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDoctor({ target });
    expect(output(log).match(/\.claude\/agents\/dev\.md/g)).toHaveLength(1);
    expect(output(log)).toContain("1 ausente(s)");
  });
});

describe("instalação real 0.2.0", () => {
  it("migra os agentes do snapshot 0.2.0 como uma instalação nova", async () => {
    const target = await project();
    const reference = await fresh();
    await runUpdate({ target });
    for (const role of roles) {
      for (const path of [`.maker/workflow/agents/${role}.md`, `.claude/agents/${role}.md`]) {
        expect(await readFile(join(target, path), "utf-8")).toBe(await readFile(join(reference, path), "utf-8"));
      }
    }
    expect(await readFile(join(target, ".claude/skills/run-spec/SKILL.md"), "utf-8")).toContain("just dev");
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
    const state = (await readAddonState(target, "saas"))!;
    expect(state.injectedTargets).toEqual([constitution, ".maker/workflow/agents/code-reviewer.md", ".maker/workflow/agents/architect.md"]);
  });

  it("maker remove não expõe a constitution 0.2.0 sem base à sobrescrita do update", async () => {
    const target = await project();
    await appendFile(join(target, constitution), "\nPrincípio autoral\n");
    await runUpdate({ target });
    await removeAddon(target, "saas");
    await runUpdate({ target });
    const content = await readFile(join(target, constitution), "utf-8");
    expect(content).toContain("Princípio autoral");
    expect(content).not.toContain("<!-- maker:addon:saas:start -->");
  });

  it("sem config recuperável preserva arquivos dependentes dela e avisa", async () => {
    const target = await project(false);
    const skill = ".claude/skills/run-spec/SKILL.md";
    const before = await readFile(join(target, skill));
    expect(before.toString("utf-8")).toContain("just dev");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(await readFile(join(target, skill))).toEqual(before);
    expect(output(log)).toContain("Config do projeto não recuperada");
    expect(output(log)).toContain(`preservado(s): .claude/agents/dev.md, ${skill}`);
    expect(await readFile(join(target, ".claude/agents/dev.md"), "utf-8")).toContain("just verify");
    expect(output(log)).toContain("crie maker.config.json");
    // O revisor legado depende de comandos desconhecidos: não migra com a config padrão (nem ganha base
    // renderizada com ela); fica pendente até a config existir.
    const reviewer = ".claude/agents/code-reviewer.md";
    expect(await readFile(join(target, reviewer), "utf-8")).toContain("just verify");
    expect(await readFile(join(target, reviewer), "utf-8")).toContain("maker:addon:saas:start");
    expect(output(log)).toContain(`degradado ${reviewer}: depende de config não recuperada`);
    await cp(join(project020, "maker.config.json"), join(target, "maker.config.json"));
    await runUpdate({ target });
    const role = await readFile(join(target, ".maker/workflow/agents/code-reviewer.md"), "utf-8");
    expect(role).toContain("just verify");
    expect(role).toContain("maker:addon:saas:start");
    expect(role).not.toContain("npm run verify");
    expect(await readFile(join(target, skill), "utf-8")).toBe(await readFile(join(await fresh(), skill), "utf-8"));
    expect((await readManifest(target))!.files[skill]).toMatchObject({ hash: sha256(before), baseHash: sha256(before) });
    expect(await readFile(join(target, ".maker/workflow/agents/dev.md"), "utf-8")).toContain("just verify");
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
  });

  it("maker remove em instalação 0.2.0 sem customização deixa o install íntegro e sem mediação", async () => {
    const target = await project();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await removeAddon(target, "saas");
    const manifest = (await readManifest(target))!;
    for (const path of [constitution, ".claude/agents/architect.md", ".claude/agents/code-reviewer.md"]) {
      expect(manifest.files[path]!.edited).toBeUndefined();
    }
    // Antes do update a integração 0.2.0 ainda é legada; o que não pode aparecer é edição fantasma.
    await runDoctor({ target });
    expect(output(log)).not.toContain("modificado:");
    await runUpdate({ target });
    expect(output(log)).not.toContain("precisam de mediação");
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
    process.exitCode = 0;
    await runDoctor({ target });
    expect(process.exitCode).not.toBe(1);
    const reference = await temporary();
    await runInit({ target: reference, config, yes: true });
    for (const role of roles) {
      expect(await readFile(join(target, `.claude/agents/${role}.md`), "utf-8"))
        .toBe(await readFile(join(reference, `.claude/agents/${role}.md`), "utf-8"));
    }
  });

  it("maker remove em instalação 0.2.0 customizada marca a edição sem hash falso e migra a customização", async () => {
    const target = await project();
    const agent = ".claude/agents/architect.md";
    await appendFile(join(target, agent), "Regra local do arquiteto.\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await removeAddon(target, "saas");
    const entry = (await readManifest(target))!.files[agent]!;
    expect(entry).toMatchObject({ edited: true, hash: sha256(await readFile(join(target, agent))) });
    await runDoctor({ target });
    expect(output(log)).not.toContain(`modificado: ${agent}`);
    await runUpdate({ target });
    // O corpo customizado vai para o papel compartilhado (template 0.2.0 como base) e o agente vira adapter.
    expect(await readFile(join(target, ".maker/workflow/agents/architect.md"), "utf-8")).toContain("Regra local do arquiteto.");
    expect(sharedRoleReference(await readFile(join(target, agent), "utf-8"))).toBe(".maker/workflow/agents/architect.md");
    expect(output(log)).not.toContain("precisam de mediação");
  });

  it("cenário da issue #37: e2e-runner legado e constitution personalizados se reconciliam sem mediação", async () => {
    const target = await project();
    const e2e = ".claude/agents/e2e-runner.md";
    const manifest = (await readManifest(target))!;
    const ctx = buildContext(parseConfig(JSON.parse(await readFile(join(target, "maker.config.json"), "utf-8"))), manifest.installedAt);
    const legacyE2e = render(await readFile(join(__dirname, "../templates/legacy/0.2.0/agents/e2e-runner.md.hbs"), "utf-8"), ctx);
    await writeFile(join(target, e2e), `${legacyE2e}\nRegra local do e2e.\n`);
    manifest.files[e2e] = { hash: sha256(legacyE2e), source: "engine" };
    await writeManifest(target, manifest);
    await appendFile(join(target, constitution), "\nPrincípio autoral do projeto.\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(output(log)).not.toContain("precisam de mediação");
    expect(process.exitCode ?? 0).toBe(0);
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
    expect(await readFile(join(target, ".maker/workflow/agents/e2e-runner.md"), "utf-8")).toContain("Regra local do e2e.");
    const updatedConstitution = await readFile(join(target, constitution), "utf-8");
    expect(updatedConstitution).toContain("Princípio autoral do projeto.");
    expect(updatedConstitution).toContain("maker:addon:saas:start");
    expect((await readManifest(target))!.files[constitution]!.baseHash).toBeDefined();
    log.mockClear();
    await runDoctor({ target });
    expect(output(log)).toContain("✓ Install íntegro.");
    expect(process.exitCode ?? 0).not.toBe(1);
  });

  it("maker remove sem config é reavaliado quando a config aparece, sem mediação", async () => {
    const target = await project(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await removeAddon(target, "saas");
    expect((await readManifest(target))!.files[constitution]!.edited).toBe(true);
    await cp(join(project020, "maker.config.json"), join(target, "maker.config.json"));
    await runUpdate({ target });
    expect(output(log)).not.toContain("precisam de mediação");
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
    const manifest = (await readManifest(target))!;
    expect(Object.values(manifest.files).some((entry) => entry.edited)).toBe(false);
  });

  it("alvo de add-on 0.2.0 sem base e sem customização adota a base sem pedir mediação", async () => {
    const target = await project();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target });
    expect(output(log)).not.toContain("precisam de mediação");
    const manifest = (await readManifest(target))!;
    expect(manifest.files[constitution]!.baseHash).toBeDefined();
    expect(manifest.files[constitution]!.source).toBe("addon:saas");
    await runUpdate({ target, export: true });
    expect(existsSync(join(target, DEFAULT_MEDIATION_DIR))).toBe(false);
  });

  it.each([false, true])("segundo update seguido não altera nada (add-on: %s)", async (fromLegacy) => {
    const target = fromLegacy ? await project() : await fresh();
    await runUpdate({ target });
    const before = await snapshot(target);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runUpdate({ target, dryRun: true });
    const effective = output(log).split("\n").filter((line) => /^(create|update|remove|merge)\s/.test(line));
    expect(effective).toEqual([]);
    await runUpdate({ target });
    expect(await snapshot(target)).toEqual(before);
  });

  it("media agente legado com papel divergente movendo customizações e bloco para o papel", async () => {
    const target = await legacy("0.4.0");
    const adapter = ".claude/agents/architect.md";
    const shared = ".maker/workflow/agents/architect.md";
    await appendFile(join(target, shared), "regra nova no papel compartilhado\n");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runUpdate({ target });
    await runUpdate({ target, export: true });
    const dir = join(target, DEFAULT_MEDIATION_DIR);
    const index = JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8"));
    const group = index.items.filter((item: { group: string | null }) => item.group === adapter);
    expect(group.map((item: { path: string }) => item.path).sort()).toEqual([adapter, shared]);
    const idOf = (path: string) => group.find((item: { path: string }) => item.path === path).id;
    const item = (path: string, name: string) => readFile(join(dir, "items", idOf(path), name), "utf-8");
    const legacyAgent = await item(adapter, "local");
    const block = legacyAgent.match(/<!-- maker:addon:saas:start -->[\s\S]*?<!-- maker:addon:saas:end -->/)![0];
    const sharedResolved = `${await item(shared, "local")}\nCustomização fora do bloco.\n\n${block}\n`;
    await writeFile(join(dir, "items", idOf(shared), "resolved"), sharedResolved);
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    await writeFile(join(dir, "items", idOf(adapter), "resolved"), `${await item(adapter, "upstream")}\n${block}\n`);
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    await writeFile(join(dir, "items", idOf(adapter), "resolved"), (await item(adapter, "upstream")).replace("model: opus", "model: modelo-local"));
    await runUpdate({ target, applyResolutions: true });
    expect(await readFile(join(target, shared), "utf-8")).toBe(sharedResolved);
    expect(await readFile(join(target, adapter), "utf-8")).toContain("model: modelo-local");
    const manifest = (await readManifest(target))!;
    expect(manifest.files[adapter]!.source).toBe("engine:claude");
    expect(manifest.files[shared]!.source).toBe("addon:saas");
    const state = (await readAddonState(target, "saas"))!;
    expect(state.injectedTargets).toContain(shared);
    expect(state.injectedTargets).not.toContain(adapter);
    expect((await validateAgentIntegration(target, "claude")).issues).toEqual([]);
    await removeAddon(target, "saas");
    const body = await readFile(join(target, shared), "utf-8");
    expect(body).not.toContain("maker:addon:saas");
    expect(body).toContain("regra nova no papel compartilhado");
  });

  it("rejeita índice adulterado que omite o adapter de um grupo legado", async () => {
    const target = await legacy("0.4.0");
    const adapter = ".claude/agents/architect.md";
    const shared = ".maker/workflow/agents/architect.md";
    await appendFile(join(target, shared), "regra nova no papel compartilhado\n");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runUpdate({ target, export: true });
    const dir = join(target, DEFAULT_MEDIATION_DIR);
    const indexPath = join(dir, "mediation.json");
    const index = JSON.parse(await readFile(indexPath, "utf-8"));
    const sharedItem = index.items.find((item: { path: string }) => item.path === shared);
    expect(index.items.some((item: { path: string }) => item.path === adapter)).toBe(true);
    const adapterItem = index.items.find((item: { path: string }) => item.path === adapter);
    index.items = [sharedItem];
    await writeFile(indexPath, JSON.stringify(index));
    await rm(join(dir, "items", adapterItem.id), { recursive: true });
    await writeFile(join(dir, "items", sharedItem.id, "resolved"), await readFile(join(dir, "items", sharedItem.id, "local")));
    const before = await readManifest(target);
    await expect(runUpdate({ target, applyResolutions: true })).rejects.toThrow("Propostas de mediação rejeitadas");
    expect(await readManifest(target)).toEqual(before);
  });
});
