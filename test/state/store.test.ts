import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
import { corruptBase, initInstall, putBase, readAddonStates, removeBase, writeAddonState, writeAddonStateFile } from "../helpers/state.js";
import type { AddonStateRecord } from "../../src/state/addon-state.js";
import { addonStateFile } from "../../src/state/paths.js";

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
    expect(snapshot.error?.message).toContain(".maker/manifest.json e .maker/maker.lock coexistem");
    expect(snapshot.error?.message).toContain("Ação: escolha um estado e remova o outro, ou restaure .maker do histórico do git.");
    await expect(openState(t, { mode: "read" })).rejects.toBeInstanceOf(StateError);
  });

  it("maker-lockfile 2 vira unknown-version (com o número da versão); nunca null", async () => {
    const t = await target("maker-store-version-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "maker.lock"), "maker-lockfile 2\n# a\n# b\n\n[manifest]\n\n[bases]\n\n");
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({
      kind: "unknown-version",
      message: expect.stringContaining("usa um formato mais novo (versão 2) que este maker entende (1)"),
    });
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({ message: expect.stringContaining("Ação: atualize o maker.") });
  });

  it("manifest com marcador de conflito vira manifest-conflict", async () => {
    const t = await target("maker-store-conflict-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "maker.lock"),
      "maker-lockfile 1\n# a\n# b\n\n[manifest]\nmakerVersion \"1.0.0\"\n<<<<<<< HEAD\n\n[addons]\n\n[bases]\n\n");
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({
      kind: "manifest-conflict",
      message: expect.stringContaining("Ação: resolva o conflito ou restaure .maker/maker.lock do histórico do git."),
    });
  });

  it("lockfile ilegível (I/O) vira unreadable com ação de restaurar do git", async () => {
    const t = await target("maker-store-unreadable-lockfile-");
    await mkdir(join(t, ".maker", "maker.lock"), { recursive: true }); // dir no lugar do arquivo: EISDIR ao ler
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({
      kind: "unreadable",
      message: expect.stringContaining(".maker/maker.lock ilegível"),
    });
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({ message: expect.stringContaining("Ação: restaure .maker/maker.lock do histórico do git.") });
  });

  it("manifest.json ilegível (JSON inválido) vira unreadable com ação sobre o manifest.json", async () => {
    const t = await target("maker-store-unreadable-manifest-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "manifest.json"), "{ isto não é json");
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({
      kind: "unreadable",
      message: expect.stringContaining(".maker/manifest.json ilegível"),
    });
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({ message: expect.stringContaining("Ação: restaure .maker/manifest.json do histórico do git.") });
  });

  it("manifest inválido no lockfile vira manifest-invalid com ação de restaurar do git", async () => {
    const t = await target("maker-store-manifest-invalid-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "maker.lock"), "maker-lockfile 1\n# a\n# b\n\nlinha sem [manifest]\n");
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({
      kind: "manifest-invalid",
      message: expect.stringContaining("Ação: restaure .maker/maker.lock do histórico do git."),
    });
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

  it("planStateWrite prune=true nunca remove um hash em preserve, mesmo fora de bases (corrompida referenciada)", async () => {
    const t = await target("maker-store-preserve-");
    const kept = Buffer.from("mantida");
    const keptHash = sha256(kept);
    const corruptHash = "c".repeat(64);
    const m = manifest({ files: {
      "a.md": { hash: keptHash, source: "engine:common", baseHash: keptHash },
      "b.md": { hash: corruptHash, source: "engine:common", baseHash: corruptHash },
    } });
    const initial = await planStateWrite(null, t, {
      manifest: m, format: "files", bases: new Map([[keptHash, kept], [corruptHash, Buffer.from("qualquer coisa")]]), prune: false,
    });
    await applyChangePlan(createPlan(t, initial));
    expect(existsSync(join(t, ".maker", "bases", corruptHash))).toBe(true);

    // `corruptHash` continua referenciado por "b.md", mas seu conteúdo não é verificável (sha256 não
    // bate) — nem entra em `bases` nesta rodada, mas está em `preserve`: não deve ser podado.
    const state = await openState(t, { mode: "read" });
    const changes = await planStateWrite(state, t, {
      manifest: m, format: "files", bases: new Map([[keptHash, kept]]), prune: true, preserve: new Set([keptHash, corruptHash]),
    });
    await applyChangePlan(createPlan(t, changes));
    expect(existsSync(join(t, ".maker", "bases", keptHash))).toBe(true);
    expect(existsSync(join(t, ".maker", "bases", corruptHash))).toBe(true);
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

  it("openState mutate recupera transação pendente antes de ler", async () => {
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

describe("test/helpers/state.ts — put/corrupt/remove nos dois formatos; initInstall files/pack/unset", () => {
  it("putBase/corruptBase/removeBase em files", async () => {
    const t = await initInstall("maker-helper-files-", { format: "files" });
    const hash = await putBase(t, "conteudo da base");
    let state = await openState(t, { mode: "read" });
    expect(state?.bases.get(hash)).toEqual(Buffer.from("conteudo da base"));

    await corruptBase(t, hash);
    state = await inspectStateBases(t);
    expect(state.bases.has(hash)).toBe(false);
    expect(state.problems.some((p) => p.hash === hash && p.kind === "hash-mismatch")).toBe(true);

    await removeBase(t, hash);
    state = await inspectStateBases(t);
    expect(state.bases.has(hash)).toBe(false);
    expect(existsSync(join(t, ".maker", "bases", hash))).toBe(false);
  });

  it("putBase/corruptBase/removeBase em pack", async () => {
    const t = await initInstall("maker-helper-pack-", { format: "pack" });
    const hash = await putBase(t, "conteudo da base");
    let state = await openState(t, { mode: "read" });
    expect(state?.bases.get(hash)).toEqual(Buffer.from("conteudo da base"));

    await corruptBase(t, hash);
    state = await inspectStateBases(t);
    expect(state.bases.has(hash)).toBe(false);
    expect(state.problems.some((p) => p.hash === hash && p.kind === "hash-mismatch")).toBe(true);
    expect(state.problems.some((p) => p.hash === hash && (p.kind === "truncated" || p.kind === "malformed"))).toBe(false);

    // Recoloca a base para testar a remoção isoladamente.
    const hash2 = await putBase(t, "outra base");
    await removeBase(t, hash2);
    const afterRemove = await inspectStateBases(t);
    expect(afterRemove.bases.has(hash2)).toBe(false);
    expect(afterRemove.problems.some((p) => p.hash === hash2)).toBe(false);
  });

  it("C9 — em pack, corrupt(h1) + remove(h2) preserva os dois efeitos (edição só do bloco-alvo)", async () => {
    const t = await initInstall("maker-helper-pack-corrupt-remove-", { format: "pack" });
    const h1 = await putBase(t, "base um");
    const h2 = await putBase(t, "base dois");

    await corruptBase(t, h1);
    await removeBase(t, h2);

    const state = await inspectStateBases(t);
    expect(state.bases.has(h1)).toBe(false);
    expect(state.problems.some((p) => p.hash === h1 && p.kind === "hash-mismatch")).toBe(true);
    expect(state.bases.has(h2)).toBe(false);
    expect(state.problems.some((p) => p.hash === h2)).toBe(false);
  });

  it("C9 — em pack, dois corruptBase seguidos preservam os dois problemas (o segundo não apaga o primeiro)", async () => {
    const t = await initInstall("maker-helper-pack-corrupt-corrupt-", { format: "pack" });
    const h1 = await putBase(t, "base um");
    const h2 = await putBase(t, "base dois");

    await corruptBase(t, h1);
    await corruptBase(t, h2);

    const state = await inspectStateBases(t);
    expect(state.bases.has(h1)).toBe(false);
    expect(state.bases.has(h2)).toBe(false);
    expect(state.problems.some((p) => p.hash === h1 && p.kind === "hash-mismatch")).toBe(true);
    expect(state.problems.some((p) => p.hash === h2 && p.kind === "hash-mismatch")).toBe(true);
  });

  it("initInstall({ format: \"unset\" }) produz files sem basesFormat, independente do default do init", async () => {
    const t = await initInstall("maker-helper-unset-", { format: "unset" });
    const state = await openState(t, { mode: "read" });
    expect(state?.inUse).toBe("files");
    expect(state?.recorded).toBeUndefined();
    expect((state?.manifest.config as { state?: unknown } | undefined)?.state).toBeUndefined();
  });

  it("initInstall({ format: \"files\" }) e ({ format: \"pack\" }) produzem o formato pedido", async () => {
    const files = await initInstall("maker-helper-format-files-", { format: "files" });
    const pack = await initInstall("maker-helper-format-pack-", { format: "pack" });
    expect((await openState(files, { mode: "read" }))?.inUse).toBe("files");
    expect((await openState(pack, { mode: "read" }))?.inUse).toBe("pack");
  });
});

async function inspectStateBases(target: string) {
  const snapshot = await inspectState(target);
  return { bases: snapshot.bases, problems: snapshot.problems };
}

function sampleAddon(overrides: Partial<AddonStateRecord> = {}): AddonStateRecord {
  return {
    id: "saas",
    version: "0.1.0",
    appliedAt: "2026-09-28T12:00:00.000Z",
    knobs: { tenantColumn: "tenant_id" },
    createdFiles: [{ path: ".specify/memory/saas-reference.md", hash: "a".repeat(64) }],
    injectedTargets: [".specify/memory/constitution.md"],
    ...overrides,
  };
}

describe("state/store — emenda US-7 (estado de add-ons)", () => {
  it("pack: addons lido da seção [addons] do lockfile", async () => {
    const t = await target("maker-store-addons-pack-");
    const m = manifest();
    const changes = await planStateWrite(null, t, {
      manifest: m, format: "pack", bases: new Map(), addons: new Map([["saas", sampleAddon()]]), prune: false,
    });
    await applyChangePlan(createPlan(t, changes));
    const snapshot = await inspectState(t);
    expect(snapshot.addons.get("saas")).toEqual(sampleAddon());
    expect(existsSync(join(t, ".maker", "addons"))).toBe(false);
  });

  it("files: addons lido de .maker/addons/<id>.json", async () => {
    const t = await target("maker-store-addons-files-");
    const m = manifest();
    const changes = await planStateWrite(null, t, {
      manifest: m, format: "files", bases: new Map(), addons: new Map([["saas", sampleAddon()]]), prune: false,
    });
    await applyChangePlan(createPlan(t, changes));
    const snapshot = await inspectState(t);
    expect(snapshot.addons.get("saas")).toEqual(sampleAddon());
    expect(existsSync(join(t, ".maker", "addons", "saas.json"))).toBe(true);
  });

  it("lockfile + .maker/addons/<id>.json regular → addon-coexistence, sem escrita, nunca null", async () => {
    const t = await initInstall("maker-store-addon-coexist-", { format: "pack" });
    await mkdir(join(t, ".maker", "addons"), { recursive: true });
    await writeFile(join(t, ".maker", "addons", "saas.json"), JSON.stringify(sampleAddon()));
    const snapshot = await inspectState(t);
    expect(snapshot.error?.kind).toBe("addon-coexistence");
    expect(snapshot.error?.message).toContain(".maker/addons/<id>.json e .maker/maker.lock coexistem (saas)");
    await expect(openState(t, { mode: "read" })).rejects.toBeInstanceOf(StateError);
  });

  it("manifest.json + maker.lock + addons JSON: coexistência de manifest tem precedência", async () => {
    const t = await target("maker-store-coexist-precedence-");
    await mkdir(join(t, ".maker", "addons"), { recursive: true });
    await writeFile(join(t, ".maker", "manifest.json"), JSON.stringify(manifest()));
    await writeFile(join(t, ".maker", "maker.lock"), serializeLockfile(manifest(), new Map()));
    await writeFile(join(t, ".maker", "addons", "saas.json"), JSON.stringify(sampleAddon()));
    const snapshot = await inspectState(t);
    expect(snapshot.error?.kind).toBe("coexistence");
  });

  it("pack: .maker/addons vazio, só com entradas alheias, ou não-diretório é tolerado sem erro", async () => {
    for (const setup of [
      async (t: string) => mkdir(join(t, ".maker", "addons"), { recursive: true }),
      async (t: string) => { await mkdir(join(t, ".maker", "addons"), { recursive: true }); await writeFile(join(t, ".maker", "addons", "nao-json.txt"), "x"); },
      async (t: string) => writeFile(join(t, ".maker", "addons"), "não é diretório"),
    ]) {
      const t = await initInstall("maker-store-addons-dir-tolerated-", { format: "pack" });
      await setup(t);
      const snapshot = await inspectState(t);
      expect(snapshot.error).toBeUndefined();
    }
  });

  it("planStateWrite: files → pack (consolidate) move os estados de add-on e remove o diretório", async () => {
    const t = await initInstall("maker-store-addons-migrate-", { format: "files" });
    await writeAddonState(t, sampleAddon());
    expect(existsSync(join(t, ".maker", "addons", "saas.json"))).toBe(true);

    const state = await openState(t, { mode: "mutate" });
    const changes = await planStateWrite(state, t, {
      manifest: state!.manifest, format: "pack", bases: new Map(), consolidate: true, prune: false,
    });
    await applyChangePlan(createPlan(t, changes));
    expect(existsSync(join(t, ".maker", "addons"))).toBe(false);
    const migrated = await inspectState(t);
    expect(migrated.addons.get("saas")).toEqual(sampleAddon());
  });

  it("planStateWrite: pack → files (consolidate) recria addonStateJson e remove o lockfile", async () => {
    const t = await initInstall("maker-store-addons-migrate-back-", { format: "pack" });
    await writeAddonState(t, sampleAddon());

    const state = await openState(t, { mode: "mutate" });
    const changes = await planStateWrite(state, t, {
      manifest: state!.manifest, format: "files", bases: new Map(), consolidate: true, prune: false,
    });
    await applyChangePlan(createPlan(t, changes));
    expect(existsSync(join(t, ".maker", "maker.lock"))).toBe(false);
    const raw = JSON.parse(await readFile(join(t, ".maker", "addons", "saas.json"), "utf-8"));
    expect(raw).toEqual(sampleAddon());
  });

  it("idempotência: segundo plano de addons já gravados é todo preserve, mesmo com JSON formatado à mão", async () => {
    const t = await initInstall("maker-store-addons-idempotent-", { format: "files" });
    await writeAddonState(t, sampleAddon());
    // Reformata manualmente (mesmo conteúdo lógico, bytes diferentes).
    await writeAddonStateFile(t, "saas", JSON.stringify(sampleAddon()));

    const state = await openState(t, { mode: "read" });
    const changes = await planStateWrite(state, t, { manifest: state!.manifest, format: "files", bases: new Map(), prune: false });
    const plan = createPlan(t, changes);
    // Sem mudança lógica, `planStateWrite` nem chega a planejar a escrita (idempotência real: nenhuma
    // entrada para o caminho, não uma entrada "preserve").
    const addonChange = plan.changes.find((c) => c.path === addonStateFile("saas"));
    expect(addonChange).toBeUndefined();
  });

  it("addons omitido carrega state.addons intacto", async () => {
    const t = await initInstall("maker-store-addons-default-", { format: "pack" });
    await writeAddonState(t, sampleAddon());
    const state = await openState(t, { mode: "read" });
    const changes = await planStateWrite(state, t, { manifest: state!.manifest, format: "pack", bases: new Map(), prune: false });
    await applyChangePlan(createPlan(t, changes));
    const after = await inspectState(t);
    expect(after.addons.get("saas")).toEqual(sampleAddon());
  });

  it("diretório .maker/addons vazio só é removido com consolidate: true", async () => {
    const t = await initInstall("maker-store-addons-empty-dir-", { format: "pack" });
    await mkdir(join(t, ".maker", "addons"), { recursive: true });
    let state = await openState(t, { mode: "mutate" });
    let changes = await planStateWrite(state, t, { manifest: state!.manifest, format: "pack", bases: new Map(), prune: false });
    await applyChangePlan(createPlan(t, changes));
    expect(existsSync(join(t, ".maker", "addons"))).toBe(true);

    state = await openState(t, { mode: "mutate" });
    changes = await planStateWrite(state, t, { manifest: state!.manifest, format: "pack", bases: new Map(), consolidate: true, prune: false });
    await applyChangePlan(createPlan(t, changes));
    expect(existsSync(join(t, ".maker", "addons"))).toBe(false);
  });

  it("files com JSON inválido + destino pack → addon-state-invalid sem plano", async () => {
    const t = await initInstall("maker-store-addon-state-invalid-", { format: "files" });
    await writeAddonStateFile(t, "saas", "{ json inválido");
    const state = await openState(t, { mode: "read" });
    await expect(planStateWrite(state, t, {
      manifest: state!.manifest, format: "pack", bases: new Map(), consolidate: true, prune: false,
    })).rejects.toMatchObject({ kind: "addon-state-invalid" });
  });

  it("files com id ≠ nome do arquivo + destino pack → addon-state-invalid sem plano", async () => {
    const t = await initInstall("maker-store-addon-id-mismatch-", { format: "files" });
    await writeAddonStateFile(t, "saas", sampleAddon({ id: "outro-id" }));
    const state = await openState(t, { mode: "read" });
    expect(state!.addons.get("saas")!.id).toBe("outro-id");
    await expect(planStateWrite(state, t, {
      manifest: state!.manifest, format: "pack", bases: new Map(), consolidate: true, prune: false,
    })).rejects.toMatchObject({ kind: "addon-state-invalid" });
  });

  it("[addons] ilegível vira addons-invalid; marcador de conflito vira addons-conflict", async () => {
    const manifestMin = 'makerVersion "1.0.0"\nproject {"name":"x","slug":"x"}\ninstalledAt "2026-01-01T00:00:00.000Z"';
    const t = await target("maker-store-addons-lockfile-invalid-");
    await mkdir(join(t, ".maker"), { recursive: true });
    await writeFile(join(t, ".maker", "maker.lock"),
      `maker-lockfile 1\n# a\n# b\n\n[manifest]\n${manifestMin}\n\n[addons]\n\nlinha fora da gramática\n\n[bases]\n\n`);
    await expect(openState(t, { mode: "read" })).rejects.toMatchObject({ kind: "addons-invalid" });

    const t2 = await target("maker-store-addons-lockfile-conflict-");
    await mkdir(join(t2, ".maker"), { recursive: true });
    await writeFile(join(t2, ".maker", "maker.lock"),
      `maker-lockfile 1\n# a\n# b\n\n[manifest]\n${manifestMin}\n\n[addons]\n\n<<<<<<< HEAD\n\n[bases]\n\n`);
    await expect(openState(t2, { mode: "read" })).rejects.toMatchObject({ kind: "addons-conflict" });
  });

  it("planStateWrite(null, …) com JSON órfão no disco lança addon-coexistence (variante órfã)", async () => {
    const t = await target("maker-store-orphan-init-");
    await mkdir(join(t, ".maker", "addons"), { recursive: true });
    await writeFile(join(t, ".maker", "addons", "saas.json"), JSON.stringify(sampleAddon()));
    const m = manifest();
    await expect(planStateWrite(null, t, { manifest: m, format: "pack", bases: new Map(), prune: false }))
      .rejects.toMatchObject({ kind: "addon-coexistence" });
    await expect(planStateWrite(null, t, { manifest: m, format: "files", bases: new Map(), prune: false }))
      .rejects.toMatchObject({ kind: "addon-coexistence" });
  });

  it("sem install: orphanAddonStateFiles reporta ids de .maker/addons/*.json regulares; addons vazio", async () => {
    const t = await target("maker-store-orphan-snapshot-");
    await mkdir(join(t, ".maker", "addons"), { recursive: true });
    await writeFile(join(t, ".maker", "addons", "saas.json"), JSON.stringify(sampleAddon()));
    const snapshot = await inspectState(t);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.addons.size).toBe(0);
    expect(snapshot.orphanAddonStateFiles).toEqual(["saas"]);
  });

  it("readAddonStates (helper) é formato-agnóstico", async () => {
    const pack = await initInstall("maker-store-readaddons-pack-", { format: "pack" });
    await writeAddonState(pack, sampleAddon());
    expect((await readAddonStates(pack)).get("saas")).toEqual(sampleAddon());

    const files = await initInstall("maker-store-readaddons-files-", { format: "files" });
    await writeAddonState(files, sampleAddon());
    expect((await readAddonStates(files)).get("saas")).toEqual(sampleAddon());
  });
});
