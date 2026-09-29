import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/schema.js";

const BASE = { project: { name: "Nimbus Ledger" } };

describe("config schema — state.bases (FR-003, FR-004)", () => {
  it("ausência de state vira indefinido (sem default)", () => {
    const config = parseConfig(BASE);
    expect(config.state).toBeUndefined();
  });

  it("aceita \"files\"", () => {
    const config = parseConfig({ ...BASE, state: { bases: "files" } });
    expect(config.state).toEqual({ bases: "files" });
  });

  it("aceita \"pack\"", () => {
    const config = parseConfig({ ...BASE, state: { bases: "pack" } });
    expect(config.state).toEqual({ bases: "pack" });
  });

  it("rejeita valor fora do enum com a mensagem exata", () => {
    expect(() => parseConfig({ ...BASE, state: { bases: "zip" } })).toThrowError(
      /state\.bases deve ser .*files.* ou .*pack.*/,
    );
  });
});
