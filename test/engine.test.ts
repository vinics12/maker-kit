import { describe, it, expect } from "vitest";
import { render, buildContext, hasUnresolvedPlaceholder } from "../src/render/engine.js";
import { parseConfig, slugify } from "../src/config/schema.js";

describe("config schema", () => {
  it("deriva slug do name quando ausente", () => {
    const c = parseConfig({ project: { name: "Nimbus Ledger" } });
    expect(c.project.slug).toBe("nimbus-ledger");
  });

  it("aplica defaults de commands e layout", () => {
    const c = parseConfig({ project: { name: "X" } });
    expect(c.commands.verify).toBeTruthy();
    expect(c.layout.frontendGlobs.length).toBeGreaterThan(0);
  });

  it("rejeita slug não-kebab", () => {
    expect(() => parseConfig({ project: { name: "X", slug: "Not Kebab" } })).toThrow();
  });

  it("slugify remove acentos e normaliza", () => {
    expect(slugify("Gestão de Manutenção")).toBe("gestao-de-manutencao");
  });
});

describe("render engine", () => {
  const ctx = buildContext(parseConfig({ project: { name: "Acme Co", slug: "acme-co" } }));

  it("interpola project e commands", () => {
    const out = render("# {{project.name}} usa {{commands.verify}}", ctx);
    expect(out).toContain("Acme Co");
    expect(out).toContain(ctx.commands.verify);
  });

  it("join renderiza arrays de globs", () => {
    const out = render("{{join layout.frontendGlobs}}", ctx);
    expect(out).toContain(ctx.layout.frontendGlobs[0]!);
  });

  it("detecta placeholder não-resolvido", () => {
    expect(hasUnresolvedPlaceholder("oi {{missing}}")).toBe(true);
    expect(hasUnresolvedPlaceholder("resolvido")).toBe(false);
  });
});
