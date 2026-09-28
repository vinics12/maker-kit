import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlan } from "../../src/changes/plan.js";
import { applyChangePlan } from "../../src/changes/transaction.js";
import {
  StateError,
  inspectState,
  openState,
  planStateWrite,
  readManifest,
  withBases,
} from "../../src/state/store.js";
import { serializeLockfile } from "../../src/state/lockfile.js";
import type { Manifest } from "../../src/render/manifest.js";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 3,
    makerVersion: "1.1.0",
    project: { name: "Nimbus Ledger", slug: "nimbus-ledger" },
    installedAt: "2026-09-27T12:00:00.000Z",
    files: {},
    ...overrides,
  };
}

async function target(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("state/store — inspectState / openState (files e pack)", () => {
  it("sem install: inspectState não lança e openState devolve null", async () => {
    const t = await target("maker-store-empty-");
    const snapshot = await inspectState(t);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.manifest).toBeUndefined();
    expect(await openState(t, { mode: "read" })).toBeNull();
  });

  it("coexistência (manifest.json + maker.lock) lança StateError sem escrever", async () => {
    const t = await target("maker-store-coexist-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "manifest.json"), JSON.stringify(manifest()));
    await writeFile(join(t, ".maker", "maker.lock"), serializeLockfile(manifest(), new Map()));
    const snapshot = await inspectState(t);
    expect(snapshot.error).toBeInstanceOf(StateError);
    expect(snapshot.error?.kind).toBe("coexistence");
    await expect(openState(t, { mode: "read" })).rejects.toBeInstanceOf(StateError);
  });

  it("maker-lockfile 2 vira unknown-version; nunca null", async () => {
    const t = await target("maker-store-version-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "maker.lock"), "maker-lockfile 2\n# a\n# b\n[manifest]\n\n[bases]\n\n");
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({ kind: "unknown-version" });
  });

  it("manifest com marcador de conflito vira manifest-conflict", async () => {
    const t = await target("maker-store-conflict-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "maker.lock"),
      "maker-lockfile 1\n# a\n# b\n[manifest]\nmakerVersion \"1.0.0\"\n<<<<<<< HEAD\n\n[bases]\n\n");
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({ kind: "manifest-conflict" });
  });

  it("união verificada: base corrompida em files não entra em bases; base válida entra", async () => {
    const t = await target("maker-store-union-files-");
    await mkdir(join(t, ".maker", "bases"), { recursive: true });
    const good = Buffer.from("conteudo bom");
    const goodHash = sha256(good);
    await writeFile(join(t, ".maker", "bases", goodHash), good);
    const badHash = "0".repeat(64);
    await writeFile(join(t, ".maker", "bases", badHash), Buffer.from("não confere"));
    await writeFile(join(t, ".maker", "manifest.json"), JSON.stringify(manifest()));
    const snapshot = await inspectState(t);
    expect(snapshot.bases.has(goodHash)).toBe(true);
    expect(snapshot.bases.has(badHash)).toBe(false);
    expect(snapshot.problems.some((p) => p.hash === badHash && p.kind === "hash-mismatch")).toBe(true);
  });

  it("união verificada: base CRLF recuperável em files (recovered: true)", async () => {
    const t = await target("maker-store-crlf-files-");
    await mkdir(join(t, ".maker", "bases"), { recursive: true });
    const original = Buffer.from("linha1\nlinha2");
    const hash = sha256(original);
    const withCrlf = Buffer.from(original.toString("utf-8").replace(/\n/g, "\r\n"));
    await writeFile(join(t, ".maker", "bases", hash), withCrlf);
    await writeFile(join(t, ".maker", "manifest.json"), JSON.stringify(manifest()));
    const snapshot = await inspectState(t);
    expect(snapshot.bases.get(hash)).toEqual(original);
    expect(snapshot.problems.some((p) => p.hash === hash && p.recovered)).toBe(true);
  });

  it("planStateWrite: files → pack (consolidate) remove manifest.json e bases/", async () => {
    const t = await target("maker-store-migrate-");
    const base = Buffer.from("base");
    const hash = sha256(base);
    const m = manifest({ files: { "a.md": { hash, source: "engine:common", baseHash: hash } } });
    const changes1 = await planStateWrite(null, t, { manifest: m, format: "files", bases: new Map([[hash, base]]), prune: false });
    await applyChangePlan(createPlan(t, changes1));
    expect(existsSync(join(t, ".maker", "manifest.json"))).toBe(true);
    expect(existsSync(join(t, ".maker", "bases", hash))).toBe(true);

    const state = await openState(t, { mode: "read" });
    const changes2 = await planStateWrite(state, t, { manifest: m, format: "pack", bases: new Map(), consolidate: true, prune: false });
    await applyChangePlan(createPlan(t, changes2));
    expect(existsSync(join(t, ".maker", "manifest.json"))).toBe(false);
    expect(existsSync(join(t, ".maker", "bases"))).toBe(false);
    expect(existsSync(join(t, ".maker", "maker.lock"))).toBe(true);

    const migrated = await openState(t, { mode: "read" });
    expect(migrated?.inUse).toBe("pack");
    expect(migrated?.bases.get(hash)).toEqual(base);
  });

  it("planStateWrite: pack → files (consolidate) remove o lockfile", async () => {
    const t = await target("maker-store-migrate-back-");
    const base = Buffer.from("base");
    const hash = sha256(base);
    const m = manifest({ files: { "a.md": { hash, source: "engine:common", baseHash: hash } } });
    const changes1 = await planStateWrite(null, t, { manifest: m, format: "pack", bases: new Map([[hash, base]]), prune: false });
    await applyChangePlan(createPlan(t, changes1));
    expect(existsSync(join(t, ".maker", "maker.lock"))).toBe(true);

    const state = await openState(t, { mode: "read" });
    const changes2 = await planStateWrite(state, t, { manifest: m, format: "files", bases: new Map(), consolidate: true, prune: false });
    await applyChangePlan(createPlan(t, changes2));
    expect(existsSync(join(t, ".maker", "maker.lock"))).toBe(false);
    expect(existsSync(join(t, ".maker", "manifest.json"))).toBe(true);
    expect(existsSync(join(t, ".maker", "bases", hash))).toBe(true);
  });

  it("planStateWrite é idempotente: segundo plano é todo preserve", async () => {
    const t = await target("maker-store-idempotent-");
    const m = manifest();
    const changes1 = await planStateWrite(null, t, { manifest: m, format: "pack", bases: new Map(), prune: false });
    await applyChangePlan(createPlan(t, changes1));
    const state = await openState(t, { mode: "read" });
    const changes2 = await planStateWrite(state, t, { manifest: m, format: "pack", bases: new Map(), prune: false });
    const plan2 = createPlan(t, changes2);
    expect(plan2.changes.every((c) => c.action === "preserve")).toBe(true);
  });

  it("planStateWrite normaliza: config.state nunca é gravado", async () => {
    const t = await target("maker-store-config-state-");
    const m = manifest({ config: { agent: "claude", project: { name: "x" }, state: { bases: "pack" } } as unknown as Manifest["config"] });
    const changes = await planStateWrite(null, t, { manifest: m, format: "files", bases: new Map(), prune: false });
    await applyChangePlan(createPlan(t, changes));
    const persisted = await readManifest(t);
    expect((persisted?.config as { state?: unknown } | undefined)?.state).toBeUndefined();
  });

  it("withBases faz a união dos mapas (mesmo hash = mesmo conteúdo endereçado)", () => {
    const a = new Map([["h1", Buffer.from("x")]]);
    const b = new Map([["h2", Buffer.from("y")]]);
    const merged = withBases(a, b);
    expect(merged.size).toBe(2);
    expect(merged.get("h1")).toEqual(Buffer.from("x"));
    expect(merged.get("h2")).toEqual(Buffer.from("y"));
  });

  it("openState mutate recupera transação pendente antes de ler (AC-10b)", async () => {
    const t = await target("maker-store-recover-");
    const m = manifest();
    const initial = await planStateWrite(null, t, { manifest: m, format: "files", bases: new Map(), prune: false });
    await applyChangePlan(createPlan(t, initial));

    const state = await openState(t, { mode: "read" });
    const nextManifest = { ...m, makerVersion: "2.0.0" };
    const changes = await planStateWrite(state, t, { manifest: nextManifest, format: "files", bases: new Map(), prune: false });
    await expect(applyChangePlan(createPlan(t, changes), { crashAfter: 0 })).rejects.toThrow();

    const recovered = await openState(t, { mode: "mutate" });
    expect(recovered?.manifest.makerVersion).toBe("1.1.0");
  });
});
