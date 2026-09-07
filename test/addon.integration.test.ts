import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runInit } from "../src/commands/init.js";
import { loadAddon } from "../src/addons/loader.js";
import { applyAddon, removeAddon } from "../src/addons/apply.js";
import { readManifest, verifyManifest } from "../src/render/manifest.js";
import { isAddonApplied } from "../src/addons/state.js";

const FIXTURE = join(__dirname, "..", "fixtures", "example.config.json");
const CONST = ".specify/memory/constitution.md";
const REF = ".specify/memory/saas-reference.md";
const REVIEWER = ".claude/agents/code-reviewer.md";

async function read(target: string, rel: string) {
  return readFile(join(target, rel), "utf-8");
}

describe("add-on saas (integração)", () => {
  let target: string;

  beforeAll(async () => {
    target = await mkdtemp(join(tmpdir(), "maker-addon-"));
    await runInit({ target, config: FIXTURE, yes: true });
  }, 30_000);

  it("valida o manifest do add-on saas", async () => {
    const addon = await loadAddon("saas");
    expect(addon.id).toBe("saas");
    expect(addon.principles.length).toBe(3);
  });

  it("apply injeta princípios, fragmento e arquivo; doctor fica verde", async () => {
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, {
      tenantColumn: "org_id",
      brandVarPrefix: "--tema-",
      roles: "owner,staff",
    });

    const c = await read(target, CONST);
    expect(c).toContain("SaaS-1. Multi-Tenant First");
    expect(c).toContain("org_id"); // knob renderizado
    expect(c).toContain("--tema-");
    expect(c).not.toContain("nenhum princípio de projeto definido"); // placeholder substituído

    expect(existsSync(join(target, REF))).toBe(true);
    const frag = await read(target, REVIEWER);
    expect(frag).toContain("Checklist SaaS");

    expect(isAddonApplied(target, "saas")).toBe(true);

    const m = await readManifest(target);
    const r = await verifyManifest(target, m!);
    expect(r.ok, `missing=${r.missing} modified=${r.modified}`).toBe(true);
  });

  it("apply é idempotente (reaplicar não duplica)", async () => {
    const addon = await loadAddon("saas");
    await applyAddon(target, addon, { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" });
    const c = await read(target, CONST);
    expect(c.match(/maker:addon:saas:start/g)?.length).toBe(1);
    expect(c.match(/SaaS-1\. Multi-Tenant First/g)?.length).toBe(1);
  });

  it("remove reverte ao estado pós-init e mantém doctor verde", async () => {
    await removeAddon(target, "saas");

    const c = await read(target, CONST);
    expect(c).not.toContain("SaaS-1");
    expect(c).not.toContain("maker:addon:saas");
    expect(existsSync(join(target, REF))).toBe(false);
    const frag = await read(target, REVIEWER);
    expect(frag).not.toContain("Checklist SaaS");
    expect(isAddonApplied(target, "saas")).toBe(false);

    const m = await readManifest(target);
    const r = await verifyManifest(target, m!);
    expect(r.ok, `missing=${r.missing} modified=${r.modified}`).toBe(true);
  });
});
