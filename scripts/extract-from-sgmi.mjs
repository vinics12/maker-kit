#!/usr/bin/env node
/**
 * Authoring helper (re-runnable): copia a camada custom generica do sgmi-platform
 * para templates/engine, sanitizando os pontos de acoplamento MECANICOS (nome do
 * repo, comandos). NAO tenta remover regra de negocio — isso e feito a mao nos
 * poucos agentes business-bound (dev, code-reviewer). Apos rodar, use
 * `npm run audit:coupling` para ver o que ainda vazou.
 *
 * Uso: node scripts/extract-from-sgmi.mjs [caminho-do-sgmi]
 */
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SG = resolve(process.argv[2] ?? join(ROOT, "..", "sgmi-platform"));
const ENGINE = join(ROOT, "templates", "engine");

if (!existsSync(SG)) {
  console.error(`sgmi-platform nao encontrado em ${SG}`);
  process.exit(1);
}

/** Substituicoes mecanicas (ordem importa: mais especifico primeiro). */
const SUBS = [
  [/sgmi-platform/g, "{{project.slug}}"],
  [/SGMI Platform/g, "{{project.name}}"],
  [/\bSGMI\b/g, "{{project.name}}"],
  [/\bsgmi\b/g, "{{project.slug}}"],
  [/\bmanuon\.app\b/g, "{{project.slug}}"],
  [/\bmanuon\b/g, "{{project.slug}}"],
  [/pnpm verify/g, "{{commands.verify}}"],
  [/pnpm build/g, "{{commands.build}}"],
  [/pnpm test\b/g, "{{commands.test}}"],
  [/make dev\b/g, "{{commands.dev}}"],
];

function sanitize(text) {
  let out = text;
  for (const [re, rep] of SUBS) out = out.replace(re, rep);
  return out;
}

/** Agentes genericos: copiados com sanitizacao como .hbs. */
const GENERIC_AGENTS = [
  "spec-author",
  "spec-reviewer",
  "plan-reviewer",
  "architect",
  "pm-validator",
  "ux-designer",
  "e2e-planner",
  "e2e-runner",
  "feature-cataloguer",
  "visual-reviewer",
];

/** Skills genericas copiadas com sanitizacao. */
const GENERIC_SKILLS = ["run-brainstorm", "brainstorming"];

async function copySkillSanitized(name) {
  const srcDir = join(SG, ".claude", "skills", name);
  if (!existsSync(srcDir)) {
    console.warn(`  skip skill ${name} (ausente)`);
    return;
  }
  // copia a arvore inteira, depois sanitiza os .md → .md.hbs
  const dstDir = join(ENGINE, ".claude", "skills", name);
  await cp(srcDir, dstDir, { recursive: true });
  // renomeia SKILL.md → SKILL.md.hbs sanitizado (e remove o original)
  const { readdir, rm, stat } = await import("node:fs/promises");
  const walk = async (d) => {
    for (const e of await readdir(d)) {
      const p = join(d, e);
      if ((await stat(p)).isDirectory()) await walk(p);
      else if (p.endsWith(".md")) {
        const content = sanitize(await readFile(p, "utf-8"));
        await writeFile(p + ".hbs", content, "utf-8");
        await rm(p);
      }
    }
  };
  await walk(dstDir);
  console.log(`  skill ${name} → sanitizado`);
}

async function copyAgentSanitized(name) {
  const src = join(SG, ".claude", "agents", `${name}.md`);
  if (!existsSync(src)) {
    console.warn(`  skip agent ${name} (ausente)`);
    return;
  }
  const dst = join(ENGINE, ".claude", "agents", `${name}.md.hbs`);
  await mkdir(dirname(dst), { recursive: true });
  await writeFile(dst, sanitize(await readFile(src, "utf-8")), "utf-8");
  console.log(`  agent ${name} → sanitizado`);
}

console.log("Extraindo camada custom generica →", ENGINE);
for (const s of GENERIC_SKILLS) await copySkillSanitized(s);
for (const a of GENERIC_AGENTS) await copyAgentSanitized(a);
console.log("OK. Rode a auditoria de acoplamento para ver o residual de negocio.");
