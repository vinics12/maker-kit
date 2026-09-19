#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import pc9 from "picocolors";

// src/commands/init.ts
import { resolve as resolve2, join as join6 } from "path";
import { existsSync as existsSync5 } from "fs";
import pc from "picocolors";

// src/config/load.ts
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// src/config/schema.ts
import { z } from "zod";
var agentProviderSchema = z.enum(["claude", "codex"]);
var configSchema = z.object({
  /** CLI agêntica instalada inicialmente. Claude permanece o default retrocompatível. */
  agent: agentProviderSchema.default("claude"),
  project: z.object({
    name: z.string().min(1, "project.name \xE9 obrigat\xF3rio"),
    /** slug kebab-case; derivado de name quando ausente. */
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "project.slug deve ser kebab-case").optional()
  }),
  layout: z.object({
    /** Globs que o run-spec usa para rotear trabalho de frontend. */
    frontendGlobs: z.array(z.string()).default(["apps/*/src/**", "src/**"]),
    /** Globs que o run-spec usa para rotear trabalho de backend/dados. */
    backendGlobs: z.array(z.string()).default(["services/**", "functions/**", "api/**"])
  }).default({}),
  commands: z.object({
    verify: z.string().default("npm run verify"),
    build: z.string().default("npm run build"),
    test: z.string().default("npm test"),
    dev: z.string().default("npm run dev")
  }).default({})
});
function slugify(input) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}
function parseConfig(raw) {
  const parsed = configSchema.parse(raw);
  if (!parsed.project.slug) {
    parsed.project.slug = slugify(parsed.project.name);
  }
  return parsed;
}

// src/config/prompts.ts
import * as p from "@clack/prompts";
async function promptConfig() {
  p.intro("maker \u2014 instalar o motor de cria\xE7\xE3o de produtos");
  const agent2 = await p.select({
    message: "CLI ag\xEAntica",
    initialValue: "claude",
    options: [
      { value: "claude", label: "Claude Code", hint: "padr\xE3o" },
      { value: "codex", label: "Codex" }
    ]
  });
  if (p.isCancel(agent2)) cancel2();
  const name = await p.text({
    message: "Nome do projeto",
    placeholder: "Acme Platform",
    validate: (v) => v.trim().length === 0 ? "Obrigat\xF3rio" : void 0
  });
  if (p.isCancel(name)) cancel2();
  const slug = await p.text({
    message: "Slug (kebab-case)",
    initialValue: slugify(name),
    validate: (v) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? void 0 : "Use kebab-case"
  });
  if (p.isCancel(slug)) cancel2();
  const frontendGlobs = await p.text({
    message: "Globs de frontend (v\xEDrgula) \u2014 usados no roteamento de dev",
    initialValue: "apps/*/src/**, src/**"
  });
  if (p.isCancel(frontendGlobs)) cancel2();
  const backendGlobs = await p.text({
    message: "Globs de backend/dados (v\xEDrgula)",
    initialValue: "services/**, functions/**, api/**"
  });
  if (p.isCancel(backendGlobs)) cancel2();
  const verify = await p.text({
    message: "Comando de verify (lint+types+test)",
    initialValue: "npm run verify"
  });
  if (p.isCancel(verify)) cancel2();
  const build = await p.text({ message: "Comando de build", initialValue: "npm run build" });
  if (p.isCancel(build)) cancel2();
  const test = await p.text({ message: "Comando de test", initialValue: "npm test" });
  if (p.isCancel(test)) cancel2();
  const dev = await p.text({ message: "Comando de dev", initialValue: "npm run dev" });
  if (p.isCancel(dev)) cancel2();
  return parseConfig({
    agent: agent2,
    project: { name: name.trim(), slug },
    layout: {
      frontendGlobs: splitList(frontendGlobs),
      backendGlobs: splitList(backendGlobs)
    },
    commands: {
      verify,
      build,
      test,
      dev
    }
  });
}
function splitList(s) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function cancel2() {
  p.cancel("Opera\xE7\xE3o cancelada.");
  process.exit(1);
}

// src/config/load.ts
var CONFIG_FILE = "maker.config.json";
async function loadConfig(opts) {
  if (opts.configPath) {
    const raw = JSON.parse(await readFile(opts.configPath, "utf-8"));
    return parseConfig(opts.agent ? { ...raw, agent: opts.agent } : raw);
  }
  const inTarget = join(opts.targetDir, CONFIG_FILE);
  if (existsSync(inTarget)) {
    const raw = JSON.parse(await readFile(inTarget, "utf-8"));
    return parseConfig(opts.agent ? { ...raw, agent: opts.agent } : raw);
  }
  if (opts.yes) {
    if (!opts.name) {
      throw new Error(
        `Sem ${CONFIG_FILE} e sem --name: em modo --yes forne\xE7a --config <arquivo> ou --name <nome>.`
      );
    }
    return parseConfig({ agent: opts.agent, project: { name: opts.name } });
  }
  const prompted = await promptConfig();
  return opts.agent ? parseConfig({ ...prompted, agent: opts.agent }) : prompted;
}

// src/render/engine.ts
import Handlebars from "handlebars";
function buildContext(config) {
  return {
    project: { ...config.project, slug: config.project.slug },
    layout: config.layout,
    commands: config.commands,
    agent: config.agent,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
  };
}
var hb = Handlebars.create();
hb.registerHelper(
  "join",
  (arr, sep) => Array.isArray(arr) ? arr.join(typeof sep === "string" ? sep : ", ") : ""
);
function render(source, ctx) {
  return renderRaw(source, ctx);
}
function renderRaw(source, ctx) {
  const template = hb.compile(source, { noEscape: true, strict: false });
  return template(ctx);
}

// src/render/manifest.ts
import { createHash } from "crypto";
import { readFile as readFile2, writeFile, mkdir } from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import { dirname, join as join2, relative } from "path";
var MANIFEST_FILE = ".maker/manifest.json";
function enabledAgents(manifest) {
  return manifest.agents?.length ? manifest.agents : ["claude"];
}
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
async function writeManifest(targetDir, manifest) {
  const path = join2(targetDir, MANIFEST_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}
async function readManifest(targetDir) {
  const path = join2(targetDir, MANIFEST_FILE);
  if (!existsSync2(path)) return null;
  return JSON.parse(await readFile2(path, "utf-8"));
}
async function verifyManifest(targetDir, manifest) {
  const missing = [];
  const modified = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const abs = join2(targetDir, rel);
    if (!existsSync2(abs)) {
      missing.push(rel);
      continue;
    }
    const current = sha256(await readFile2(abs));
    if (current !== entry.hash) modified.push(rel);
  }
  return {
    ok: missing.length === 0 && modified.length === 0,
    missing,
    modified,
    checked: Object.keys(manifest.files).length
  };
}
function manifestKey(targetDir, absPath) {
  return relative(targetDir, absPath).split("\\").join("/");
}

// src/util/version.ts
import { readFileSync } from "fs";
import { join as join4 } from "path";

// src/util/scaffold.ts
import { fileURLToPath } from "url";
import { dirname as dirname2, join as join3, resolve } from "path";
import { existsSync as existsSync3 } from "fs";
import { mkdir as mkdir2, readFile as readFile3, writeFile as writeFile2, copyFile } from "fs/promises";
import fg from "fast-glob";
var HBS_EXT = ".hbs";
function packageRoot() {
  let dir = dirname2(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync3(join3(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname2(fileURLToPath(import.meta.url)), "..");
}
function templatesDir(sub = "") {
  return join3(packageRoot(), "templates", sub);
}
async function applyTree(srcTree, targetDir, ctx, source) {
  const files = await fg("**/*", {
    cwd: srcTree,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false
  });
  const applied = [];
  for (const relSrc of files) {
    const absSrc = join3(srcTree, relSrc);
    const isTemplate = relSrc.endsWith(HBS_EXT);
    const relOut = isTemplate ? relSrc.slice(0, -HBS_EXT.length) : relSrc;
    const absOut = join3(targetDir, relOut);
    await mkdir2(dirname2(absOut), { recursive: true });
    let hash;
    if (isTemplate) {
      const rendered = render(await readFile3(absSrc, "utf-8"), ctx);
      await writeFile2(absOut, rendered, "utf-8");
      hash = sha256(rendered);
    } else {
      await copyFile(absSrc, absOut);
      hash = sha256(await readFile3(absSrc));
    }
    applied.push({ rel: manifestKey(targetDir, absOut), entry: { hash, source } });
  }
  return applied;
}

// src/util/version.ts
function makerVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join4(packageRoot(), "package.json"), "utf-8")
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// src/util/engine-scaffold.ts
import { existsSync as existsSync4 } from "fs";
import { mkdir as mkdir3, readFile as readFile4, writeFile as writeFile3, copyFile as copyFile2 } from "fs/promises";
import { dirname as dirname3, join as join5 } from "path";
import fg2 from "fast-glob";
var HBS_EXT2 = ".hbs";
async function applyEngine(targetDir, ctx, agents) {
  const applied = await applyTree(templatesDir("engine/common"), targetDir, ctx, "engine:common");
  applied.push(...await applySharedAgents(targetDir, ctx));
  for (const agent2 of agents) applied.push(...await applyProviderAdapter(targetDir, ctx, agent2));
  return applied;
}
async function applyAgentProvider(targetDir, ctx, provider) {
  const sharedRoot = join5(targetDir, ".maker/workflow/agents");
  return [
    ...existsSync4(sharedRoot) ? [] : await applySharedAgents(targetDir, ctx),
    ...await applyProviderAdapter(targetDir, ctx, provider)
  ];
}
async function applyProviderAdapter(targetDir, ctx, provider) {
  const staticTree = templatesDir(`engine/providers/${provider}`);
  const applied = existsSync4(staticTree) ? await applyTree(staticTree, targetDir, ctx, `engine:${provider}`) : [];
  applied.push(...await applySkills(targetDir, ctx, provider));
  applied.push(...await applyAgents(targetDir, ctx, provider));
  return applied;
}
async function applySkills(targetDir, ctx, provider) {
  const root = templatesDir("engine/workflow/skills");
  const files = await fg2("**/*", { cwd: root, dot: true, onlyFiles: true });
  const outputRoot = provider === "claude" ? ".claude/skills" : ".agents/skills";
  const applied = [];
  for (const relSrc of files) {
    const isTemplate = relSrc.endsWith(HBS_EXT2);
    const rel = isTemplate ? relSrc.slice(0, -HBS_EXT2.length) : relSrc;
    const absSrc = join5(root, relSrc);
    const absOut = join5(targetDir, outputRoot, rel);
    await mkdir3(dirname3(absOut), { recursive: true });
    if (!isTemplate && !rel.endsWith(".md")) {
      await copyFile2(absSrc, absOut);
    } else {
      const raw = await readFile4(absSrc, "utf-8");
      const rendered = isTemplate ? render(raw, ctx) : raw;
      const content = provider === "codex" && rel.endsWith("SKILL.md") ? codexSkill(rendered) : provider === "codex" ? adaptCodexText(rendered) : rendered;
      await writeFile3(absOut, content, "utf-8");
    }
    applied.push(await appliedEntry(targetDir, absOut, `engine:${provider}`));
  }
  return applied;
}
async function applyAgents(targetDir, ctx, provider) {
  const root = templatesDir("engine/workflow/agents");
  const files = await fg2("*.md{,.hbs}", { cwd: root, onlyFiles: true });
  const applied = [];
  for (const relSrc of files) {
    const raw = await readFile4(join5(root, relSrc), "utf-8");
    const rendered = relSrc.endsWith(HBS_EXT2) ? render(raw, ctx) : raw;
    const parsed = parseFrontmatter(rendered);
    const fileName = relSrc.replace(/\.md(?:\.hbs)?$/, provider === "claude" ? ".md" : ".toml");
    const absOut = join5(
      targetDir,
      provider === "claude" ? ".claude/agents" : ".codex/agents",
      fileName
    );
    await mkdir3(dirname3(absOut), { recursive: true });
    const sharedPath = `.maker/workflow/agents/${parsed.name}.md`;
    const content = provider === "claude" ? `---
${parsed.frontmatter}
---

Read \`${sharedPath}\` completely before acting and follow it as your role instructions.
` : [
      `name = ${JSON.stringify(parsed.name)}`,
      `description = ${JSON.stringify(adaptCodexText(parsed.description))}`,
      `developer_instructions = ${JSON.stringify(`Read ${sharedPath} completely before acting and follow it as your role instructions.
`)}`,
      ""
    ].join("\n");
    await writeFile3(absOut, content, "utf-8");
    applied.push(await appliedEntry(targetDir, absOut, `engine:${provider}`));
  }
  return applied;
}
async function applySharedAgents(targetDir, ctx) {
  const root = templatesDir("engine/workflow/agents");
  const files = await fg2("*.md{,.hbs}", { cwd: root, onlyFiles: true });
  const applied = [];
  for (const relSrc of files) {
    const raw = await readFile4(join5(root, relSrc), "utf-8");
    const rendered = relSrc.endsWith(HBS_EXT2) ? render(raw, ctx) : raw;
    const parsed = parseFrontmatter(rendered);
    const absOut = join5(targetDir, ".maker/workflow/agents", `${parsed.name}.md`);
    await mkdir3(dirname3(absOut), { recursive: true });
    await writeFile3(absOut, `${adaptSharedAgentText(parsed.body.trim())}
`, "utf-8");
    applied.push(await appliedEntry(targetDir, absOut, "engine:common"));
  }
  return applied;
}
function parseFrontmatter(input) {
  const match = input.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("Template de agente sem frontmatter YAML.");
  const frontmatter = match[1];
  const name = frontmatter.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  if (!name) throw new Error("Template de agente sem name.");
  const block = frontmatter.match(/^description:\s*\|\n((?:[ \t]+.*\n?)*)/m)?.[1];
  const inline = frontmatter.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m)?.[1];
  const description = (block ? block.replace(/^\s+/gm, " ") : inline ?? name).replace(/\s+/g, " ").trim();
  return { name, description, frontmatter, body: match[2] };
}
function codexSkill(input) {
  const parsed = parseFrontmatter(input);
  const body = adaptCodexText(parsed.body).replace(
    /\$ARGUMENTS/g,
    `o texto da mensagem do usu\xE1rio que acompanha \`$${parsed.name}\``
  );
  return `---
name: ${parsed.name}
description: ${adaptCodexText(parsed.description)}
---
${body}`;
}
function adaptCodexText(input) {
  return input.replace(/\.claude\/skills/g, ".agents/skills").replace(
    /\/(run-spec|run-brainstorm|speckit-[a-z0-9-]+|fix-on-validation)\b/g,
    (_match, name) => `$${name}`
  ).replace(/Generated with \[Claude Code\]\([^)]*\)/g, "Generated with maker on Codex").replace(/CLAUDE\.md\/Auto Memory/g, "AGENTS.md/mem\xF3ria do projeto").replace(/Claude Preview/g, "automa\xE7\xE3o de browser dispon\xEDvel").replace(/Chrome MCP/g, "automa\xE7\xE3o de browser dispon\xEDvel").replace(/Claude Code/g, "Codex").replace(/\(Skill tool\)/g, "(skill dispon\xEDvel)").replace(/subagent_type:/g, "agent:");
}
function adaptSharedAgentText(input) {
  return input.replace(/Claude Preview/g, "automa\xE7\xE3o de browser dispon\xEDvel").replace(/Chrome MCP/g, "automa\xE7\xE3o de browser dispon\xEDvel").replace(/mcp__Claude_Preview__[a-z0-9_]+/gi, "uma ferramenta de browser dispon\xEDvel").replace(/mcp__claude-in-chrome__[a-z0-9_]+/gi, "uma ferramenta de browser dispon\xEDvel").replace(/\.claude\/launch\.json/g, "a configura\xE7\xE3o de execu\xE7\xE3o do agente").replace(/Claude Code/g, "a CLI ag\xEAntica");
}
async function appliedEntry(targetDir, absOut, source) {
  const entry = { hash: sha256(await readFile4(absOut)), source };
  return { rel: manifestKey(targetDir, absOut), entry };
}

// src/commands/init.ts
async function runInit(opts) {
  const targetDir = resolve2(opts.target ?? process.cwd());
  if (existsSync5(join6(targetDir, ".specify")) && !opts.force) {
    throw new Error(
      `${targetDir} j\xE1 cont\xE9m .specify/ \u2014 use --force para reinstalar por cima.`
    );
  }
  const priorManifest = await readManifest(targetDir);
  const loadedConfig = await loadConfig({
    targetDir,
    configPath: opts.config,
    yes: opts.yes,
    name: opts.name,
    agent: opts.agent
  });
  const agents = priorManifest ? enabledAgents(priorManifest) : [loadedConfig.agent];
  if (priorManifest && opts.agent && !agents.includes(opts.agent)) {
    throw new Error(
      `A integra\xE7\xE3o ${opts.agent} ainda n\xE3o est\xE1 habilitada \u2014 use 'maker agent add ${opts.agent}'.`
    );
  }
  const config = parseConfig({
    ...loadedConfig,
    agent: opts.agent ?? priorManifest?.config?.agent ?? agents[0]
  });
  const ctx = buildContext(config);
  const applied = await applyEngine(targetDir, ctx, agents);
  const manifest = {
    schemaVersion: 2,
    makerVersion: makerVersion(),
    project: { name: config.project.name, slug: config.project.slug },
    config,
    agents,
    installedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: Object.fromEntries(applied.map((a) => [a.rel, a.entry]))
  };
  await writeManifest(targetDir, manifest);
  console.log(pc.green(`
\u2713 Motor instalado em ${targetDir}`));
  console.log(pc.dim(`  ${applied.length} arquivos \xB7 projeto "${config.project.name}"`));
  if (process.platform === "win32") {
    console.log(
      pc.yellow(
        "\n\u26A0 Windows detectado. O workflow gerado usa scripts bash e comandos POSIX (grep/git)."
      )
    );
    console.log(
      pc.yellow(
        "  Rode o motor dentro do WSL2 (Ubuntu) para o comportamento id\xEAntico ao Linux \u2014"
      )
    );
    console.log(pc.yellow("  veja a se\xE7\xE3o 'Windows' no README do maker."));
  }
  console.log("\nPr\xF3ximos passos:");
  console.log(
    `  1. Preencha ${pc.cyan(".specify/memory/project-rules.md")} (bases t\xE9cnicas + regras de neg\xF3cio)`
  );
  console.log(`  2. Revise ${pc.cyan(".specify/memory/constitution.md")} (se\xE7\xF5es do projeto)`);
  const invocation = config.agent === "codex" ? "$" : "/";
  console.log(
    `  3. Abra o ${config.agent === "codex" ? "Codex" : "Claude Code"} e rode ${pc.cyan(`${invocation}run-brainstorm`)} ou ${pc.cyan(`${invocation}run-spec`)}`
  );
}

// src/commands/doctor.ts
import { resolve as resolve3 } from "path";
import pc2 from "picocolors";

// src/agents/validate.ts
import { existsSync as existsSync6 } from "fs";
import { readFile as readFile5 } from "fs/promises";
import { join as join7 } from "path";
import fg3 from "fast-glob";
import { parse as parseToml } from "smol-toml";
import { z as z2 } from "zod";
var codexAgentSchema = z2.object({
  name: z2.string().min(1),
  description: z2.string().min(1),
  developer_instructions: z2.string().min(1)
});
async function validateAgentIntegration(targetDir, provider) {
  const skillRoot = join7(targetDir, provider === "claude" ? ".claude/skills" : ".agents/skills");
  const agentRoot = join7(targetDir, provider === "claude" ? ".claude/agents" : ".codex/agents");
  const skillFiles = existsSync6(skillRoot) ? await fg3("**/SKILL.md", { cwd: skillRoot, onlyFiles: true }) : [];
  const agentFiles = existsSync6(agentRoot) ? await fg3(provider === "claude" ? "*.md" : "*.toml", { cwd: agentRoot, onlyFiles: true }) : [];
  const issues = [];
  if (!existsSync6(join7(targetDir, "AGENTS.md"))) issues.push("AGENTS.md ausente");
  if (skillFiles.length === 0) issues.push(`${relativeRoot(provider, "skills")} sem skills`);
  if (agentFiles.length === 0) issues.push(`${relativeRoot(provider, "agents")} sem agentes`);
  for (const rel of skillFiles) {
    const path = join7(skillRoot, rel);
    const content = await readFile5(path, "utf-8");
    if (!/^---\n[\s\S]*?^name:\s*.+$[\s\S]*?^description:\s*.+$[\s\S]*?^---$/m.test(content)) {
      issues.push(`${relativeRoot(provider, "skills")}/${rel}: frontmatter name/description inv\xE1lido`);
    }
    if (provider === "codex" && /\/(?:run-spec|run-brainstorm|speckit-[a-z0-9-]+)\b/.test(content)) {
      issues.push(`${relativeRoot(provider, "skills")}/${rel}: refer\xEAncia slash incompat\xEDvel com Codex`);
    }
  }
  for (const rel of agentFiles) {
    const path = join7(agentRoot, rel);
    const content = await readFile5(path, "utf-8");
    if (provider === "codex") {
      try {
        codexAgentSchema.parse(parseToml(content));
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
        issues.push(`.codex/agents/${rel}: TOML inv\xE1lido (${message})`);
        continue;
      }
    } else if (!/^---\n[\s\S]*?^name:\s*.+$[\s\S]*?^description:\s*[|"']?.+$[\s\S]*?^---$/m.test(content)) {
      issues.push(`.claude/agents/${rel}: frontmatter inv\xE1lido`);
    }
    const shared = content.match(/\.maker\/workflow\/agents\/[a-z0-9-]+\.md/)?.[0];
    if (!shared || !existsSync6(join7(targetDir, shared))) {
      issues.push(`${relativeRoot(provider, "agents")}/${rel}: papel compartilhado ausente`);
    }
  }
  if (provider === "claude" && !existsSync6(join7(targetDir, "CLAUDE.md"))) {
    issues.push("CLAUDE.md ausente");
  }
  return { provider, skills: skillFiles.length, agents: agentFiles.length, issues };
}
function relativeRoot(provider, kind) {
  if (provider === "claude") return kind === "skills" ? ".claude/skills" : ".claude/agents";
  return kind === "skills" ? ".agents/skills" : ".codex/agents";
}

// src/commands/doctor.ts
async function runDoctor(opts) {
  const targetDir = resolve3(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new Error(`Nenhum install do maker encontrado em ${targetDir} (.maker/manifest.json ausente).`);
  }
  const result = await verifyManifest(targetDir, manifest);
  const integrations = await Promise.all(
    enabledAgents(manifest).map((agent2) => validateAgentIntegration(targetDir, agent2))
  );
  console.log(pc2.dim(`Projeto "${manifest.project.name}" \xB7 maker ${manifest.makerVersion}`));
  console.log(pc2.dim(`${result.checked} arquivos verificados`));
  for (const integration of integrations) {
    const status = integration.issues.length ? pc2.red("degradada") : pc2.green("\xEDntegra");
    console.log(
      `  ${integration.provider}: ${status} \xB7 ${integration.skills} skills \xB7 ${integration.agents} agentes`
    );
    for (const issue of integration.issues) console.log(pc2.red(`    ${issue}`));
  }
  if (result.ok && integrations.every((integration) => integration.issues.length === 0)) {
    console.log(pc2.green("\u2713 Install \xEDntegro."));
    return;
  }
  for (const m of result.missing) console.log(pc2.red(`  ausente:    ${m}`));
  for (const m of result.modified) console.log(pc2.yellow(`  modificado: ${m}`));
  console.log(
    pc2.dim(`
${result.missing.length} ausente(s), ${result.modified.length} modificado(s).`)
  );
  process.exitCode = 1;
}

// src/commands/update.ts
import { existsSync as existsSync7 } from "fs";
import { copyFile as copyFile3, mkdir as mkdir4, mkdtemp, readFile as readFile6, rm } from "fs/promises";
import { tmpdir } from "os";
import { dirname as dirname4, join as join8, resolve as resolve4 } from "path";
import pc3 from "picocolors";
async function runUpdate(opts) {
  const targetDir = resolve4(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const { config, recovered } = await resolveConfig(targetDir, manifest.config, manifest.project);
  const agents = enabledAgents(manifest);
  const staging = await mkdtemp(join8(tmpdir(), "maker-update-"));
  const updated = [];
  const skipped = [];
  try {
    const expected = await applyEngine(staging, buildContext(config), agents);
    for (const file of expected) {
      const staged = join8(staging, file.rel);
      const destination = join8(targetDir, file.rel);
      const newContent = await readFile6(staged);
      const newHash = sha256(newContent);
      if (existsSync7(destination)) {
        const currentHash = sha256(await readFile6(destination));
        const recordedEntry = manifest.files[file.rel];
        const recorded = recordedEntry?.hash;
        if (recordedEntry?.source.startsWith("addon:") && currentHash === recorded) {
          skipped.push(file.rel);
          continue;
        }
        if (recorded && currentHash !== recorded) {
          skipped.push(file.rel);
          continue;
        }
        if (currentHash === newHash) {
          manifest.files[file.rel] = file.entry;
          continue;
        }
      }
      await mkdir4(dirname4(destination), { recursive: true });
      await copyFile3(staged, destination);
      manifest.files[file.rel] = file.entry;
      updated.push(file.rel);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  manifest.schemaVersion = 2;
  manifest.agents = agents;
  if (manifest.config || recovered) manifest.config = config;
  manifest.makerVersion = makerVersion();
  await writeManifest(targetDir, manifest);
  console.log(pc3.green(`\u2713 ${updated.length} arquivo(s) atualizado(s).`));
  if (skipped.length) {
    console.log(pc3.yellow(`${skipped.length} preservado(s) por edi\xE7\xE3o local:`));
    for (const path of skipped) console.log(pc3.dim(`  ${path}`));
  }
}
async function resolveConfig(targetDir, stored, project) {
  if (stored) return { config: parseConfig(stored), recovered: true };
  const configPath = join8(targetDir, "maker.config.json");
  if (existsSync7(configPath)) {
    return {
      config: parseConfig(JSON.parse(await readFile6(configPath, "utf-8"))),
      recovered: true
    };
  }
  return { config: parseConfig({ project }), recovered: false };
}

// src/commands/add.ts
import { resolve as resolve5 } from "path";
import pc4 from "picocolors";
import * as p2 from "@clack/prompts";

// src/addons/loader.ts
import { readFile as readFile7, readdir } from "fs/promises";
import { existsSync as existsSync8 } from "fs";
import { join as join9 } from "path";

// src/addons/schema.ts
import { z as z3 } from "zod";
var addonKnobSchema = z3.object({
  name: z3.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "knob.name deve ser identificador simples"),
  prompt: z3.string(),
  default: z3.string().default("")
});
var agentFragmentSchema = z3.object({
  agent: z3.string(),
  // nome do agente-alvo (sem .md), ex.: "code-reviewer"
  file: z3.string()
  // path relativo ao dir do add-on, ex.: "agents/code-reviewer.fragment.md.hbs"
});
var addonFileSchema = z3.object({
  from: z3.string(),
  // path relativo ao dir do add-on
  to: z3.string()
  // path relativo ao target, ex.: ".specify/memory/saas-reference.md"
});
var addonManifestSchema = z3.object({
  id: z3.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id deve ser kebab-case"),
  name: z3.string(),
  description: z3.string().default(""),
  version: z3.string().default("0.1.0"),
  knobs: z3.array(addonKnobSchema).default([]),
  /** .hbs injetados na seção "Princípios do Projeto" da constitution. */
  principles: z3.array(z3.string()).default([]),
  /** fragmentos anexados a agentes específicos. */
  agentFragments: z3.array(agentFragmentSchema).default([]),
  /** arquivos novos escritos no target (renderizados se .hbs). */
  files: z3.array(addonFileSchema).default([])
});

// src/addons/loader.ts
function addonDir(id) {
  return join9(packageRoot(), "addons", id);
}
async function loadAddon(id) {
  const dir = addonDir(id);
  const manifestPath = join9(dir, "addon.json");
  if (!existsSync8(manifestPath)) {
    throw new Error(`Add-on "${id}" n\xE3o encontrado (esperado em addons/${id}/addon.json).`);
  }
  const raw = JSON.parse(await readFile7(manifestPath, "utf-8"));
  const parsed = addonManifestSchema.parse(raw);
  if (parsed.id !== id) {
    throw new Error(`Add-on id divergente: pasta "${id}" vs manifest "${parsed.id}".`);
  }
  return parsed;
}
async function listAddonCatalog(root = join9(packageRoot(), "addons")) {
  if (!existsSync8(root)) return [];
  const dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return Promise.all(
    dirs.map(async (id) => {
      try {
        const raw = JSON.parse(await readFile7(join9(root, id, "addon.json"), "utf-8"));
        const manifest = addonManifestSchema.parse(raw);
        if (manifest.id !== id) {
          return { id, manifest: null, issue: `id do manifest \xE9 "${manifest.id}"` };
        }
        return { id, manifest };
      } catch (error) {
        return {
          id,
          manifest: null,
          issue: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

// src/addons/apply.ts
import { readFile as readFile9, writeFile as writeFile5, mkdir as mkdir6 } from "fs/promises";
import { existsSync as existsSync10 } from "fs";
import { dirname as dirname6, join as join11 } from "path";
import { rm as rm3 } from "fs/promises";

// src/addons/inject.ts
var startMarker = (id) => `<!-- maker:addon:${id}:start -->`;
var endMarker = (id) => `<!-- maker:addon:${id}:end -->`;
function wrap(id, block) {
  return `${startMarker(id)}
${block.trimEnd()}
${endMarker(id)}`;
}
function upsertBlock(content, id, block, opts = {}) {
  const wrapped = wrap(id, block);
  const s = startMarker(id);
  const e = endMarker(id);
  if (content.includes(s) && content.includes(e)) {
    const re = new RegExp(`${escapeRe(s)}[\\s\\S]*?${escapeRe(e)}`);
    return content.replace(re, wrapped);
  }
  if (opts.replacePlaceholder && content.includes(opts.replacePlaceholder)) {
    return content.replace(opts.replacePlaceholder, wrapped);
  }
  if (opts.beforeHeading && content.includes(opts.beforeHeading)) {
    return content.replace(opts.beforeHeading, `${wrapped}

${opts.beforeHeading}`);
  }
  return `${content.trimEnd()}

${wrapped}
`;
}
function stripBlock(content, id) {
  const s = startMarker(id);
  const e = endMarker(id);
  if (!content.includes(s) || !content.includes(e)) return content;
  const re = new RegExp(`\\n*${escapeRe(s)}[\\s\\S]*?${escapeRe(e)}\\n*`);
  return content.replace(re, "\n").replace(/\n{3,}/g, "\n\n");
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/addons/state.ts
import { readFile as readFile8, writeFile as writeFile4, mkdir as mkdir5, rm as rm2 } from "fs/promises";
import { existsSync as existsSync9 } from "fs";
import { dirname as dirname5, join as join10 } from "path";
import { z as z4 } from "zod";
var addonStateSchema = z4.object({
  id: z4.string(),
  version: z4.string(),
  appliedAt: z4.string(),
  knobs: z4.record(z4.string()),
  /** Arquivos novos criados pelo add-on (deletáveis na remoção). */
  createdFiles: z4.array(z4.object({ path: z4.string(), hash: z4.string() })),
  /** Arquivos do motor onde o add-on injetou um bloco (por marcador). */
  injectedTargets: z4.array(z4.string())
});
function addonStatePath(targetDir, id) {
  return join10(targetDir, ".maker", "addons", `${id}.json`);
}
function isAddonApplied(targetDir, id) {
  return existsSync9(addonStatePath(targetDir, id));
}
async function readAddonState(targetDir, id) {
  const p3 = addonStatePath(targetDir, id);
  if (!existsSync9(p3)) return null;
  return addonStateSchema.parse(JSON.parse(await readFile8(p3, "utf-8")));
}
async function writeAddonState(targetDir, state) {
  const p3 = addonStatePath(targetDir, state.id);
  await mkdir5(dirname5(p3), { recursive: true });
  await writeFile4(p3, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
async function deleteAddonState(targetDir, id) {
  const p3 = addonStatePath(targetDir, id);
  if (existsSync9(p3)) await rm2(p3);
}

// src/addons/apply.ts
var CONSTITUTION = ".specify/memory/constitution.md";
var PLACEHOLDER = "_(nenhum princ\xEDpio de projeto definido ainda)_";
function addonContext(manifest, knobs) {
  return {
    project: manifest.project,
    addon: knobs,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
  };
}
async function renderFrom(dir, rel, ctx) {
  const raw = await readFile9(join11(dir, rel), "utf-8");
  return rel.endsWith(".hbs") ? renderRaw(raw, ctx) : raw;
}
async function touchManifest(manifest, targetDir, absPath, source) {
  const hash = sha256(await readFile9(absPath));
  manifest.files[manifestKey(targetDir, absPath)] = { hash, source };
}
async function applyAddon(targetDir, addon, knobs) {
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new Error(`Nenhum install do maker em ${targetDir} \u2014 rode 'maker init' antes de add-ons.`);
  }
  const dir = addonDir(addon.id);
  const ctx = addonContext(manifest, knobs);
  const injectedTargets = [];
  const createdFiles = [];
  const prior = await readAddonState(targetDir, addon.id);
  const owned = new Set((prior?.createdFiles ?? []).map((f) => f.path));
  if (addon.principles.length) {
    const absConst = join11(targetDir, CONSTITUTION);
    if (!existsSync10(absConst)) throw new Error(`${CONSTITUTION} ausente no install.`);
    const rendered = [];
    for (const p3 of addon.principles) rendered.push((await renderFrom(dir, p3, ctx)).trim());
    const block = rendered.join("\n\n");
    const current = await readFile9(absConst, "utf-8");
    const next = upsertBlock(current, addon.id, block, {
      replacePlaceholder: PLACEHOLDER,
      beforeHeading: "## Governance"
    });
    await writeFile5(absConst, next, "utf-8");
    await touchManifest(manifest, targetDir, absConst, `addon:${addon.id}`);
    injectedTargets.push(CONSTITUTION);
  }
  for (const frag of addon.agentFragments) {
    const rel = `.maker/workflow/agents/${frag.agent}.md`;
    const abs = join11(targetDir, rel);
    if (!existsSync10(abs)) {
      console.warn(`  aviso: agente ${frag.agent} ausente \u2014 fragmento pulado.`);
      continue;
    }
    const block = (await renderFrom(dir, frag.file, ctx)).trim();
    const next = upsertBlock(await readFile9(abs, "utf-8"), addon.id, block);
    await writeFile5(abs, next, "utf-8");
    await touchManifest(manifest, targetDir, abs, `addon:${addon.id}`);
    injectedTargets.push(rel);
  }
  for (const f of addon.files) {
    const abs = join11(targetDir, f.to);
    if (existsSync10(abs) && !owned.has(f.to)) {
      console.warn(`  aviso: ${f.to} j\xE1 existe (n\xE3o \xE9 deste add-on) \u2014 n\xE3o sobrescrito.`);
      continue;
    }
    const content = await renderFrom(dir, f.from, ctx);
    await mkdir6(dirname6(abs), { recursive: true });
    await writeFile5(abs, content, "utf-8");
    const hash = sha256(Buffer.from(content, "utf-8"));
    manifest.files[manifestKey(targetDir, abs)] = { hash, source: `addon:${addon.id}` };
    createdFiles.push({ path: f.to, hash });
  }
  await writeManifest(targetDir, manifest);
  const state = {
    id: addon.id,
    version: addon.version,
    appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
    knobs,
    createdFiles,
    injectedTargets
  };
  await writeAddonState(targetDir, state);
  return { injectedTargets, createdFiles: createdFiles.map((c) => c.path) };
}
async function removeAddon(targetDir, id) {
  const state = await readAddonState(targetDir, id);
  if (!state) throw new Error(`Add-on "${id}" n\xE3o est\xE1 aplicado em ${targetDir}.`);
  const manifest = await readManifest(targetDir);
  const strippedTargets = [];
  const deletedFiles = [];
  const keptFiles = [];
  for (const rel of state.injectedTargets) {
    const abs = join11(targetDir, rel);
    if (!existsSync10(abs)) continue;
    const next = stripBlock(await readFile9(abs, "utf-8"), id);
    await writeFile5(abs, next, "utf-8");
    if (manifest) await touchManifest(manifest, targetDir, abs, "engine");
    strippedTargets.push(rel);
  }
  for (const f of state.createdFiles) {
    const abs = join11(targetDir, f.path);
    if (!existsSync10(abs)) continue;
    const current = sha256(await readFile9(abs));
    if (current === f.hash) {
      await rm3(abs);
      if (manifest) delete manifest.files[manifestKey(targetDir, abs)];
      deletedFiles.push(f.path);
    } else {
      keptFiles.push(f.path);
    }
  }
  if (manifest) await writeManifest(targetDir, manifest);
  await deleteAddonState(targetDir, id);
  return { strippedTargets, deletedFiles, keptFiles };
}

// src/commands/add.ts
function parseSet(pairs = []) {
  const out = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) throw new Error(`--set inv\xE1lido: "${pair}" (use nome=valor)`);
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}
async function collectKnobs(knobs, provided, yes) {
  const values = {};
  for (const k of knobs) {
    if (k.name in provided) {
      values[k.name] = provided[k.name];
      continue;
    }
    if (yes) {
      values[k.name] = k.default;
      continue;
    }
    const answer = await p2.text({ message: k.prompt, initialValue: k.default });
    if (p2.isCancel(answer)) {
      p2.cancel("Opera\xE7\xE3o cancelada.");
      process.exit(1);
    }
    values[k.name] = answer;
  }
  return values;
}
async function runAdd(id, opts) {
  const targetDir = resolve5(opts.target ?? process.cwd());
  if (isAddonApplied(targetDir, id)) {
    console.log(pc4.yellow(`Add-on "${id}" j\xE1 aplicado \u2014 reaplicando (idempotente).`));
  }
  const addon = await loadAddon(id);
  const provided = parseSet(opts.set);
  const knobs = await collectKnobs(addon.knobs, provided, !!opts.yes);
  const res = await applyAddon(targetDir, addon, knobs);
  console.log(pc4.green(`
\u2713 Add-on "${addon.name}" aplicado em ${targetDir}`));
  if (res.injectedTargets.length)
    console.log(pc4.dim(`  injetado em: ${res.injectedTargets.join(", ")}`));
  if (res.createdFiles.length)
    console.log(pc4.dim(`  arquivos criados: ${res.createdFiles.join(", ")}`));
  console.log(pc4.dim(`  revers\xEDvel com: maker remove ${id}`));
}

// src/commands/remove.ts
import { resolve as resolve6 } from "path";
import pc5 from "picocolors";
async function runRemove(id, opts) {
  const targetDir = resolve6(opts.target ?? process.cwd());
  if (!isAddonApplied(targetDir, id)) {
    throw new Error(`Add-on "${id}" n\xE3o est\xE1 aplicado em ${targetDir}.`);
  }
  const res = await removeAddon(targetDir, id);
  console.log(pc5.green(`
\u2713 Add-on "${id}" removido de ${targetDir}`));
  if (res.strippedTargets.length)
    console.log(pc5.dim(`  blocos removidos de: ${res.strippedTargets.join(", ")}`));
  if (res.deletedFiles.length)
    console.log(pc5.dim(`  arquivos deletados: ${res.deletedFiles.join(", ")}`));
  if (res.keptFiles.length)
    console.log(
      pc5.yellow(`  preservados (editados localmente): ${res.keptFiles.join(", ")}`)
    );
}

// src/commands/runs.ts
import { resolve as resolve7 } from "path";
import pc6 from "picocolors";

// src/runs/read.ts
import { readdir as readdir2, readFile as readFile10 } from "fs/promises";
import { basename, join as join13 } from "path";

// src/runs/schema.ts
import { z as z5 } from "zod";
var phaseSchema = z5.enum(["spec", "plan", "dev", "review"]);
var decisionSchema = z5.enum(["approve", "reject", "edit"]);
var costSchema = z5.object({
  tokens: z5.number().int().nonnegative(),
  duration_ms: z5.number().int().nonnegative()
}).strict();
var base = {
  run_id: z5.string().min(1),
  ts: z5.string().datetime({ offset: true }),
  // ISO-8601 UTC
  cost: costSchema
};
var runStartSchema = z5.object({ type: z5.literal("run.start"), ...base }).strict();
var runEndSchema = z5.object({ type: z5.literal("run.end"), ...base }).strict();
var agentHandoffSchema = z5.object({
  type: z5.literal("agent.handoff"),
  actor: z5.string().min(1),
  phase: phaseSchema,
  ...base
}).strict();
var gateDecisionSchema = z5.object({
  type: z5.literal("gate.decision"),
  gate: phaseSchema,
  actor: z5.string().min(1),
  decision: decisionSchema,
  reason_inferred: z5.string(),
  artifact_diff_ref: z5.string().optional(),
  ...base
}).strict();
var eventSchema = z5.discriminatedUnion("type", [
  runStartSchema,
  agentHandoffSchema,
  gateDecisionSchema,
  runEndSchema
]);

// src/runs/emit.ts
import { appendFile, mkdir as mkdir7 } from "fs/promises";
import { dirname as dirname7, join as join12 } from "path";
var RUNS_DIR = ".maker/runs";

// src/runs/read.ts
async function listRunFiles(target) {
  const dir = join13(target, RUNS_DIR);
  let entries;
  try {
    entries = await readdir2(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => ({ runId: basename(e.name, ".jsonl"), path: join13(dir, e.name) })).sort((a, b) => a.runId.localeCompare(b.runId));
}
async function readRun(path) {
  const raw = await readFile10(path, "utf-8");
  const events = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsedJson;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = eventSchema.safeParse(parsedJson);
    if (result.success) events.push(result.data);
  }
  return events;
}

// src/runs/aggregate.ts
function costByGate(events) {
  const result = {};
  for (const event of events) {
    const gate = faseDe(event);
    if (gate === void 0) continue;
    const acc = result[gate] ??= { tokens: 0, duration_ms: 0 };
    acc.tokens += event.cost.tokens;
    acc.duration_ms += event.cost.duration_ms;
  }
  return result;
}
function runTotals(events) {
  const total = { tokens: 0, duration_ms: 0 };
  for (const event of events) {
    total.tokens += event.cost.tokens;
    total.duration_ms += event.cost.duration_ms;
  }
  return total;
}
function faseDe(event) {
  if (event.type === "agent.handoff") return event.phase;
  if (event.type === "gate.decision") return event.gate;
  return void 0;
}
function rejectionsByGate(runs) {
  const m = runs.length;
  const result = {};
  for (const gate of phaseSchema.options) result[gate] = { n: 0, m };
  for (const events of runs) {
    const rejectedGates = /* @__PURE__ */ new Set();
    for (const event of events) {
      if (event.type === "gate.decision" && event.decision === "reject") {
        rejectedGates.add(event.gate);
      }
    }
    for (const gate of rejectedGates) result[gate].n += 1;
  }
  return result;
}

// src/commands/runs.ts
var GATES = phaseSchema.options;
async function runRuns(opts) {
  const targetDir = resolve7(opts.target ?? process.cwd());
  const files = await listRunFiles(targetDir);
  if (files.length === 0) {
    console.log(pc6.dim("nenhum run registrado"));
    return;
  }
  const allRunsEvents = [];
  for (const file of files) {
    const events = await readRun(file.path);
    allRunsEvents.push(events);
    const perGate = costByGate(events);
    const total = runTotals(events);
    console.log(pc6.bold(file.runId));
    for (const gate of GATES) {
      const cost = perGate[gate];
      if (!cost) continue;
      console.log(
        pc6.dim(`  ${gate}: tokens=${cost.tokens} duration_ms=${cost.duration_ms}`)
      );
    }
    console.log(`  total: tokens=${total.tokens} duration_ms=${total.duration_ms}`);
  }
  const rejections = rejectionsByGate(allRunsEvents);
  console.log("");
  for (const gate of GATES) {
    const { n, m } = rejections[gate];
    console.log(`${gate} reprovou em ${n} de ${m} runs`);
  }
}

// src/commands/list.ts
import { existsSync as existsSync11 } from "fs";
import { lstat, readdir as readdir3 } from "fs/promises";
import { basename as basename2, join as join14, resolve as resolve8 } from "path";
import pc7 from "picocolors";
async function runList(opts) {
  const targetDir = resolve8(opts.target ?? process.cwd());
  const catalog = await listAddonCatalog();
  const listed = await classifyAddons(targetDir, catalog);
  if (!listed.length) {
    console.log(pc7.dim("nenhum add-on dispon\xEDvel"));
    return;
  }
  console.log(pc7.bold("Add-ons dispon\xEDveis:"));
  for (const addon of listed) printAddon(addon);
}
async function classifyAddons(targetDir, catalog) {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const stateIndex = await listStateIds(targetDir);
  const ids = [.../* @__PURE__ */ new Set([...byId.keys(), ...stateIndex.ids])].sort();
  return Promise.all(
    ids.map(async (id) => {
      const entry = byId.get(id) ?? null;
      if (stateIndex.issue) {
        return { id, catalog: entry, status: "degraded", issue: stateIndex.issue };
      }
      if (!entry?.manifest) {
        return {
          id,
          catalog: entry,
          status: "degraded",
          issue: entry?.issue ?? "state existe, mas o add-on n\xE3o est\xE1 dispon\xEDvel no cat\xE1logo"
        };
      }
      const statePath = addonStatePath(targetDir, id);
      if (!existsSync11(statePath)) return { id, catalog: entry, status: "available" };
      try {
        const state = await readAddonState(targetDir, id);
        if (state.id !== id) {
          return { id, catalog: entry, status: "degraded", issue: `state declara id "${state.id}"` };
        }
        if (state.version !== entry.manifest.version) {
          return {
            id,
            catalog: entry,
            status: "degraded",
            issue: `state v${state.version} difere do cat\xE1logo v${entry.manifest.version}`
          };
        }
        return { id, catalog: entry, status: "applied" };
      } catch (error) {
        return {
          id,
          catalog: entry,
          status: "degraded",
          issue: `state inv\xE1lido: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    })
  );
}
async function listStateIds(targetDir) {
  const dir = join14(targetDir, ".maker", "addons");
  let metadata;
  try {
    metadata = await lstat(dir);
  } catch (error) {
    if (error.code === "ENOENT") return { ids: [] };
    return {
      ids: [],
      issue: `n\xE3o foi poss\xEDvel inspecionar .maker/addons: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!metadata.isDirectory()) {
    return { ids: [], issue: ".maker/addons deveria ser um diret\xF3rio" };
  }
  try {
    const ids = (await readdir3(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => basename2(entry.name, ".json")).sort();
    return { ids };
  } catch (error) {
    return {
      ids: [],
      issue: `n\xE3o foi poss\xEDvel ler .maker/addons: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
function printAddon(addon) {
  const manifest = addon.catalog?.manifest;
  const label = addon.status === "applied" ? pc7.green(addon.status) : addon.status === "degraded" ? pc7.red(addon.status) : pc7.dim(addon.status);
  const name = manifest ? `${manifest.name} \xB7 v${manifest.version}` : "manifest indispon\xEDvel";
  console.log(`
${pc7.bold(addon.id)} \xB7 ${name} \xB7 ${label}`);
  if (manifest?.description) console.log(`  ${manifest.description}`);
  console.log(`  knobs: ${manifest?.knobs.length ? manifest.knobs.map((knob) => knob.name).join(", ") : "nenhum"}`);
  if (addon.issue) console.log(pc7.red(`  problema: ${addon.issue}`));
  const next = addon.status === "available" ? `maker add ${addon.id}` : "maker doctor";
  console.log(pc7.dim(`  pr\xF3ximo: ${next}`));
}

// src/commands/agent.ts
import { existsSync as existsSync12 } from "fs";
import { readFile as readFile11 } from "fs/promises";
import { join as join15, resolve as resolve9 } from "path";
import { mkdtemp as mkdtemp2, rm as rm4 } from "fs/promises";
import { tmpdir as tmpdir2 } from "os";
import pc8 from "picocolors";
async function runAgentAdd(providerInput, opts) {
  const provider = agentProviderSchema.parse(providerInput);
  const targetDir = resolve9(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir} \u2014 rode 'maker init' antes.`);
  const agents = enabledAgents(manifest);
  if (agents.includes(provider)) {
    console.log(pc8.dim(`Integra\xE7\xE3o ${provider} j\xE1 est\xE1 habilitada.`));
    return;
  }
  const config = await resolveRenderConfig(targetDir, manifest.config, opts.config);
  await assertNoUnmanagedProviderFiles(
    targetDir,
    provider,
    manifest.files,
    buildContext(config)
  );
  const applied = await applyAgentProvider(targetDir, buildContext(config), provider);
  for (const file of applied) manifest.files[file.rel] = file.entry;
  manifest.schemaVersion = 2;
  manifest.config = config;
  manifest.agents = [...agents, provider];
  await writeManifest(targetDir, manifest);
  const sigil = provider === "codex" ? "$" : "/";
  console.log(pc8.green(`\u2713 Integra\xE7\xE3o ${provider} adicionada (${applied.length} arquivos).`));
  console.log(`  Use ${pc8.cyan(`${sigil}run-brainstorm`)} ou ${pc8.cyan(`${sigil}run-spec`)}.`);
}
async function runAgentList(opts) {
  const targetDir = resolve9(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const enabled = new Set(enabledAgents(manifest));
  console.log(pc8.dim(`Projeto "${manifest.project.name}"`));
  for (const provider of agentProviderSchema.options) {
    if (!enabled.has(provider)) {
      console.log(`  ${provider}: ${pc8.dim("n\xE3o habilitada")}`);
      continue;
    }
    const validation = await validateAgentIntegration(targetDir, provider);
    const status = validation.issues.length ? pc8.red("degradada") : pc8.green("\xEDntegra");
    console.log(`  ${provider}: ${status} \xB7 ${validation.skills} skills \xB7 ${validation.agents} agentes`);
    for (const issue of validation.issues) console.log(pc8.red(`    ${issue}`));
  }
}
async function resolveRenderConfig(targetDir, stored, explicitPath) {
  if (stored) return parseConfig(stored);
  const path = explicitPath ? resolve9(explicitPath) : join15(targetDir, "maker.config.json");
  if (!existsSync12(path)) {
    throw new Error(
      "Este install usa um manifest legado sem a configura\xE7\xE3o de renderiza\xE7\xE3o. Forne\xE7a --config <maker.config.json> para adicionar outra integra\xE7\xE3o com seguran\xE7a."
    );
  }
  return parseConfig(JSON.parse(await readFile11(path, "utf-8")));
}
async function assertNoUnmanagedProviderFiles(targetDir, provider, managed, ctx) {
  const staging = await mkdtemp2(join15(tmpdir2(), "maker-agent-preflight-"));
  let expected;
  try {
    expected = (await applyAgentProvider(staging, ctx, provider)).map((file) => file.rel);
  } finally {
    await rm4(staging, { recursive: true, force: true });
  }
  const collisions = expected.filter(
    (rel) => existsSync12(join15(targetDir, rel)) && !(rel in managed)
  );
  if (collisions.length) {
    throw new Error(
      `A integra\xE7\xE3o ${provider} n\xE3o foi adicionada porque estes arquivos j\xE1 existem e n\xE3o pertencem ao manifest do maker:
  - ${collisions.join("\n  - ")}
Mova ou renomeie esses arquivos e execute o comando novamente; nenhuma altera\xE7\xE3o foi feita.`
    );
  }
}

// src/cli.ts
var program = new Command();
program.name("maker").description("Encapsulador do workflow de cria\xE7\xE3o de produtos (motor SpecKit + multi-agente).").version(makerVersion());
program.command("init").description("Instala o motor no projeto-alvo.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-c, --config <file>", "caminho para maker.config.json").option("-n, --name <name>", "nome do projeto (modo --yes sem config)").option("-a, --agent <agent>", "CLI ag\xEAntica inicial: claude | codex").option("-y, --yes", "n\xE3o interativo; usa config/defaults").option("-f, --force", "reinstala por cima de um .specify/ existente").action(async (opts) => {
  await runInit(opts);
});
var agent = program.command("agent").description("Gerencia integra\xE7\xF5es de CLI ag\xEAntica.");
agent.command("add").argument("<agent>", "integra\xE7\xE3o a adicionar: claude | codex").description("Adiciona outra integra\xE7\xE3o sem remover as j\xE1 habilitadas.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-c, --config <file>", "config exigida apenas para manifests legados").action(async (provider, opts) => {
  await runAgentAdd(provider, opts);
});
agent.command("list").description("Lista integra\xE7\xF5es dispon\xEDveis, habilitadas e seu estado estrutural.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runAgentList(opts);
});
program.command("doctor").description("Verifica a integridade de um install contra o manifest.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runDoctor(opts);
});
program.command("update").description("Atualiza arquivos do motor n\xE3o modificados localmente.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runUpdate(opts);
});
program.command("list").description("Lista add-ons dispon\xEDveis e seu estado no projeto.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runList(opts);
});
program.command("add").argument("<addon>", "id do add-on (ex.: saas)").description("Aplica um add-on sobre um install existente (injeta princ\xEDpios/agentes/arquivos).").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-s, --set <pair...>", "knob do add-on como nome=valor (repet\xEDvel)").option("-y, --yes", "n\xE3o interativo; usa defaults dos knobs").action(async (addon, opts) => {
  await runAdd(addon, opts);
});
program.command("remove").argument("<addon>", "id do add-on (ex.: saas)").description("Remove um add-on aplicado, revertendo inje\xE7\xF5es e arquivos criados.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (addon, opts) => {
  await runRemove(addon, opts);
});
program.command("runs").description("Lista runs registrados com custo/tempo por gate + total.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runRuns(opts);
});
program.parseAsync(process.argv).catch((err) => {
  console.error(pc9.red(`
erro: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
//# sourceMappingURL=cli.js.map