#!/usr/bin/env node
/**
 * Authoring helper (re-runnable): copia a camada custom generica de um PROJETO DE
 * ORIGEM (um repo que ja tenha .claude/skills + .claude/agents no padrao) para
 * templates/engine, sanitizando os pontos de acoplamento MECANICOS (nome do repo,
 * comandos). NAO tenta remover regra de negocio — isso e feito a mao nos poucos
 * agentes business-bound. Apos rodar, use `npm run audit:coupling`.
 *
 * Uso:
 *   node scripts/extract-templates.mjs --from <path> [--name "<Nome>"] [--slug <slug>]
 *
 *   --from   caminho do projeto de origem (obrigatorio)
 *   --name   nome do produto de origem a substituir por {{project.name}} (opcional)
 *   --slug   slug de origem a substituir por {{project.slug}} (opcional)
 */
import { readFile, writeFile, mkdir, cp, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(ROOT, "templates", "engine");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const FROM = arg("--from");
const SRC_NAME = arg("--name");
const SRC_SLUG = arg("--slug");

if (!FROM) {
  console.error("uso: node scripts/extract-templates.mjs --from <path> [--name <Nome>] [--slug <slug>]");
  process.exit(1);
}
const SRC = resolve(FROM);
if (!existsSync(SRC)) {
  console.error(`projeto de origem nao encontrado em ${SRC}`);
  process.exit(1);
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Substituicoes mecanicas: identidade da origem (se informada) + comandos. */
const SUBS = [];
if (SRC_NAME) SUBS.push([new RegExp(esc(SRC_NAME), "g"), "{{project.name}}"]);
if (SRC_SLUG) SUBS.push([new RegExp(esc(SRC_SLUG), "g"), "{{project.slug}}"]);
SUBS.push(
  [/pnpm verify/g, "{{commands.verify}}"],
  [/pnpm build/g, "{{commands.build}}"],
  [/pnpm test\b/g, "{{commands.test}}"],
  [/make dev\b/g, "{{commands.dev}}"],
);

function sanitize(text) {
  let out = text;
  for (const [re, rep] of SUBS) out = out.replace(re, rep);
  return out;
}

const GENERIC_AGENTS = [
  "spec-author", "spec-reviewer", "plan-reviewer", "architect", "pm-validator",
  "ux-designer", "e2e-planner", "e2e-runner", "feature-cataloguer", "visual-reviewer",
];
const GENERIC_SKILLS = ["run-brainstorm", "brainstorming"];

async function copySkillSanitized(name) {
  const srcDir = join(SRC, ".claude", "skills", name);
  if (!existsSync(srcDir)) return void console.warn(`  skip skill ${name} (ausente)`);
  const dstDir = join(ENGINE, ".claude", "skills", name);
  await cp(srcDir, dstDir, { recursive: true });
  const walk = async (d) => {
    for (const e of await readdir(d)) {
      const p = join(d, e);
      if ((await stat(p)).isDirectory()) await walk(p);
      else if (p.endsWith(".md")) {
        await writeFile(p + ".hbs", sanitize(await readFile(p, "utf-8")), "utf-8");
        await rm(p);
      }
    }
  };
  await walk(dstDir);
  console.log(`  skill ${name} → sanitizado`);
}

async function copyAgentSanitized(name) {
  const src = join(SRC, ".claude", "agents", `${name}.md`);
  if (!existsSync(src)) return void console.warn(`  skip agent ${name} (ausente)`);
  const dst = join(ENGINE, ".claude", "agents", `${name}.md.hbs`);
  await mkdir(dirname(dst), { recursive: true });
  await writeFile(dst, sanitize(await readFile(src, "utf-8")), "utf-8");
  console.log(`  agent ${name} → sanitizado`);
}

console.log(`Extraindo camada custom generica de ${SRC} →`, ENGINE);
for (const s of GENERIC_SKILLS) await copySkillSanitized(s);
for (const a of GENERIC_AGENTS) await copyAgentSanitized(a);
console.log("OK. Rode `npm run audit:coupling` para ver o residual de negocio.");
