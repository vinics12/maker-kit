#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";
import pc6 from "picocolors";

// src/commands/init.ts
import { resolve as resolve2, join as join5 } from "path";
import { existsSync as existsSync4 } from "fs";
import pc from "picocolors";

// src/config/load.ts
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// src/config/schema.ts
import { z } from "zod";
var configSchema = z.object({
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
    return parseConfig(JSON.parse(await readFile(opts.configPath, "utf-8")));
  }
  const inTarget = join(opts.targetDir, CONFIG_FILE);
  if (existsSync(inTarget)) {
    return parseConfig(JSON.parse(await readFile(inTarget, "utf-8")));
  }
  if (opts.yes) {
    if (!opts.name) {
      throw new Error(
        `Sem ${CONFIG_FILE} e sem --name: em modo --yes forne\xE7a --config <arquivo> ou --name <nome>.`
      );
    }
    return parseConfig({ project: { name: opts.name } });
  }
  return promptConfig();
}

// src/render/engine.ts
import Handlebars from "handlebars";
function buildContext(config) {
  return {
    project: { ...config.project, slug: config.project.slug },
    layout: config.layout,
    commands: config.commands,
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
import { readFileSync } from "fs";
import { join as join4 } from "path";
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

// src/commands/init.ts
async function runInit(opts) {
  const targetDir = resolve2(opts.target ?? process.cwd());
  if (existsSync4(join5(targetDir, ".specify")) && !opts.force) {
    throw new Error(
      `${targetDir} j\xE1 cont\xE9m .specify/ \u2014 use --force para reinstalar por cima.`
    );
  }
  const config = await loadConfig({
    targetDir,
    configPath: opts.config,
    yes: opts.yes,
    name: opts.name
  });
  const ctx = buildContext(config);
  const applied = await applyTree(templatesDir("engine"), targetDir, ctx, "engine");
  const manifest = {
    makerVersion: makerVersion(),
    project: { name: config.project.name, slug: config.project.slug },
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
  console.log(`  3. Abra o Claude Code e rode ${pc.cyan("/run-brainstorm")} ou ${pc.cyan("/run-spec")}`);
}

// src/commands/doctor.ts
import { resolve as resolve3 } from "path";
import pc2 from "picocolors";
async function runDoctor(opts) {
  const targetDir = resolve3(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new Error(`Nenhum install do maker encontrado em ${targetDir} (.maker/manifest.json ausente).`);
  }
  const result = await verifyManifest(targetDir, manifest);
  console.log(pc2.dim(`Projeto "${manifest.project.name}" \xB7 maker ${manifest.makerVersion}`));
  console.log(pc2.dim(`${result.checked} arquivos verificados`));
  if (result.ok) {
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
import { resolve as resolve4, join as join6 } from "path";
import { existsSync as existsSync5 } from "fs";
import { readFile as readFile4, writeFile as writeFile3, copyFile as copyFile2, mkdir as mkdir3 } from "fs/promises";
import { dirname as dirname3 } from "path";
import pc3 from "picocolors";
import fg2 from "fast-glob";
async function runUpdate(opts) {
  const targetDir = resolve4(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);
  const ctx = buildContext(
    parseConfig({ project: { name: manifest.project.name, slug: manifest.project.slug } })
  );
  const srcTree = templatesDir("engine");
  const files = await fg2("**/*", { cwd: srcTree, dot: true, onlyFiles: true });
  const updated = [];
  const skipped = [];
  for (const relSrc of files) {
    const absSrc = join6(srcTree, relSrc);
    const isTemplate = relSrc.endsWith(".hbs");
    const relOut = isTemplate ? relSrc.slice(0, -4) : relSrc;
    const absOut = join6(targetDir, relOut);
    const key = manifestKey(targetDir, absOut);
    const newContent = isTemplate ? Buffer.from(render(await readFile4(absSrc, "utf-8"), ctx), "utf-8") : await readFile4(absSrc);
    const newHash = sha256(newContent);
    if (existsSync5(absOut)) {
      const currentHash = sha256(await readFile4(absOut));
      const recorded = manifest.files[key]?.hash;
      if (currentHash !== recorded) {
        skipped.push(key);
        continue;
      }
      if (currentHash === newHash) continue;
    }
    await mkdir3(dirname3(absOut), { recursive: true });
    if (isTemplate) await writeFile3(absOut, newContent);
    else await copyFile2(absSrc, absOut);
    manifest.files[key] = { hash: newHash, source: "engine" };
    updated.push(key);
  }
  manifest.makerVersion = makerVersion();
  await writeManifest(targetDir, manifest);
  console.log(pc3.green(`\u2713 ${updated.length} arquivo(s) atualizado(s).`));
  if (skipped.length) {
    console.log(pc3.yellow(`${skipped.length} preservado(s) por edi\xE7\xE3o local:`));
    for (const s of skipped) console.log(pc3.dim(`  ${s}`));
  }
}

// src/commands/add.ts
import { resolve as resolve5 } from "path";
import pc4 from "picocolors";
import * as p2 from "@clack/prompts";

// src/addons/loader.ts
import { readFile as readFile5 } from "fs/promises";
import { existsSync as existsSync6 } from "fs";
import { join as join7 } from "path";

// src/addons/schema.ts
import { z as z2 } from "zod";
var addonKnobSchema = z2.object({
  name: z2.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "knob.name deve ser identificador simples"),
  prompt: z2.string(),
  default: z2.string().default("")
});
var agentFragmentSchema = z2.object({
  agent: z2.string(),
  // nome do agente-alvo (sem .md), ex.: "code-reviewer"
  file: z2.string()
  // path relativo ao dir do add-on, ex.: "agents/code-reviewer.fragment.md.hbs"
});
var addonFileSchema = z2.object({
  from: z2.string(),
  // path relativo ao dir do add-on
  to: z2.string()
  // path relativo ao target, ex.: ".specify/memory/saas-reference.md"
});
var addonManifestSchema = z2.object({
  id: z2.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id deve ser kebab-case"),
  name: z2.string(),
  description: z2.string().default(""),
  version: z2.string().default("0.1.0"),
  knobs: z2.array(addonKnobSchema).default([]),
  /** .hbs injetados na seção "Princípios do Projeto" da constitution. */
  principles: z2.array(z2.string()).default([]),
  /** fragmentos anexados a agentes específicos. */
  agentFragments: z2.array(agentFragmentSchema).default([]),
  /** arquivos novos escritos no target (renderizados se .hbs). */
  files: z2.array(addonFileSchema).default([])
});

// src/addons/loader.ts
function addonDir(id) {
  return join7(packageRoot(), "addons", id);
}
async function loadAddon(id) {
  const dir = addonDir(id);
  const manifestPath = join7(dir, "addon.json");
  if (!existsSync6(manifestPath)) {
    throw new Error(`Add-on "${id}" n\xE3o encontrado (esperado em addons/${id}/addon.json).`);
  }
  const raw = JSON.parse(await readFile5(manifestPath, "utf-8"));
  const parsed = addonManifestSchema.parse(raw);
  if (parsed.id !== id) {
    throw new Error(`Add-on id divergente: pasta "${id}" vs manifest "${parsed.id}".`);
  }
  return parsed;
}

// src/addons/apply.ts
import { readFile as readFile7, writeFile as writeFile5, mkdir as mkdir5 } from "fs/promises";
import { existsSync as existsSync8 } from "fs";
import { dirname as dirname5, join as join9 } from "path";
import { rm as rm2 } from "fs/promises";

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
import { readFile as readFile6, writeFile as writeFile4, mkdir as mkdir4, rm } from "fs/promises";
import { existsSync as existsSync7 } from "fs";
import { dirname as dirname4, join as join8 } from "path";
function addonStatePath(targetDir, id) {
  return join8(targetDir, ".maker", "addons", `${id}.json`);
}
function isAddonApplied(targetDir, id) {
  return existsSync7(addonStatePath(targetDir, id));
}
async function readAddonState(targetDir, id) {
  const p3 = addonStatePath(targetDir, id);
  if (!existsSync7(p3)) return null;
  return JSON.parse(await readFile6(p3, "utf-8"));
}
async function writeAddonState(targetDir, state) {
  const p3 = addonStatePath(targetDir, state.id);
  await mkdir4(dirname4(p3), { recursive: true });
  await writeFile4(p3, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
async function deleteAddonState(targetDir, id) {
  const p3 = addonStatePath(targetDir, id);
  if (existsSync7(p3)) await rm(p3);
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
  const raw = await readFile7(join9(dir, rel), "utf-8");
  return rel.endsWith(".hbs") ? renderRaw(raw, ctx) : raw;
}
async function touchManifest(manifest, targetDir, absPath, source) {
  const hash = sha256(await readFile7(absPath));
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
    const absConst = join9(targetDir, CONSTITUTION);
    if (!existsSync8(absConst)) throw new Error(`${CONSTITUTION} ausente no install.`);
    const rendered = [];
    for (const p3 of addon.principles) rendered.push((await renderFrom(dir, p3, ctx)).trim());
    const block = rendered.join("\n\n");
    const current = await readFile7(absConst, "utf-8");
    const next = upsertBlock(current, addon.id, block, {
      replacePlaceholder: PLACEHOLDER,
      beforeHeading: "## Governance"
    });
    await writeFile5(absConst, next, "utf-8");
    await touchManifest(manifest, targetDir, absConst, `addon:${addon.id}`);
    injectedTargets.push(CONSTITUTION);
  }
  for (const frag of addon.agentFragments) {
    const rel = `.claude/agents/${frag.agent}.md`;
    const abs = join9(targetDir, rel);
    if (!existsSync8(abs)) {
      console.warn(`  aviso: agente ${frag.agent} ausente \u2014 fragmento pulado.`);
      continue;
    }
    const block = (await renderFrom(dir, frag.file, ctx)).trim();
    const next = upsertBlock(await readFile7(abs, "utf-8"), addon.id, block);
    await writeFile5(abs, next, "utf-8");
    await touchManifest(manifest, targetDir, abs, `addon:${addon.id}`);
    injectedTargets.push(rel);
  }
  for (const f of addon.files) {
    const abs = join9(targetDir, f.to);
    if (existsSync8(abs) && !owned.has(f.to)) {
      console.warn(`  aviso: ${f.to} j\xE1 existe (n\xE3o \xE9 deste add-on) \u2014 n\xE3o sobrescrito.`);
      continue;
    }
    const content = await renderFrom(dir, f.from, ctx);
    await mkdir5(dirname5(abs), { recursive: true });
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
    const abs = join9(targetDir, rel);
    if (!existsSync8(abs)) continue;
    const next = stripBlock(await readFile7(abs, "utf-8"), id);
    await writeFile5(abs, next, "utf-8");
    if (manifest) await touchManifest(manifest, targetDir, abs, "engine");
    strippedTargets.push(rel);
  }
  for (const f of state.createdFiles) {
    const abs = join9(targetDir, f.path);
    if (!existsSync8(abs)) continue;
    const current = sha256(await readFile7(abs));
    if (current === f.hash) {
      await rm2(abs);
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

// src/cli.ts
var program = new Command();
program.name("maker").description("Encapsulador do workflow de cria\xE7\xE3o de produtos (motor SpecKit + multi-agente).").version(makerVersion());
program.command("init").description("Instala o motor no projeto-alvo.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-c, --config <file>", "caminho para maker.config.json").option("-n, --name <name>", "nome do projeto (modo --yes sem config)").option("-y, --yes", "n\xE3o interativo; usa config/defaults").option("-f, --force", "reinstala por cima de um .specify/ existente").action(async (opts) => {
  await runInit(opts);
});
program.command("doctor").description("Verifica a integridade de um install contra o manifest.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runDoctor(opts);
});
program.command("update").description("Atualiza arquivos do motor n\xE3o modificados localmente.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (opts) => {
  await runUpdate(opts);
});
program.command("add").argument("<addon>", "id do add-on (ex.: saas)").description("Aplica um add-on sobre um install existente (injeta princ\xEDpios/agentes/arquivos).").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").option("-s, --set <pair...>", "knob do add-on como nome=valor (repet\xEDvel)").option("-y, --yes", "n\xE3o interativo; usa defaults dos knobs").action(async (addon, opts) => {
  await runAdd(addon, opts);
});
program.command("remove").argument("<addon>", "id do add-on (ex.: saas)").description("Remove um add-on aplicado, revertendo inje\xE7\xF5es e arquivos criados.").option("-t, --target <dir>", "diret\xF3rio do projeto (default: cwd)").action(async (addon, opts) => {
  await runRemove(addon, opts);
});
program.parseAsync(process.argv).catch((err) => {
  console.error(pc6.red(`
erro: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
//# sourceMappingURL=cli.js.map