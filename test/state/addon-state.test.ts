import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  addonStateJson,
  isAddonId,
  isLockfileSerializable,
  parseAddonStateRecord,
  ADDON_STATE_FIELDS,
  type AddonStateRecord,
} from "../../src/state/addon-state.js";

/** Cópia congelada do schema da 1.0.0 (`v1.0.0:src/addons/state.ts:7-22`): garante que o JSON
 * recriado por `addonStateJson` continua legível pela CLI publicada, mesmo que o schema atual mude. */
const legacyAddonStateSchema = z.object({
  id: z.string(),
  version: z.string(),
  appliedAt: z.string(),
  knobs: z.record(z.string(), z.string()),
  createdFiles: z.array(z.object({ path: z.string(), hash: z.string() })),
  injectedTargets: z.array(z.string()),
  injectedBlocks: z.record(z.string(), z.string()).optional(),
});

function sample(overrides: Partial<AddonStateRecord> = {}): AddonStateRecord {
  return {
    id: "saas",
    version: "0.1.0",
    appliedAt: "2026-09-28T12:00:00.000Z",
    knobs: { tenantColumn: "org_id", brandVarPrefix: "--tema-", roles: "owner,staff" },
    createdFiles: [{ path: ".specify/memory/saas-reference.md", hash: "a".repeat(64) }],
    injectedTargets: [".specify/memory/constitution.md", ".maker/workflow/agents/code-reviewer.md"],
    injectedBlocks: { ".specify/memory/constitution.md": "b".repeat(64) },
    ...overrides,
  };
}

describe("state/addon-state — schema movido + addonStateJson (US-7)", () => {
  it("ADDON_STATE_FIELDS é a ordem exata do JSON que o maker grava hoje", () => {
    expect(ADDON_STATE_FIELDS).toEqual([
      "id", "version", "appliedAt", "knobs", "createdFiles", "injectedTargets", "injectedBlocks",
    ]);
  });

  it("addonStateJson: byte a byte igual ao JSON que applyAddon grava hoje (string literal capturada)", () => {
    const record = sample();
    const expected = [
      "{",
      '  "id": "saas",',
      '  "version": "0.1.0",',
      '  "appliedAt": "2026-09-28T12:00:00.000Z",',
      "  \"knobs\": {",
      '    "tenantColumn": "org_id",',
      '    "brandVarPrefix": "--tema-",',
      '    "roles": "owner,staff"',
      "  },",
      "  \"createdFiles\": [",
      "    {",
      `      "path": ".specify/memory/saas-reference.md",`,
      `      "hash": "${"a".repeat(64)}"`,
      "    }",
      "  ],",
      "  \"injectedTargets\": [",
      '    ".specify/memory/constitution.md",',
      '    ".maker/workflow/agents/code-reviewer.md"',
      "  ],",
      "  \"injectedBlocks\": {",
      `    ".specify/memory/constitution.md": "${"b".repeat(64)}"`,
      "  }",
      "}",
      "",
    ].join("\n");
    expect(addonStateJson(record)).toBe(expected);
  });

  it("addonStateJson: injectedBlocks ausente não vira chave", () => {
    const { injectedBlocks: _injectedBlocks, ...withoutBlocks } = sample();
    const json = addonStateJson(withoutBlocks as AddonStateRecord);
    expect(json).not.toContain("injectedBlocks");
    expect(JSON.parse(json)).not.toHaveProperty("injectedBlocks");
  });

  it("addonStateJson: createdFiles vira { path, hash } (extras por item não sobrevivem)", () => {
    const record = sample({
      createdFiles: [{ path: "a.md", hash: "c".repeat(64), extra: "descartado" } as never],
    });
    const parsed = JSON.parse(addonStateJson(record));
    expect(parsed.createdFiles).toEqual([{ path: "a.md", hash: "c".repeat(64) }]);
  });

  it("addonStateJson: extras de topo preservados, na ordem de inserção, depois dos campos conhecidos", () => {
    const record = { ...sample(), customMetadata: { preserve: true }, zField: "z" } as AddonStateRecord;
    const parsed = JSON.parse(addonStateJson(record));
    const keys = Object.keys(parsed);
    expect(keys.slice(0, 7)).toEqual([...ADDON_STATE_FIELDS]);
    expect(keys.slice(7)).toEqual(["customMetadata", "zField"]);
  });

  it("o JSON recriado valida no schema congelado da 1.0.0", () => {
    const record = sample();
    const parsed = legacyAddonStateSchema.parse(JSON.parse(addonStateJson(record)));
    expect(parsed).toEqual(record);
  });

  it("parseAddonStateRecord: passthrough preserva campos desconhecidos; lança para schema inválido", () => {
    const withExtra = parseAddonStateRecord({ ...sample(), custom: "x" });
    expect((withExtra as AddonStateRecord).custom).toBe("x");
    expect(() => parseAddonStateRecord({ id: "saas" })).toThrow();
  });

  it("isAddonId: /^[a-z0-9-]+$/", () => {
    expect(isAddonId("saas")).toBe(true);
    expect(isAddonId("my-addon-2")).toBe(true);
    expect(isAddonId("Saas")).toBe(false);
    expect(isAddonId("saas inválido")).toBe(false);
    expect(isAddonId("")).toBe(false);
  });

  it("isLockfileSerializable: null para registro válido; motivo para chave fora da gramática", () => {
    expect(isLockfileSerializable(sample())).toBeNull();
    const invalid = { ...sample(), "my-field": "x" } as AddonStateRecord;
    expect(isLockfileSerializable(invalid)).toContain("my-field");
    expect(isLockfileSerializable(invalid)).toContain("fora da gramática");
  });

  it("isLockfileSerializable: campo id nunca é considerado (é a linha-chave, não um campo)", () => {
    expect(isLockfileSerializable(sample({ id: "saas" }))).toBeNull();
  });
});
