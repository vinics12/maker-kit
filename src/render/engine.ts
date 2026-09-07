import Handlebars from "handlebars";
import type { MakerConfig } from "../config/schema.js";

/**
 * Contexto exposto aos templates .hbs. Deliberadamente raso e mecânico —
 * project/layout/commands. Nada de negócio.
 */
export interface RenderContext {
  project: MakerConfig["project"] & { slug: string };
  layout: MakerConfig["layout"];
  commands: MakerConfig["commands"];
  /** ISO date do install, útil em cabeçalhos de arquivos gerados. */
  generatedAt: string;
}

export function buildContext(config: MakerConfig): RenderContext {
  return {
    project: { ...config.project, slug: config.project.slug! },
    layout: config.layout,
    commands: config.commands,
    generatedAt: new Date().toISOString().slice(0, 10),
  };
}

const hb = Handlebars.create();
// join: renderiza arrays (globs) em texto legível dentro dos templates.
hb.registerHelper("join", (arr: unknown, sep: unknown) =>
  Array.isArray(arr) ? arr.join(typeof sep === "string" ? sep : ", ") : "",
);

export function render(source: string, ctx: RenderContext): string {
  return renderRaw(source, ctx);
}

/** Render com contexto arbitrário (usado por add-ons, cujo contexto é project + knobs próprios). */
export function renderRaw(source: string, ctx: object): string {
  const template = hb.compile(source, { noEscape: true, strict: false });
  return template(ctx);
}

/** Sobra de placeholder não-resolvido — usado pelos testes anti-regressão. */
export function hasUnresolvedPlaceholder(rendered: string): boolean {
  return /\{\{[^}]*\}\}/.test(rendered);
}
