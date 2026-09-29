import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configuredBasesFormat,
  effectiveBasesFormat,
  pendingDefaultMigration,
  planFormatTransition,
} from "../../src/state/format.js";
import type { InstallState } from "../../src/state/store.js";
import type { Manifest } from "../../src/render/manifest.js";

async function target(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 3,
    makerVersion: "1.1.0",
    project: { name: "x", slug: "x" },
    installedAt: "2026-09-27T12:00:00.000Z",
    files: {},
    ...overrides,
  };
}

function installState(overrides: Partial<InstallState> = {}): InstallState {
  const bases = overrides.bases ?? new Map<string, Buffer>();
  return {
    targetDir: "/tmp/x",
    manifest: manifest(),
    inUse: "files",
    bases,
    problems: [],
    looseFileBases: [],
    readBase: (hash: string) => bases.get(hash) ?? null,
    hasBase: (hash: string) => bases.has(hash),
    ...overrides,
  };
}

describe("state/format — configuredBasesFormat", () => {
  it("arquivo ausente vira unset", async () => {
    const t = await target("maker-format-unset-");
    expect(await configuredBasesFormat(t)).toEqual({ kind: "unset" });
  });

  it("state.bases ausente no JSON válido vira unset", async () => {
    const t = await target("maker-format-unset2-");
    await writeFile(join(t, "maker.config.json"), JSON.stringify({ project: { name: "x" } }));
    expect(await configuredBasesFormat(t)).toEqual({ kind: "unset" });
  });

  it("state.bases válido vira set", async () => {
    const t = await target("maker-format-set-");
    await writeFile(join(t, "maker.config.json"), JSON.stringify({ project: { name: "x" }, state: { bases: "pack" } }));
    expect(await configuredBasesFormat(t)).toEqual({ kind: "set", format: "pack" });
  });

  it("JSON malformado vira unreadable e nunca lança", async () => {
    const t = await target("maker-format-unreadable-");
    await writeFile(join(t, "maker.config.json"), "{ isto não é json");
    const result = await configuredBasesFormat(t);
    expect(result.kind).toBe("unreadable");
  });

  it("state.bases inválido (JSON válido) lança por padrão; com inspect:true vira invalid", async () => {
    const t = await target("maker-format-invalid-");
    await writeFile(join(t, "maker.config.json"), JSON.stringify({ project: { name: "x" }, state: { bases: "zip" } }));
    await expect(configuredBasesFormat(t)).rejects.toThrow();
    const inspected = await configuredBasesFormat(t, { inspect: true });
    expect(inspected.kind).toBe("invalid");
  });

  it("opts.loaded (config já carregada pelo init) tem prioridade sobre o disco", async () => {
    const t = await target("maker-format-loaded-");
    await writeFile(join(t, "maker.config.json"), JSON.stringify({ project: { name: "x" }, state: { bases: "files" } }));
    expect(await configuredBasesFormat(t, { loaded: { state: { bases: "pack" } } })).toEqual({ kind: "set", format: "pack" });
    expect(await configuredBasesFormat(t, { loaded: {} })).toEqual({ kind: "unset" });
  });
});

describe("state/format — effectiveBasesFormat (config → manifest → default)", () => {
  it("config vence quando set", () => {
    expect(effectiveBasesFormat({ kind: "set", format: "files" }, "pack", "pack")).toEqual({ format: "files", reason: "config" });
  });

  it("sem config, usa o registrado no manifest", () => {
    expect(effectiveBasesFormat({ kind: "unset" }, "files", "files")).toEqual({ format: "files", reason: "manifest" });
  });

  it("sem config e sem registro, default é pack", () => {
    expect(effectiveBasesFormat({ kind: "unset" }, undefined, "files")).toEqual({ format: "pack", reason: "default" });
  });

  it("config ilegível: recorded ?? inUse, nunca migra por default", () => {
    expect(effectiveBasesFormat({ kind: "unreadable", message: "x" }, "files", "pack")).toEqual({ format: "files", reason: "unreadable-config" });
    expect(effectiveBasesFormat({ kind: "unreadable", message: "x" }, undefined, "files")).toEqual({ format: "files", reason: "unreadable-config" });
  });
});

describe("state/format — planFormatTransition", () => {
  it("null quando inUse === efetivo e sem bases soltas", () => {
    const state = installState({ inUse: "files" });
    expect(planFormatTransition(state, { format: "files", reason: "manifest" })).toBeNull();
  });

  it("transição files → pack: conta migradas e descartadas com arquivos afetados", () => {
    const base = Buffer.from("conteudo");
    const hash = "a".repeat(64);
    const missingHash = "b".repeat(64);
    const state = installState({
      inUse: "files",
      manifest: manifest({ files: {
        "a.md": { hash, source: "engine:common", baseHash: hash },
        "b.md": { hash: missingHash, source: "engine:common", baseHash: missingHash },
      } }),
      bases: new Map([[hash, base]]),
      problems: [{ origin: "files", kind: "hash-mismatch", hash: missingHash, detail: "corrompida" }],
    });
    const transition = planFormatTransition(state, { format: "pack", reason: "default" });
    expect(transition).not.toBeNull();
    expect(transition!.from).toBe("files");
    expect(transition!.to).toBe("pack");
    expect(transition!.migrated).toBe(1);
    expect(transition!.discarded).toHaveLength(1);
    expect(transition!.affected[missingHash]).toEqual(["b.md"]);
  });

  it("consolidatesLoose: pack com bases soltas por arquivo dispara transição mesmo com inUse === efetivo", () => {
    const state = installState({ inUse: "pack", looseFileBases: ["a".repeat(64)] });
    const transition = planFormatTransition(state, { format: "pack", reason: "manifest" });
    expect(transition?.consolidatesLoose).toBe(true);
  });
});

describe("state/format — pendingDefaultMigration (FR-025)", () => {
  it("files em uso, sem registro e sem config: próximo update migra", () => {
    expect(pendingDefaultMigration({ inUse: "files", recorded: undefined }, { kind: "unset" })).toBe(true);
  });

  it("com opt-out configurado, não é pendente", () => {
    expect(pendingDefaultMigration({ inUse: "files", recorded: undefined }, { kind: "set", format: "files" })).toBe(false);
  });

  it("já registrado, não é pendente", () => {
    expect(pendingDefaultMigration({ inUse: "files", recorded: "files" }, { kind: "unset" })).toBe(false);
  });

  it("em pack, não é pendente", () => {
    expect(pendingDefaultMigration({ inUse: "pack", recorded: undefined }, { kind: "unset" })).toBe(false);
  });
});
