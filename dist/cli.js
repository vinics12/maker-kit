#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import pc9 from "picocolors";

// src/commands/init.ts
import { resolve as resolve2, join as join8 } from "path";
import { lstat as lstat2, mkdtemp, readFile as readFile7, rm as rm2 } from "fs/promises";
import { tmpdir } from "os";
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
  }).prefault({}),
  commands: z.object({
    verify: z.string().default("npm run verify"),
    build: z.string().default("npm run build"),
    test: z.string().default("npm test"),
    dev: z.string().default("npm run dev")
  }).prefault({})
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
  if (!opts.name && opts.fallback) {
    return parseConfig(opts.agent ? { ...opts.fallback, agent: opts.agent } : opts.fallback);
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

// src/util/version.ts
import { readFileSync } from "fs";
import { join as join4 } from "path";

// src/util/scaffold.ts
import { fileURLToPath } from "url";
import { dirname as dirname2, join as join3, resolve } from "path";
import { existsSync as existsSync3 } from "fs";
import { mkdir as mkdir2, readFile as readFile3, writeFile as writeFile2, copyFile } from "fs/promises";
import fg from "fast-glob";

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

// src/util/scaffold.ts
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

// src/changes/plan.ts
import { lstat, readFile as readFile5 } from "fs/promises";
import { join as join6 } from "path";
function createPlan(targetDir, changes) {
  const byPath = /* @__PURE__ */ new Map();
  for (const change of changes) byPath.set(change.path, change);
  return { targetDir, changes: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
function hasConflicts(plan) {
  return plan.changes.some((change) => change.action === "conflict");
}
function formatPlan(plan) {
  if (!plan.changes.length) return "nenhuma altera\xE7\xE3o planejada";
  return plan.changes.map((change) => {
    const action = change.resolution === "merge" ? "merge" : change.action;
    return `${action.padEnd(8)} ${change.path} [${change.source}] \u2014 ${change.reason}`;
  }).join("\n");
}
async function inspectTarget(targetDir, path) {
  const absolute = join6(targetDir, path);
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile()) return { kind: "other", hash: null, mode: metadata.mode };
    const content = await readFile5(absolute);
    return { kind: "file", hash: sha256(content), mode: metadata.mode, content };
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent", hash: null };
    throw error;
  }
}
async function planWrite(args) {
  const desired = Buffer.isBuffer(args.content) ? args.content : Buffer.from(args.content);
  const current = await inspectTarget(args.targetDir, args.path);
  if (current.kind === "absent") {
    return {
      path: args.path,
      action: "create",
      source: args.source,
      reason: args.reason ?? "arquivo ausente",
      expectedHash: null,
      expectedKind: "absent",
      content: desired,
      mode: args.mode
    };
  }
  if (current.kind === "other") {
    return {
      path: args.path,
      action: args.force ? "update" : "conflict",
      source: args.source,
      reason: "o caminho existente n\xE3o \xE9 um arquivo regular",
      expectedHash: null,
      expectedKind: "other",
      content: desired,
      mode: args.mode
    };
  }
  if (current.content.equals(desired)) {
    return {
      path: args.path,
      action: "preserve",
      source: args.source,
      reason: "conte\xFAdo j\xE1 est\xE1 atualizado",
      expectedHash: current.hash,
      expectedKind: "file"
    };
  }
  return {
    path: args.path,
    action: args.force ? "update" : "conflict",
    source: args.source,
    reason: args.reason ?? "conte\xFAdo existente \xE9 diferente",
    expectedHash: current.hash,
    expectedKind: "file",
    content: desired,
    mode: args.mode ?? current.mode
  };
}

// src/changes/transaction.ts
import { randomUUID } from "crypto";
import { constants } from "fs";
import {
  chmod,
  cp,
  mkdir as mkdir4,
  open,
  readFile as readFile6,
  readdir,
  rename,
  rm,
  writeFile as writeFile4
} from "fs/promises";
import { dirname as dirname4, join as join7 } from "path";
var TRANSACTIONS = ".maker/transactions";
var LOCK = ".maker/transaction.lock";
async function recoverPendingTransactions(targetDir) {
  const root = join7(targetDir, TRANSACTIONS);
  let ids;
  try {
    ids = await readdir(root);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const id of ids.sort()) {
    const dir = join7(root, id);
    let journal;
    try {
      journal = JSON.parse(await readFile6(join7(dir, "journal.json"), "utf-8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await rollback(targetDir, dir, journal);
    await rm(dir, { recursive: true, force: true });
  }
}
async function assertNoPendingTransactions(targetDir) {
  try {
    const ids = await readdir(join7(targetDir, TRANSACTIONS));
    if (ids.length) throw new Error("Existe uma transa\xE7\xE3o pendente; execute um comando sem --dry-run para recuper\xE1-la.");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
}
async function applyChangePlan(plan, options = {}) {
  if (hasConflicts(plan)) throw new Error("O plano cont\xE9m conflitos; nenhuma altera\xE7\xE3o foi feita.");
  await mkdir4(join7(plan.targetDir, ".maker"), { recursive: true });
  const lockPath = join7(plan.targetDir, LOCK);
  const lock = await acquireLock(lockPath);
  await lock.writeFile(String(process.pid));
  const actionable = plan.changes.filter(
    (change) => change.action === "create" || change.action === "update" || change.action === "remove"
  ).sort((a, b) => {
    const aMetadata = isMetadata(a.path) ? 1 : 0;
    const bMetadata = isMetadata(b.path) ? 1 : 0;
    return aMetadata - bMetadata || a.path.localeCompare(b.path);
  });
  const id = randomUUID();
  const transactionDir = join7(plan.targetDir, TRANSACTIONS, id);
  const journal = {
    id,
    operations: actionable.map((change) => ({
      path: change.path,
      action: change.action,
      originalKind: change.expectedKind,
      started: false
    }))
  };
  try {
    await recoverPendingTransactions(plan.targetDir);
    await mkdir4(join7(transactionDir, "backup"), { recursive: true });
    await mkdir4(join7(transactionDir, "stage"), { recursive: true });
    for (let i = 0; i < actionable.length; i++) {
      const change = actionable[i];
      const current = await inspectTarget(plan.targetDir, change.path);
      if (current.kind !== change.expectedKind || current.hash !== change.expectedHash) {
        throw new Error(`${change.path} mudou depois do planejamento; execute novamente.`);
      }
      if (current.kind !== "absent") {
        await cp(join7(plan.targetDir, change.path), join7(transactionDir, "backup", String(i)), {
          recursive: true,
          dereference: false
        });
      }
      if (change.action !== "remove") {
        await writeFile4(join7(transactionDir, "stage", String(i)), change.content);
      }
    }
    await writeJournal(transactionDir, journal);
    for (let i = 0; i < actionable.length; i++) {
      const change = actionable[i];
      journal.operations[i].started = true;
      await writeJournal(transactionDir, journal);
      const destination = join7(plan.targetDir, change.path);
      if (change.action === "remove") {
        await rm(destination, { recursive: true, force: true });
      } else {
        await mkdir4(dirname4(destination), { recursive: true });
        await rm(destination, { recursive: true, force: true });
        await rename(join7(transactionDir, "stage", String(i)), destination);
        if (change.mode !== void 0) await chmod(destination, change.mode & 511);
      }
      if (options.failAfter === i) throw new Error("Falha injetada durante a aplica\xE7\xE3o.");
    }
    await rm(transactionDir, { recursive: true, force: true });
  } catch (error) {
    await rollback(plan.targetDir, transactionDir, journal);
    await rm(transactionDir, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
async function acquireLock(lockPath) {
  try {
    return await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let active = true;
    try {
      const pid = Number(await readFile6(lockPath, "utf-8"));
      if (!Number.isInteger(pid) || pid <= 0) active = false;
      else process.kill(pid, 0);
    } catch (lockError) {
      if (lockError.code === "ESRCH") active = false;
      else if (lockError.code !== void 0) throw lockError;
    }
    if (active) throw new Error("Outra muta\xE7\xE3o do maker est\xE1 em andamento neste projeto.");
    await rm(lockPath, { force: true });
    return open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  }
}
function isMetadata(path) {
  return path === ".maker/manifest.json" || /^\.maker\/addons\/[^/]+\.json$/.test(path);
}
async function writeJournal(dir, journal) {
  const temporary = join7(dir, "journal.json.tmp");
  await writeFile4(temporary, JSON.stringify(journal, null, 2) + "\n", "utf-8");
  await rename(temporary, join7(dir, "journal.json"));
}
async function rollback(targetDir, transactionDir, journal) {
  for (let i = journal.operations.length - 1; i >= 0; i--) {
    const operation = journal.operations[i];
    if (!operation.started) continue;
    const destination = join7(targetDir, operation.path);
    const backup = join7(transactionDir, "backup", String(i));
    await rm(destination, { recursive: true, force: true });
    if (operation.originalKind !== "absent") {
      await mkdir4(dirname4(destination), { recursive: true });
      await cp(backup, destination, { recursive: true, dereference: false });
    }
  }
}

// src/commands/init.ts
async function runInit(opts) {
  const targetDir = resolve2(opts.target ?? process.cwd());
  if (opts.dryRun) await assertNoPendingTransactions(targetDir);
  const priorManifest = await readManifest(targetDir);
  const loadedConfig = await loadConfig({
    targetDir,
    configPath: opts.config,
    yes: opts.yes,
    name: opts.name,
    agent: opts.agent,
    fallback: priorManifest?.config
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
  const collisions = await findInitCollisions(targetDir, ctx, agents);
  if (collisions.length && !opts.force && !opts.dryRun) {
    throw new Error(
      `A instala\xE7\xE3o n\xE3o foi iniciada porque estes caminhos possuem conte\xFAdo diferente ou estrutura incompat\xEDvel:
${formatCollisions(collisions)}
Revise os arquivos ou execute novamente com --force para substitu\xED-los; nenhuma altera\xE7\xE3o foi feita.`
    );
  }
  if (collisions.length && opts.force && !opts.dryRun) {
    console.log(pc.yellow("\n\u26A0 --force substituir\xE1 estes caminhos:"));
    for (const collision of collisions) {
      console.log(pc.yellow(`  ${collision.path} (${collision.reason})`));
    }
  }
  const staging = await mkdtemp(join8(tmpdir(), "maker-init-plan-"));
  const changes = [];
  const renderedByPath = /* @__PURE__ */ new Map();
  let applied;
  try {
    applied = await applyEngine(staging, ctx, agents);
    const blocked = new Set(collisions.map((collision) => collision.path));
    if (!opts.force) {
      for (const collision of collisions) {
        const current = await inspectTarget(targetDir, collision.path);
        changes.push({
          path: collision.path,
          action: "conflict",
          source: "engine",
          reason: collision.reason,
          expectedHash: current.hash,
          expectedKind: current.kind
        });
      }
    }
    if (opts.force) {
      for (const collision of collisions.filter((item) => item.removeBeforeApply)) {
        if (applied.some((file) => file.rel === collision.path)) continue;
        const current = await inspectTarget(targetDir, collision.path);
        changes.push({
          path: collision.path,
          action: "remove",
          source: "engine",
          reason: collision.reason,
          expectedHash: current.hash,
          expectedKind: current.kind
        });
      }
    }
    for (const file of applied) {
      const blockedBy = [...blocked].find(
        (path) => file.rel === path || file.rel.startsWith(`${path}/`)
      );
      if (blockedBy && !opts.force) continue;
      const rendered = await readFile7(join8(staging, file.rel));
      renderedByPath.set(file.rel, rendered);
      changes.push(await planWrite({
        targetDir,
        path: file.rel,
        content: rendered,
        source: file.entry.source,
        reason: "conte\xFAdo renderizado pelo maker",
        force: !!opts.force
      }));
    }
  } finally {
    await rm2(staging, { recursive: true, force: true });
  }
  const manifest = {
    schemaVersion: 3,
    makerVersion: makerVersion(),
    project: { name: config.project.name, slug: config.project.slug },
    config,
    agents,
    installedAt: priorManifest?.installedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    files: Object.fromEntries(applied.map((a) => [a.rel, { ...a.entry, baseHash: a.entry.hash }]))
  };
  const bases = /* @__PURE__ */ new Map();
  for (const file of applied) bases.set(file.entry.hash, renderedByPath.get(file.rel));
  for (const [hash, content] of bases) {
    changes.push(await planWrite({
      targetDir,
      path: `.maker/bases/${hash}`,
      content,
      source: "metadata",
      reason: "base upstream inicial"
    }));
  }
  changes.push(await planWrite({
    targetDir,
    path: ".maker/manifest.json",
    content: JSON.stringify(manifest, null, 2) + "\n",
    source: "metadata",
    reason: "publicar manifest da instala\xE7\xE3o",
    force: true
  }));
  const plan = createPlan(targetDir, changes);
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    if (plan.changes.some((change) => change.action === "conflict")) process.exitCode = 1;
    return;
  }
  await applyChangePlan(plan);
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
async function findInitCollisions(targetDir, ctx, agents) {
  const staging = await mkdtemp(join8(tmpdir(), "maker-init-preflight-"));
  try {
    const expected = await applyEngine(staging, ctx, agents);
    const collisions = /* @__PURE__ */ new Map();
    for (const file of expected) {
      const parts = file.rel.split("/");
      let blockedByAncestor = false;
      for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join("/");
        const metadata2 = await lstatIfPresent(join8(targetDir, ancestor));
        if (metadata2 && !metadata2.isDirectory()) {
          collisions.set(ancestor, {
            path: ancestor,
            reason: "deveria ser um diret\xF3rio",
            removeBeforeApply: true
          });
          blockedByAncestor = true;
          break;
        }
      }
      if (blockedByAncestor) continue;
      const destination = join8(targetDir, file.rel);
      const metadata = await lstatIfPresent(destination);
      if (!metadata) continue;
      if (!metadata.isFile()) {
        collisions.set(file.rel, {
          path: file.rel,
          reason: "deveria ser um arquivo regular",
          removeBeforeApply: true
        });
        continue;
      }
      const [current, rendered] = await Promise.all([
        readFile7(destination),
        readFile7(join8(staging, file.rel))
      ]);
      if (!current.equals(rendered)) {
        collisions.set(file.rel, {
          path: file.rel,
          reason: "conte\xFAdo diferente",
          removeBeforeApply: false
        });
      }
    }
    return [...collisions.values()].sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    await rm2(staging, { recursive: true, force: true });
  }
}
async function lstatIfPresent(path) {
  try {
    return await lstat2(path);
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
function formatCollisions(collisions) {
  return collisions.map((collision) => `  - ${collision.path}: ${collision.reason}`).join("\n");
}

// src/commands/doctor.ts
import { resolve as resolve3 } from "path";
import pc2 from "picocolors";

// src/agents/validate.ts
import { existsSync as existsSync5 } from "fs";
import { readFile as readFile8 } from "fs/promises";
import { join as join9 } from "path";
import fg3 from "fast-glob";
import { parse as parseToml } from "smol-toml";
import { z as z2 } from "zod";
var codexAgentSchema = z2.object({
  name: z2.string().min(1),
  description: z2.string().min(1),
  developer_instructions: z2.string().min(1)
});
async function validateAgentIntegration(targetDir, provider) {
  const skillRoot = join9(targetDir, provider === "claude" ? ".claude/skills" : ".agents/skills");
  const agentRoot = join9(targetDir, provider === "claude" ? ".claude/agents" : ".codex/agents");
  const skillFiles = existsSync5(skillRoot) ? await fg3("**/SKILL.md", { cwd: skillRoot, onlyFiles: true }) : [];
  const agentFiles = existsSync5(agentRoot) ? await fg3(provider === "claude" ? "*.md" : "*.toml", { cwd: agentRoot, onlyFiles: true }) : [];
  const issues = [];
  const manifest = await readManifest(targetDir);
  const adapterRoot = relativeRoot(provider, "agents");
  for (const path of Object.keys(manifest?.files ?? {}).sort()) {
    if (path.startsWith(`${adapterRoot}/`) && !existsSync5(join9(targetDir, path))) {
      issues.push(`${path}: arquivo de adapter ausente; execute maker update --dry-run para revisar a restaura\xE7\xE3o`);
    }
  }
  if (!existsSync5(join9(targetDir, "AGENTS.md"))) issues.push("AGENTS.md ausente");
  if (skillFiles.length === 0) issues.push(`${relativeRoot(provider, "skills")} sem skills`);
  if (agentFiles.length === 0) issues.push(`${relativeRoot(provider, "agents")} sem agentes`);
  for (const rel of skillFiles) {
    const path = join9(skillRoot, rel);
    const content = await readFile8(path, "utf-8");
    if (!/^---\n[\s\S]*?^name:\s*.+$[\s\S]*?^description:\s*.+$[\s\S]*?^---$/m.test(content)) {
      issues.push(`${relativeRoot(provider, "skills")}/${rel}: frontmatter name/description inv\xE1lido`);
    }
    if (provider === "codex" && /\/(?:run-spec|run-brainstorm|speckit-[a-z0-9-]+)\b/.test(content)) {
      issues.push(`${relativeRoot(provider, "skills")}/${rel}: refer\xEAncia slash incompat\xEDvel com Codex`);
    }
  }
  for (const rel of agentFiles) {
    const path = join9(agentRoot, rel);
    const content = await readFile8(path, "utf-8");
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
    const adapterPath = `${adapterRoot}/${rel}`;
    if (!shared) {
      const expected = `.maker/workflow/agents/${rel.replace(/\.(md|toml)$/, "")}.md`;
      const source = manifest?.files[adapterPath]?.source;
      issues.push(`${adapterPath}: refer\xEAncia ao papel compartilhado ausente; esperado ${expected}` + (source ? `; origem ${source}` : "") + "; o update preserva conte\xFAdo local/add-on sem migra\xE7\xE3o segura. Execute maker update --dry-run para revisar o reparo; preserve as customiza\xE7\xF5es e n\xE3o reaplique o add-on apenas para corrigir o adapter");
    } else if (!existsSync5(join9(targetDir, shared))) {
      issues.push(`${adapterPath}: arquivo do papel compartilhado ausente: ${shared}; execute maker update --dry-run para revisar a restaura\xE7\xE3o`);
    }
  }
  if (provider === "claude" && !existsSync5(join9(targetDir, "CLAUDE.md"))) {
    issues.push("CLAUDE.md ausente");
  }
  return { provider, skills: skillFiles.length, agents: agentFiles.length, issues };
}
function relativeRoot(provider, kind) {
  if (provider === "claude") return kind === "skills" ? ".claude/skills" : ".claude/agents";
  return kind === "skills" ? ".agents/skills" : ".codex/agents";
}

// src/addons/doctor.ts
import { existsSync as existsSync8 } from "fs";
import { lstat as lstat3, readdir as readdir3, readFile as readFile11 } from "fs/promises";
import { basename as basename2, join as join12 } from "path";

// src/addons/loader.ts
import { readFile as readFile9, readdir as readdir2 } from "fs/promises";
import { existsSync as existsSync6 } from "fs";
import { join as join10 } from "path";

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
  return join10(packageRoot(), "addons", id);
}
async function loadAddon(id) {
  const dir = addonDir(id);
  const manifestPath = join10(dir, "addon.json");
  if (!existsSync6(manifestPath)) {
    throw new Error(`Add-on "${id}" n\xE3o encontrado (esperado em addons/${id}/addon.json).`);
  }
  const raw = JSON.parse(await readFile9(manifestPath, "utf-8"));
  const parsed = addonManifestSchema.parse(raw);
  if (parsed.id !== id) {
    throw new Error(`Add-on id divergente: pasta "${id}" vs manifest "${parsed.id}".`);
  }
  return parsed;
}
async function listAddonCatalog(root = join10(packageRoot(), "addons")) {
  if (!existsSync6(root)) return [];
  const dirs = (await readdir2(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return Promise.all(
    dirs.map(async (id) => {
      try {
        const raw = JSON.parse(await readFile9(join10(root, id, "addon.json"), "utf-8"));
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
import { readFile as readFile10, writeFile as writeFile5, mkdir as mkdir5, rm as rm3 } from "fs/promises";
import { existsSync as existsSync7 } from "fs";
import { dirname as dirname5, join as join11 } from "path";
import { z as z4 } from "zod";
var addonStateSchema = z4.object({
  id: z4.string(),
  version: z4.string(),
  appliedAt: z4.string(),
  knobs: z4.record(z4.string(), z4.string()),
  /** Arquivos novos criados pelo add-on (deletáveis na remoção). */
  createdFiles: z4.array(z4.object({ path: z4.string(), hash: z4.string() })),
  /** Arquivos do motor onde o add-on injetou um bloco (por marcador). */
  injectedTargets: z4.array(z4.string())
});
function addonStatePath(targetDir, id) {
  return join11(targetDir, ".maker", "addons", `${id}.json`);
}
function isAddonApplied(targetDir, id) {
  return existsSync7(addonStatePath(targetDir, id));
}
async function readAddonState(targetDir, id) {
  const p3 = addonStatePath(targetDir, id);
  if (!existsSync7(p3)) return null;
  return addonStateSchema.parse(JSON.parse(await readFile10(p3, "utf-8")));
}

// src/addons/doctor.ts
async function inspectAddons(targetDir, manifest) {
  const catalog = await listAddonCatalog();
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const ids = await appliedAddonIds(targetDir);
  const addons = await Promise.all(ids.map((id) => inspectAddon(targetDir, id, byId.get(id) ?? null, manifest)));
  return { addons, ok: addons.every((addon) => addon.ok) };
}
async function inspectAddon(targetDir, id, catalog, manifest) {
  const issues = [];
  const name = catalog?.manifest?.name ?? "manifest indispon\xEDvel";
  let state = null;
  let version = catalog?.manifest?.version;
  if (!catalog) {
    issues.push(issue(`add-on n\xE3o est\xE1 dispon\xEDvel no cat\xE1logo local`, `instale a vers\xE3o que originou o add-on ou remova-o com seguran\xE7a`));
  } else if (!catalog.manifest) {
    issues.push(issue(`manifest do cat\xE1logo inv\xE1lido: ${catalog.issue ?? "erro desconhecido"}`, `corrija o cat\xE1logo antes de reaplicar ou remover o add-on`));
  }
  try {
    state = await readAddonState(targetDir, id);
    if (!state) {
      issues.push(issue(`state ausente em ${addonStatePath(targetDir, id)}`, `reaplique o add-on ou restaure o state a partir do controle de vers\xE3o`));
    } else {
      if (state.id !== id) issues.push(issue(`state declara id "${state.id}"`, `corrija o state ou remova e reaplique o add-on correto`));
      version = state.version;
      if (catalog?.manifest && state.version !== catalog.manifest.version) {
        issues.push(issue(`state v${state.version} difere do cat\xE1logo v${catalog.manifest.version}`, `atualize o add-on ou remova e reaplique a vers\xE3o compat\xEDvel`));
      }
    }
  } catch (error) {
    issues.push(issue(`state inv\xE1lido: ${error instanceof Error ? error.message : String(error)}`, `restaure o state v\xE1lido ou remova o add-on ap\xF3s revisar seus arquivos`));
  }
  if (state) {
    for (const file of state.createdFiles) {
      await checkCreatedFile(targetDir, id, file.path, file.hash, manifest, issues);
    }
    for (const rel of state.injectedTargets) {
      await checkInjectedTarget(targetDir, id, rel, manifest, issues);
    }
  }
  return { id, name, version, ok: issues.length === 0, issues };
}
async function checkCreatedFile(targetDir, id, rel, expectedHash, manifest, issues) {
  const abs = join12(targetDir, rel);
  if (!existsSync8(abs)) {
    issues.push(issue(`arquivo criado ausente: ${rel}`, `reaplique o add-on ou restaure o arquivo antes de remov\xEA-lo`));
    return;
  }
  const currentHash = sha256(await readFile11(abs));
  if (currentHash !== expectedHash) {
    issues.push(issue(`arquivo criado modificado: ${rel}`, `revise a edi\xE7\xE3o local e reaplique ou remova o add-on conscientemente`));
  }
  const entry = manifest.files[rel];
  if (!entry) {
    issues.push(issue(`arquivo ${rel} n\xE3o possui entrada no manifest`, `reaplique o add-on para reconciliar o manifest`));
  } else if (entry.source !== `addon:${id}`) {
    issues.push(issue(`entrada do manifest para ${rel} aponta para ${entry.source}`, `reconcilie o manifest antes de reaplicar o add-on`));
  } else if (entry.hash !== expectedHash) {
    issues.push(issue(`hash do manifest diverge do state em ${rel}`, `reaplique o add-on para reconciliar os metadados`));
  }
}
async function checkInjectedTarget(targetDir, id, rel, manifest, issues) {
  const abs = join12(targetDir, rel);
  if (!existsSync8(abs)) {
    issues.push(issue(`alvo de inje\xE7\xE3o ausente: ${rel}`, `reaplique o add-on ou restaure o arquivo do motor`));
    return;
  }
  const content = await readFile11(abs, "utf-8");
  const start = startMarker(id);
  const end = endMarker(id);
  const starts = content.split(start).length - 1;
  const ends = content.split(end).length - 1;
  if (starts !== 1 || ends !== 1 || content.indexOf(start) > content.indexOf(end)) {
    issues.push(issue(`marcadores do add-on incompletos ou duplicados em ${rel}`, `reaplique ou remova o bloco manualmente antes de executar nova opera\xE7\xE3o`));
  }
  const entry = manifest.files[rel];
  if (!entry) {
    issues.push(issue(`alvo ${rel} n\xE3o possui entrada no manifest`, `reaplique o add-on para reconciliar o manifest`));
  } else if (entry.source !== `addon:${id}`) {
    issues.push(issue(`entrada do manifest para ${rel} aponta para ${entry.source}`, `reconcilie o manifest antes de reaplicar o add-on`));
  } else {
    const currentHash = sha256(await readFile11(abs));
    if (entry.hash !== currentHash) issues.push(issue(`alvo injetado modificado: ${rel}`, `revise a edi\xE7\xE3o local e reaplique ou remova o add-on conscientemente`));
  }
}
async function appliedAddonIds(targetDir) {
  const dir = join12(targetDir, ".maker", "addons");
  try {
    const metadata = await lstat3(dir);
    if (!metadata.isDirectory()) return [];
    return (await readdir3(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => basename2(entry.name, ".json")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [];
  }
}
function issue(message, action) {
  return { message, action };
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
  const addons = await inspectAddons(targetDir, manifest);
  console.log(pc2.dim(`Projeto "${manifest.project.name}" \xB7 maker ${manifest.makerVersion}`));
  console.log(pc2.dim(`${result.checked} arquivos verificados`));
  for (const integration of integrations) {
    const status2 = integration.issues.length ? pc2.red("degradada") : pc2.green("\xEDntegra");
    console.log(
      `  ${integration.provider}: ${status2} \xB7 ${integration.skills} skills \xB7 ${integration.agents} agentes`
    );
    for (const issue2 of integration.issues) console.log(pc2.red(`    ${issue2}`));
  }
  if (addons.addons.length) {
    console.log(pc2.bold("\nAdd-ons aplicados:"));
    for (const addon of addons.addons) {
      const status2 = addon.ok ? pc2.green("\xEDntegro") : pc2.red("degradado");
      console.log(`  ${addon.id} \xB7 ${addon.name} \xB7 v${addon.version ?? "?"} \xB7 ${status2}`);
      for (const problem of addon.issues) {
        console.log(pc2.red(`    problema: ${problem.message}`));
        console.log(pc2.yellow(`    a\xE7\xE3o: ${problem.action}`));
      }
    }
  }
  if (result.ok && integrations.every((integration) => integration.issues.length === 0) && addons.ok) {
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
import { existsSync as existsSync9 } from "fs";
import { mkdtemp as mkdtemp2, readFile as readFile13, readdir as readdir4, rm as rm4 } from "fs/promises";
import { tmpdir as tmpdir2 } from "os";
import { join as join14, resolve as resolve4 } from "path";
import pc3 from "picocolors";
import { mergeDiff3 } from "node-diff3";

// src/agents/migrate.ts
import { readFile as readFile12 } from "fs/promises";
import { join as join13 } from "path";
async function planLegacyAddonAgents(targetDir, staging, expected, manifest) {
  const changes = [];
  const handled = /* @__PURE__ */ new Set();
  const messages = [];
  const states = /* @__PURE__ */ new Map();
  const stateHashes = /* @__PURE__ */ new Map();
  const outputs = new Map(expected.map((file) => [file.rel, file]));
  for (const file of expected) {
    const role = file.rel.match(/^\.claude\/agents\/([a-z0-9-]+)\.md$/)?.[1];
    const entry = manifest.files[file.rel];
    if (!role || !entry?.source.startsWith("addon:")) continue;
    const current = await inspectTarget(targetDir, file.rel);
    if (current.kind !== "file") continue;
    const content = current.content.toString("utf-8");
    if (/\.maker\/workflow\/agents\/[a-z0-9-]+\.md/.test(content)) continue;
    const sharedPath = `.maker/workflow/agents/${role}.md`;
    const sharedFile = outputs.get(sharedPath);
    const id = entry.source.slice("addon:".length);
    let reason;
    const parsed = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]+)$/);
    const name = parsed?.[1]?.match(/^name:\s*["']?([a-z0-9-]+)["']?\s*$/m)?.[1];
    if (!current.content.equals(Buffer.from(content)) || content.includes("\0") || !parsed || name !== role || !/^description:\s*\S/m.test(parsed[1]) || !parsed[2].trim() || !sharedFile) {
      reason = "formato do agente legado n\xE3o reconhecido";
    }
    let state = states.get(id);
    if (!reason) {
      try {
        if (!/^[a-z0-9-]+$/.test(id)) throw new Error("id inv\xE1lido");
        if (!state) {
          const metadata = await inspectTarget(targetDir, `.maker/addons/${id}.json`);
          if (metadata.kind !== "file") throw new Error("state n\xE3o \xE9 arquivo regular");
          const raw = JSON.parse(metadata.content.toString("utf-8"));
          addonStateSchema.parse(raw);
          state = raw;
          stateHashes.set(id, metadata.hash);
        }
        if (!state || state.id !== id || !state.injectedTargets.includes(file.rel) || state.createdFiles.some((item) => item.path === file.rel)) {
          reason = "state do add-on n\xE3o confirma o alvo de inje\xE7\xE3o legado";
        }
      } catch {
        reason = "state do add-on ausente ou inv\xE1lido";
      }
    }
    const body = parsed?.[2] ?? "";
    const markers = [...body.matchAll(/<!-- maker:addon:([^\s:]+):(start|end) -->/g)];
    if (!reason && (markers.length !== 2 || markers[0]?.[1] !== id || markers[0]?.[2] !== "start" || markers[1]?.[1] !== id || markers[1]?.[2] !== "end" || !body.includes(startMarker(id)) || !body.includes(endMarker(id)))) {
      reason = "blocos de add-on incompletos, duplicados ou de m\xFAltiplas origens";
    }
    const shared = await inspectTarget(targetDir, sharedPath);
    const upstream = sharedFile ? await readFile12(join13(staging, sharedPath)) : void 0;
    const sharedEntry = manifest.files[sharedPath];
    if (!reason && shared.kind !== "absent" && !(shared.kind === "file" && sharedEntry && (sharedEntry.source === entry.source && shared.content.equals(Buffer.from(body)) || sharedEntry.source.startsWith("engine") && shared.content.equals(upstream)))) {
      reason = `papel compartilhado ${sharedPath} j\xE1 possui conte\xFAdo local ou n\xE3o gerenciado`;
    }
    if (reason) {
      messages.push(`${file.rel} [${entry.source}]: preservado; integra\xE7\xE3o continuar\xE1 degradada: ${reason}. Revise a migra\xE7\xE3o do corpo e dos blocos para ${sharedPath} e os injectedTargets do state; n\xE3o reaplique o add-on sobre conte\xFAdo personalizado.`);
      handled.add(file.rel);
      changes.push({
        path: file.rel,
        action: "preserve",
        source: entry.source,
        reason,
        expectedKind: current.kind,
        expectedHash: current.hash
      });
      continue;
    }
    const adapter = `${parsed[1].replace(/\r\n/g, "\n")}
Read \`${sharedPath}\` completely before acting and follow it as your role instructions.
`;
    changes.push({
      ...await planWrite({
        targetDir,
        path: sharedPath,
        content: body,
        source: entry.source,
        reason: "migrar corpo e blocos personalizados do agente legado",
        force: true
      }),
      expectedHash: shared.hash,
      expectedKind: shared.kind
    });
    changes.push({
      ...await planWrite({
        targetDir,
        path: file.rel,
        content: adapter,
        source: file.entry.source,
        reason: "converter agente legado em adapter do papel compartilhado",
        force: true
      }),
      expectedHash: current.hash,
      expectedKind: current.kind
    });
    const adapterUpstream = await readFile12(join13(staging, file.rel));
    for (const base2 of [upstream, adapterUpstream]) {
      changes.push(await planWrite({
        targetDir,
        path: `.maker/bases/${sha256(base2)}`,
        content: base2,
        source: "metadata",
        reason: "base upstream do agente migrado"
      }));
    }
    manifest.files[sharedPath] = { hash: sha256(body), source: entry.source, baseHash: sha256(upstream) };
    manifest.files[file.rel] = { hash: sha256(adapter), source: file.entry.source, baseHash: sha256(adapterUpstream) };
    state.injectedTargets = state.injectedTargets.map((path) => path === file.rel ? sharedPath : path).filter((path, index, paths) => path !== sharedPath || paths.indexOf(path) === index);
    states.set(id, state);
    handled.add(file.rel);
    handled.add(sharedPath);
    messages.push(`${file.rel} [${entry.source}]: migrar conte\xFAdo preservado para ${sharedPath} e regenerar adapter.`);
  }
  for (const [id, state] of states) {
    changes.push({
      ...await planWrite({
        targetDir,
        path: `.maker/addons/${id}.json`,
        content: JSON.stringify(state, null, 2) + "\n",
        source: "metadata",
        reason: "atualizar somente os alvos de inje\xE7\xE3o dos agentes migrados",
        force: true
      }),
      expectedHash: stateHashes.get(id),
      expectedKind: "file"
    });
  }
  return { changes, handled, messages };
}

// src/commands/update.ts
async function runUpdate(opts) {
  const targetDir = resolve4(opts.target ?? process.cwd());
  if (opts.dryRun) await assertNoPendingTransactions(targetDir);
  const prior = await readManifest(targetDir);
  if (!prior) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const { config, recovered } = await resolveConfig(targetDir, prior.config, prior.project);
  const agents = enabledAgents(prior);
  const staging = await mkdtemp2(join14(tmpdir2(), "maker-update-plan-"));
  const changes = [];
  const messages = [];
  const next = structuredClone(prior);
  next.files = { ...prior.files };
  try {
    const expected = await applyEngine(staging, buildContext(config), agents);
    const migration = await planLegacyAddonAgents(targetDir, staging, expected, next);
    changes.push(...migration.changes);
    messages.push(...migration.messages);
    for (const file of expected.sort((a, b) => a.rel.localeCompare(b.rel))) {
      if (migration.handled.has(file.rel)) continue;
      const upstream = await readFile13(join14(staging, file.rel));
      const upstreamHash = sha256(upstream);
      const current = await inspectTarget(targetDir, file.rel);
      const recorded = prior.files[file.rel];
      changes.push(await planWrite({ targetDir, path: `.maker/bases/${upstreamHash}`, content: upstream, source: "metadata", reason: `base upstream de ${file.rel}` }));
      if (recorded?.source.startsWith("addon:")) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "arquivo controlado por add-on"));
      } else if (current.kind === "other") {
        changes.push(status("conflict", file.rel, file.entry.source, current, "o caminho n\xE3o \xE9 um arquivo regular"));
      } else if (current.kind === "absent") {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "arquivo gerenciado ausente" }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (current.hash === upstreamHash) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "j\xE1 est\xE1 atualizado"));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (!recorded || current.hash === (recorded.baseHash ?? recorded.hash)) {
        changes.push(await planWrite({ targetDir, path: file.rel, content: upstream, source: file.entry.source, reason: "nova vers\xE3o upstream", force: true }));
        next.files[file.rel] = manifestEntry(file.entry, upstreamHash, upstreamHash);
      } else if (opts.merge === false) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "edi\xE7\xE3o local; merge desabilitado"));
      } else if (!recorded.baseHash) {
        changes.push(status("preserve", file.rel, file.entry.source, current, "edi\xE7\xE3o local em manifest legado sem base exata"));
      } else {
        const base2 = await readBase(targetDir, recorded.baseHash);
        const merged2 = base2 ? mergeText(current.content, base2, upstream) : null;
        if (!base2) {
          changes.push(status("preserve", file.rel, file.entry.source, current, "base hist\xF3rica ausente; preservado por seguran\xE7a"));
        } else if (!merged2) {
          changes.push(status("conflict", file.rel, file.entry.source, current, "mudan\xE7as locais e upstream na mesma regi\xE3o"));
        } else {
          const change = await planWrite({ targetDir, path: file.rel, content: merged2, source: file.entry.source, reason: "mudan\xE7as locais e upstream mescladas", force: true });
          change.resolution = "merge";
          changes.push(change);
          next.files[file.rel] = manifestEntry(file.entry, sha256(merged2), upstreamHash);
        }
      }
    }
  } finally {
    await rm4(staging, { recursive: true, force: true });
  }
  next.schemaVersion = 3;
  next.agents = agents;
  if (next.config || recovered) next.config = config;
  next.makerVersion = makerVersion();
  const referencedBases = new Set(Object.values(next.files).flatMap((item) => item.baseHash ? [item.baseHash] : []));
  for (const hash of await listBases(targetDir)) {
    if (referencedBases.has(hash)) continue;
    const path = `.maker/bases/${hash}`;
    const current = await inspectTarget(targetDir, path);
    changes.push({ path, action: "remove", source: "metadata", reason: "base upstream n\xE3o referenciada", expectedHash: current.hash, expectedKind: current.kind });
  }
  changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(next, null, 2) + "\n", source: "metadata", reason: "publicar manifest atualizado", force: true }));
  const plan = createPlan(targetDir, changes);
  for (const change of plan.changes) {
    if (change.action !== "preserve" || !/^\.(claude|codex)\/agents\//.test(change.path) || messages.some((message) => message.startsWith(`${change.path} [`))) continue;
    const current = await inspectTarget(targetDir, change.path);
    if (current.kind === "file" && !/\.maker\/workflow\/agents\/[a-z0-9-]+\.md/.test(current.content.toString("utf-8"))) {
      const role = change.path.split("/").at(-1).replace(/\.(md|toml)$/, "");
      messages.push(`${change.path}: preservado (${change.reason}); integra\xE7\xE3o continuar\xE1 degradada: refer\xEAncia ausente a .maker/workflow/agents/${role}.md. Revise o conte\xFAdo local antes de converter o adapter.`);
    }
  }
  for (const message of messages) console.log(pc3.yellow(message));
  if (opts.dryRun) {
    console.log(formatPlan(plan));
    if (plan.changes.some((change) => change.action === "conflict")) process.exitCode = 1;
    return;
  }
  await applyChangePlan(plan);
  const merged = plan.changes.filter((change) => change.resolution === "merge").length;
  const updated = plan.changes.filter((change) => (change.action === "update" || change.action === "create") && !change.path.startsWith(".maker/") && change.resolution !== "merge").length;
  const preserved = plan.changes.filter((change) => change.action === "preserve" && !change.path.startsWith(".maker/") && change.reason !== "j\xE1 est\xE1 atualizado").length;
  console.log(pc3.green(`\u2713 ${updated} arquivo(s) atualizado(s), ${merged} mesclado(s).`));
  if (preserved) console.log(pc3.yellow(`${preserved} preservado(s) por seguran\xE7a.`));
}
function manifestEntry(source, hash, baseHash) {
  return { ...source, hash, baseHash };
}
function status(action, path, source, current, reason) {
  return { path, action, source, reason, expectedHash: current.hash, expectedKind: current.kind };
}
async function readBase(targetDir, hash) {
  try {
    const content = await readFile13(join14(targetDir, ".maker", "bases", hash));
    return sha256(content) === hash ? content : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function listBases(targetDir) {
  try {
    return (await readdir4(join14(targetDir, ".maker", "bases"))).filter((name) => /^[a-f0-9]{64}$/.test(name)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function mergeText(local, base2, upstream) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let values;
  try {
    values = [decoder.decode(local), decoder.decode(base2), decoder.decode(upstream)];
  } catch {
    return null;
  }
  if (values.some((value) => value.includes("\0"))) return null;
  const split = (value) => value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const result = mergeDiff3(split(values[0]), split(values[1]), split(values[2]), {
    excludeFalseConflicts: true,
    label: { a: "local", o: "base", b: "upstream" }
  });
  return result.conflict ? null : Buffer.from(result.result.join(""), "utf-8");
}
async function resolveConfig(targetDir, stored, project) {
  if (stored) return { config: parseConfig(stored), recovered: true };
  const configPath = join14(targetDir, "maker.config.json");
  if (existsSync9(configPath)) return { config: parseConfig(JSON.parse(await readFile13(configPath, "utf-8"))), recovered: true };
  return { config: parseConfig({ project }), recovered: false };
}

// src/commands/add.ts
import { resolve as resolve5 } from "path";
import pc4 from "picocolors";
import * as p2 from "@clack/prompts";

// src/addons/apply.ts
import { readFile as readFile14 } from "fs/promises";
import { existsSync as existsSync10 } from "fs";
import { join as join15 } from "path";
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
  const raw = await readFile14(join15(dir, rel), "utf-8");
  return rel.endsWith(".hbs") ? renderRaw(raw, ctx) : raw;
}
async function applyAddon(targetDir, addon, knobs, options = {}) {
  if (options.dryRun) await assertNoPendingTransactions(targetDir);
  const currentManifest = await readManifest(targetDir);
  if (!currentManifest) {
    throw new Error(`Nenhum install do maker em ${targetDir} \u2014 rode 'maker init' antes de add-ons.`);
  }
  const manifest = structuredClone(currentManifest);
  const dir = addonDir(addon.id);
  const ctx = addonContext(manifest, knobs);
  const injectedTargets = [];
  const createdFiles = [];
  const changes = [];
  const prior = await readAddonState(targetDir, addon.id);
  const owned = new Set((prior?.createdFiles ?? []).map((f) => f.path));
  if (addon.principles.length) {
    const absConst = join15(targetDir, CONSTITUTION);
    if (!existsSync10(absConst)) throw new Error(`${CONSTITUTION} ausente no install.`);
    const rendered = [];
    for (const p3 of addon.principles) rendered.push((await renderFrom(dir, p3, ctx)).trim());
    const block = rendered.join("\n\n");
    const current = await readFile14(absConst, "utf-8");
    const next = upsertBlock(current, addon.id, block, {
      replacePlaceholder: PLACEHOLDER,
      beforeHeading: "## Governance"
    });
    changes.push(await planWrite({ targetDir, path: CONSTITUTION, content: next, source: `addon:${addon.id}`, reason: "injetar princ\xEDpios do add-on", force: true }));
    manifest.files[CONSTITUTION] = { hash: sha256(next), source: `addon:${addon.id}` };
    injectedTargets.push(CONSTITUTION);
  }
  for (const frag of addon.agentFragments) {
    const rel = `.maker/workflow/agents/${frag.agent}.md`;
    const abs = join15(targetDir, rel);
    if (!existsSync10(abs)) {
      console.warn(`  aviso: agente ${frag.agent} ausente \u2014 fragmento pulado.`);
      continue;
    }
    const block = (await renderFrom(dir, frag.file, ctx)).trim();
    const next = upsertBlock(await readFile14(abs, "utf-8"), addon.id, block);
    changes.push(await planWrite({ targetDir, path: rel, content: next, source: `addon:${addon.id}`, reason: "injetar fragmento do add-on", force: true }));
    manifest.files[rel] = { hash: sha256(next), source: `addon:${addon.id}` };
    injectedTargets.push(rel);
  }
  for (const f of addon.files) {
    const abs = join15(targetDir, f.to);
    if (existsSync10(abs) && !owned.has(f.to)) {
      console.warn(`  aviso: ${f.to} j\xE1 existe (n\xE3o \xE9 deste add-on) \u2014 n\xE3o sobrescrito.`);
      continue;
    }
    const content = await renderFrom(dir, f.from, ctx);
    const hash = sha256(Buffer.from(content, "utf-8"));
    manifest.files[manifestKey(targetDir, abs)] = { hash, source: `addon:${addon.id}` };
    createdFiles.push({ path: f.to, hash });
    changes.push(await planWrite({ targetDir, path: f.to, content, source: `addon:${addon.id}`, reason: "arquivo criado pelo add-on", force: owned.has(f.to) }));
  }
  const state = {
    id: addon.id,
    version: addon.version,
    appliedAt: (/* @__PURE__ */ new Date()).toISOString(),
    knobs,
    createdFiles,
    injectedTargets
  };
  changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(manifest, null, 2) + "\n", source: "metadata", reason: "publicar manifest do add-on", force: true }));
  const stateRel = manifestKey(targetDir, addonStatePath(targetDir, addon.id));
  changes.push(await planWrite({ targetDir, path: stateRel, content: JSON.stringify(state, null, 2) + "\n", source: "metadata", reason: "publicar state do add-on", force: true }));
  const plan = createPlan(targetDir, changes);
  if (options.dryRun) console.log(formatPlan(plan));
  else await applyChangePlan(plan);
  return { injectedTargets, createdFiles: createdFiles.map((c) => c.path), plan };
}
async function removeAddon(targetDir, id, options = {}) {
  if (options.dryRun) await assertNoPendingTransactions(targetDir);
  const state = await readAddonState(targetDir, id);
  if (!state) throw new Error(`Add-on "${id}" n\xE3o est\xE1 aplicado em ${targetDir}.`);
  const manifest = await readManifest(targetDir);
  const strippedTargets = [];
  const deletedFiles = [];
  const keptFiles = [];
  const changes = [];
  for (const rel of state.injectedTargets) {
    const abs = join15(targetDir, rel);
    if (!existsSync10(abs)) continue;
    const next = stripBlock(await readFile14(abs, "utf-8"), id);
    changes.push(await planWrite({ targetDir, path: rel, content: next, source: "engine", reason: "remover bloco do add-on", force: true }));
    if (manifest) manifest.files[rel] = { hash: sha256(next), source: "engine" };
    strippedTargets.push(rel);
  }
  for (const f of state.createdFiles) {
    const abs = join15(targetDir, f.path);
    if (!existsSync10(abs)) continue;
    const current = sha256(await readFile14(abs));
    if (current === f.hash) {
      if (manifest) delete manifest.files[manifestKey(targetDir, abs)];
      deletedFiles.push(f.path);
      const inspected = await inspectTarget(targetDir, f.path);
      changes.push({ path: f.path, action: "remove", source: `addon:${id}`, reason: "arquivo intacto criado pelo add-on", expectedHash: inspected.hash, expectedKind: inspected.kind });
    } else {
      keptFiles.push(f.path);
    }
  }
  if (manifest) changes.push(await planWrite({ targetDir, path: ".maker/manifest.json", content: JSON.stringify(manifest, null, 2) + "\n", source: "metadata", reason: "publicar manifest sem o add-on", force: true }));
  const stateRel = manifestKey(targetDir, addonStatePath(targetDir, id));
  const stateTarget = await inspectTarget(targetDir, stateRel);
  changes.push({ path: stateRel, action: "remove", source: "metadata", reason: "remover state do add-on", expectedHash: stateTarget.hash, expectedKind: stateTarget.kind });
  const plan = createPlan(targetDir, changes);
  if (options.dryRun) console.log(formatPlan(plan));
  else await applyChangePlan(plan);
  return { strippedTargets, deletedFiles, keptFiles, plan };
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
  const res = await applyAddon(targetDir, addon, knobs, { dryRun: opts.dryRun });
  if (opts.dryRun) return;
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
  const res = await removeAddon(targetDir, id, { dryRun: opts.dryRun });
  if (opts.dryRun) return;
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
import { readdir as readdir5, readFile as readFile15 } from "fs/promises";
import { basename as basename3, join as join17 } from "path";

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
import { appendFile, mkdir as mkdir6 } from "fs/promises";
import { dirname as dirname6, join as join16 } from "path";
var RUNS_DIR = ".maker/runs";

// src/runs/read.ts
async function listRunFiles(target) {
  const dir = join17(target, RUNS_DIR);
  let entries;
  try {
    entries = await readdir5(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => ({ runId: basename3(e.name, ".jsonl"), path: join17(dir, e.name) })).sort((a, b) => a.runId.localeCompare(b.runId));
}
async function readRun(path) {
  const raw = await readFile15(path, "utf-8");
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
import { lstat as lstat4, readdir as readdir6 } from "fs/promises";
import { basename as basename4, join as join18, resolve as resolve8 } from "path";
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
  const dir = join18(targetDir, ".maker", "addons");
  let metadata;
  try {
    metadata = await lstat4(dir);
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
    const ids = (await readdir6(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => basename4(entry.name, ".json")).sort();
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
import { readFile as readFile16 } from "fs/promises";
import { join as join19, resolve as resolve9 } from "path";
import { mkdtemp as mkdtemp3, rm as rm5 } from "fs/promises";
import { tmpdir as tmpdir3 } from "os";
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
  manifest.schemaVersion = 3;
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
    const status2 = validation.issues.length ? pc8.red("degradada") : pc8.green("\xEDntegra");
    console.log(`  ${provider}: ${status2} \xB7 ${validation.skills} skills \xB7 ${validation.agents} agentes`);
    for (const issue2 of validation.issues) console.log(pc8.red(`    ${issue2}`));
  }
}
async function resolveRenderConfig(targetDir, stored, explicitPath) {
  if (stored) return parseConfig(stored);
  const path = explicitPath ? resolve9(explicitPath) : join19(targetDir, "maker.config.json");
  if (!existsSync12(path)) {
    throw new Error(
      "Este install usa um manifest legado sem a configura\xE7\xE3o de renderiza\xE7\xE3o. Forne\xE7a --config <maker.config.json> para adicionar outra integra\xE7\xE3o com seguran\xE7a."
    );
  }
  return parseConfig(JSON.parse(await readFile16(path, "utf-8")));
}
async function assertNoUnmanagedProviderFiles(targetDir, provider, managed, ctx) {
  const staging = await mkdtemp3(join19(tmpdir3(), "maker-agent-preflight-"));
  let expected;
  try {
    expected = (await applyAgentProvider(staging, ctx, provider)).map((file) => file.rel);
  } finally {
    await rm5(staging, { recursive: true, force: true });
  }
  const collisions = expected.filter(
    (rel) => existsSync12(join19(targetDir, rel)) && !(rel in managed)
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
program.command("init").description("Instala o motor no projeto-alvo.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-c, --config <file>", "caminho para maker.config.json").option("-n, --name <name>", "nome do projeto (modo --yes sem config)").option("-a, --agent <agent>", "CLI ag\xEAntica inicial: claude | codex").option("-y, --yes", "n\xE3o interativo; usa config/defaults").option("-f, --force", "substitui explicitamente arquivos gerados que tenham conte\xFAdo diferente").option("--dry-run", "mostra o plano sem alterar arquivos").action(async (opts) => {
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
program.command("update").description("Atualiza arquivos do motor n\xE3o modificados localmente.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("--dry-run", "mostra o plano sem alterar arquivos").option("--no-merge", "preserva arquivos editados sem tentar 3-way merge").action(async (opts) => {
  await runUpdate(opts);
});
program.command("list").description("Lista add-ons dispon\xEDveis e seu estado no projeto.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runList(opts);
});
program.command("add").argument("<addon>", "id do add-on (ex.: saas)").description("Aplica um add-on sobre um install existente (injeta princ\xEDpios/agentes/arquivos).").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-s, --set <pair...>", "knob do add-on como nome=valor (repet\xEDvel)").option("-y, --yes", "n\xE3o interativo; usa defaults dos knobs").option("--dry-run", "mostra o plano sem alterar arquivos").action(async (addon, opts) => {
  await runAdd(addon, opts);
});
program.command("remove").argument("<addon>", "id do add-on (ex.: saas)").description("Remove um add-on aplicado, revertendo inje\xE7\xF5es e arquivos criados.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("--dry-run", "mostra o plano sem alterar arquivos").action(async (addon, opts) => {
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