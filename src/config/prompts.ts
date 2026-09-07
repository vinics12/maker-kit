import * as p from "@clack/prompts";
import { parseConfig, slugify, type MakerConfig } from "./schema.js";

/** Coleta os knobs mecânicos interativamente. Aborta o processo se cancelado. */
export async function promptConfig(): Promise<MakerConfig> {
  p.intro("maker — instalar o motor de criação de produtos");

  const name = await p.text({
    message: "Nome do projeto",
    placeholder: "Acme Platform",
    validate: (v) => (v.trim().length === 0 ? "Obrigatório" : undefined),
  });
  if (p.isCancel(name)) cancel();

  const slug = await p.text({
    message: "Slug (kebab-case)",
    initialValue: slugify(name as string),
    validate: (v) =>
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? undefined : "Use kebab-case",
  });
  if (p.isCancel(slug)) cancel();

  const frontendGlobs = await p.text({
    message: "Globs de frontend (vírgula) — usados no roteamento de dev",
    initialValue: "apps/*/src/**, src/**",
  });
  if (p.isCancel(frontendGlobs)) cancel();

  const backendGlobs = await p.text({
    message: "Globs de backend/dados (vírgula)",
    initialValue: "services/**, functions/**, api/**",
  });
  if (p.isCancel(backendGlobs)) cancel();

  const verify = await p.text({
    message: "Comando de verify (lint+types+test)",
    initialValue: "npm run verify",
  });
  if (p.isCancel(verify)) cancel();

  const build = await p.text({ message: "Comando de build", initialValue: "npm run build" });
  if (p.isCancel(build)) cancel();
  const test = await p.text({ message: "Comando de test", initialValue: "npm test" });
  if (p.isCancel(test)) cancel();
  const dev = await p.text({ message: "Comando de dev", initialValue: "npm run dev" });
  if (p.isCancel(dev)) cancel();

  return parseConfig({
    project: { name: (name as string).trim(), slug: slug as string },
    layout: {
      frontendGlobs: splitList(frontendGlobs as string),
      backendGlobs: splitList(backendGlobs as string),
    },
    commands: {
      verify: verify as string,
      build: build as string,
      test: test as string,
      dev: dev as string,
    },
  });
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function cancel(): never {
  p.cancel("Operação cancelada.");
  process.exit(1);
}
