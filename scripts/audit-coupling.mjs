#!/usr/bin/env node
/**
 * Auditoria de acoplamento de negocio nos templates do motor. Falha (exit 1) se
 * encontrar termos de regra de negocio fora dos stubs de memoria. Espelha o teste
 * de integracao ANTI-ACOPLAMENTO, mas roda direto sobre templates/engine.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "templates", "engine");
const BUSINESS =
  /\btenant\b|multi-?tenant|supabase|whitelabel|\brls\b|service_role|posthog|sentry|pg_boss|shadcn/i;

async function walk(d) {
  const out = [];
  for (const e of await readdir(d)) {
    const p = join(d, e);
    out.push(...((await stat(p)).isDirectory() ? await walk(p) : [p]));
  }
  return out;
}

const files = await walk(ENGINE);
const offenders = [];
for (const f of files) {
  // stubs de memoria e o proprio constitution.hbs mencionam negocio como exemplo — permitido
  if (/\/memory\/(project-rules|product-overview|constitution)\.md\.hbs$/.test(f)) continue;
  const content = await readFile(f, "utf-8").catch(() => "");
  content.split("\n").forEach((line, i) => {
    if (BUSINESS.test(line)) offenders.push(`${f.replace(ENGINE, "")}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (offenders.length) {
  console.error(`✗ acoplamento de negocio em ${offenders.length} linha(s):`);
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}
console.log("✓ templates/engine limpo de regra de negocio.");
