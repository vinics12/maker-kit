import { describe, expect, it } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/render/manifest.js";
import { StateError, type StateSnapshot } from "../../src/state/store.js";
import type { BaseProblem } from "../../src/state/lockfile.js";
import type { ConfiguredFormat } from "../../src/state/format.js";
import { diagnoseState } from "../../src/state/diagnose.js";

const UNSET: ConfiguredFormat = { kind: "unset" };

function manifest(files: Record<string, ManifestEntry> = {}): Manifest {
  return { makerVersion: "1.0.0", project: { name: "x", slug: "x" }, installedAt: "1970-01-01T00:00:00.000Z", files };
}

function snapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    targetDir: "/tmp/x",
    hasManifestJson: false,
    hasLockfile: true,
    basesDirEntries: [],
    pendingTransactions: false,
    bases: new Map(),
    baseOrigins: new Map(),
    problems: [],
    looseFileBases: [],
    conflictMarkersInBases: 0,
    crlfSuspected: false,
    manifest: manifest(),
    inUse: "pack",
    ...overrides,
  };
}

const HASH = "a".repeat(64);

describe("diagnoseState — um caso por code", () => {
  it("pending-transaction: checado antes de qualquer outra coisa, mesmo sem manifest", () => {
    const findings = diagnoseState(snapshot({ pendingTransactions: true, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings).toEqual([{
      severity: "fail", code: "pending-transaction",
      message: "transação pendente em .maker/transactions",
      action: "rode um comando que altera o install (ex.: maker update) para recuperá-la",
    }]);
  });

  it("coexistence: manifest.json e maker.lock coexistem", () => {
    const error = new StateError("coexistence", "x", "y", "/tmp/x/.maker/manifest.json");
    const findings = diagnoseState(snapshot({ error, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.code).toBe("coexistence");
    expect(findings[0]!.message).toContain(".maker/manifest.json e .maker/maker.lock coexistem");
    expect(findings[0]!.action).toContain("escolha um estado e remova o outro, ou restaure .maker do histórico do git");
  });

  it("unreadable: lockfile ilegível quando o lockfile é o estado presente", () => {
    const error = new StateError("unreadable", "x", "y", "/tmp/x/.maker/maker.lock");
    const findings = diagnoseState(snapshot({ error, hasLockfile: true, hasManifestJson: false, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings[0]).toMatchObject({ severity: "fail", code: "unreadable" });
    expect(findings[0]!.message).toContain("lockfile ilegível");
    expect(findings[0]!.action).toContain("restaure .maker/maker.lock do histórico do git");
  });

  it("unreadable: manifest ilegível quando manifest.json é o único estado presente", () => {
    const error = new StateError("unreadable", "x", "y", "/tmp/x/.maker/manifest.json");
    const findings = diagnoseState(snapshot({ error, hasLockfile: false, hasManifestJson: true, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings[0]!.message).toContain("manifest ilegível");
    expect(findings[0]!.action).toContain("restaure .maker/manifest.json do histórico do git");
  });

  it("unknown-version: versão de formato do lockfile desconhecida", () => {
    const error = new StateError("unknown-version", "x", "y", "/tmp/x/.maker/maker.lock");
    const findings = diagnoseState(snapshot({ error, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings[0]).toMatchObject({ severity: "fail", code: "unknown-version" });
    expect(findings[0]!.message).toContain("versão de formato do lockfile desconhecida");
    expect(findings[0]!.action).toContain("atualize o maker");
  });

  it("manifest-invalid: extrai o número da linha", () => {
    const error = new StateError("manifest-invalid", "seção de manifest de .maker/maker.lock inválida (linha 7: motivo); nenhuma alteração foi feita.", "y", "/tmp/x/.maker/maker.lock");
    const findings = diagnoseState(snapshot({ error, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings[0]!.message).toContain("seção de manifest do lockfile inválida (linha 7)");
    expect(findings[0]!.action).toContain("restaure .maker/maker.lock do histórico do git");
  });

  it("manifest-conflict: extrai o número da linha", () => {
    const error = new StateError("manifest-conflict", ".maker/maker.lock contém marcadores de conflito do git na seção de manifest (linha 12); nenhuma alteração foi feita.", "y", "/tmp/x/.maker/maker.lock");
    const findings = diagnoseState(snapshot({ error, manifest: undefined, inUse: undefined }), UNSET);
    expect(findings[0]!.message).toContain("marcadores de conflito do git na seção de manifest (linha 12)");
    expect(findings[0]!.action).toContain("resolva o conflito em .maker/maker.lock ou restaure do histórico do git");
  });

  it("base-missing: base referenciada ausente do armazenamento", () => {
    const files = { "AGENTS.md": { hash: "h", source: "engine:common", baseHash: HASH } };
    const findings = diagnoseState(snapshot({ manifest: manifest(files) }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.code).toBe("base-missing");
    expect(findings[0]!.message).toContain(`base ausente ${HASH} (referenciada por AGENTS.md)`);
    expect(findings[0]!.action).toContain("sem a base, o próximo maker update preserva o arquivo e pede mediação");
    expect(findings[0]!.hash).toBe(HASH);
    expect(findings[0]!.files).toEqual(["AGENTS.md"]);
  });

  it("base-corrupt: hash não confere com o conteúdo", () => {
    const problems: BaseProblem[] = [{ origin: "pack", kind: "hash-mismatch", hash: HASH, detail: "sha256 do conteúdo não confere com o hash declarado" }];
    const findings = diagnoseState(snapshot({ problems }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.code).toBe("base-corrupt");
    expect(findings[0]!.message).toContain(`base corrompida ${HASH} [pack]: sha256 do conteúdo não confere com o hash declarado`);
    expect(findings[0]!.action).toContain(`restaure a base ${HASH} do histórico do git; confira .maker/.gitattributes (fim de linha)`);
  });

  it("base-corrupt: recuperável (CRLF) continua falha, com sufixo e ação dedicada", () => {
    const problems: BaseProblem[] = [{ origin: "files", kind: "hash-mismatch", hash: HASH, detail: "conteúdo recuperado (\\r\\n → \\n)", recovered: true }];
    const findings = diagnoseState(snapshot({ problems }), UNSET);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.message).toContain("(recuperável: fins de linha convertidos para CRLF)");
    expect(findings[0]!.action).toBe("rode maker update para regravá-la; confira .maker/.gitattributes");
  });

  it("base-corrupt: crlfSuspected acrescenta à ação (só no caminho não recuperável)", () => {
    const problems: BaseProblem[] = [{ origin: "pack", kind: "hash-mismatch", hash: HASH, detail: "d" }];
    const findings = diagnoseState(snapshot({ problems, crlfSuspected: true }), UNSET);
    expect(findings[0]!.action).toContain("o lockfile parece ter sido convertido para CRLF");
  });

  it("entry-truncated: tamanho declarado diferente do conteúdo (size-mismatch)", () => {
    const problems: BaseProblem[] = [{ origin: "pack", kind: "size-mismatch", hash: HASH, detail: "tamanho declarado 1834, conteúdo 1840" }];
    const findings = diagnoseState(snapshot({ problems }), UNSET);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.code).toBe("entry-truncated");
    expect(findings[0]!.message).toContain(`entrada truncada ${HASH}: tamanho declarado 1834, conteúdo 1840`);
    expect(findings[0]!.action).toContain("restaure .maker/maker.lock do histórico do git");
  });

  it("entry-truncated: bloco sem @end (truncated)", () => {
    const problems: BaseProblem[] = [{ origin: "pack", kind: "truncated", hash: HASH, detail: "bloco truncado; @end não encontrado" }];
    const findings = diagnoseState(snapshot({ problems }), UNSET);
    expect(findings[0]!.code).toBe("entry-truncated");
    expect(findings[0]!.message).toContain(`entrada truncada ${HASH}: sem @end`);
  });

  it("entry-malformed: linha fora da gramática", () => {
    const problems: BaseProblem[] = [{ origin: "pack", kind: "malformed", detail: "linha fora da gramática de bases", line: 42 }];
    const findings = diagnoseState(snapshot({ problems }), UNSET);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.code).toBe("entry-malformed");
    expect(findings[0]!.message).toContain("entrada malformada no lockfile (linha 42)");
    expect(findings[0]!.action).toContain("restaure .maker/maker.lock do histórico do git");
  });

  it("orphan-bases: base válida presente sem nenhum baseHash que a referencie", () => {
    const findings = diagnoseState(snapshot({ bases: new Map([[HASH, Buffer.from("x")]]) }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.code).toBe("orphan-bases");
    expect(findings[0]!.message).toContain("1 base(s) órfã(s) no armazenamento");
    expect(findings[0]!.action).toContain("rode maker update para podá-las");
  });

  it("loose-file-bases: bases por arquivo junto ao lockfile em uso", () => {
    const findings = diagnoseState(snapshot({ inUse: "pack", looseFileBases: [HASH] }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.code).toBe("loose-file-bases");
    expect(findings[0]!.message).toContain("bases por arquivo em .maker/bases junto ao lockfile");
    expect(findings[0]!.action).toContain("rode maker update para consolidar no formato configurado");
  });

  it("bases-conflict-markers: marcadores de conflito na seção de bases", () => {
    const findings = diagnoseState(snapshot({ conflictMarkersInBases: 2 }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.code).toBe("bases-conflict-markers");
    expect(findings[0]!.message).toContain("marcadores de conflito do git na seção de bases");
    expect(findings[0]!.action).toContain("rode maker update para regravar o lockfile");
  });

  it("pending-default-migration: files não migrado, config unset", () => {
    const findings = diagnoseState(snapshot({ inUse: "files", recorded: undefined }), UNSET);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("info");
    expect(findings[0]!.code).toBe("pending-default-migration");
    expect(findings[0]!.message).toContain('o próximo maker update migrará as bases para o formato "pack"');
    expect(findings[0]!.action).toContain('para manter bases por arquivo, declare "state": { "bases": "files" } em maker.config.json');
  });

  it("pending-default-migration: não aparece com state.bases: files explícito na config (AC-35)", () => {
    const configured: ConfiguredFormat = { kind: "set", format: "files" };
    const findings = diagnoseState(snapshot({ inUse: "files", recorded: undefined }), configured);
    expect(findings).toEqual([]);
  });

  it("config-invalid: state.bases fora do enum em maker.config.json", () => {
    const configured: ConfiguredFormat = { kind: "invalid", message: 'maker.config.json: state.bases deve ser "files" ou "pack"' };
    const findings = diagnoseState(snapshot(), configured);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("fail");
    expect(findings[0]!.code).toBe("config-invalid");
    expect(findings[0]!.message).toContain('maker.config.json: state.bases deve ser "files" ou "pack"');
    expect(findings[0]!.action).toContain("corrija state.bases em maker.config.json");
  });

  it("config-unreadable: maker.config.json com JSON malformado", () => {
    const configured: ConfiguredFormat = { kind: "unreadable", message: "maker.config.json ilegível: Unexpected token" };
    const findings = diagnoseState(snapshot(), configured);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.code).toBe("config-unreadable");
    expect(findings[0]!.message).toContain("maker.config.json ilegível");
    expect(findings[0]!.action).toContain("corrija o JSON de maker.config.json; o formato das bases segue o registrado");
  });

  it("install íntegro: nenhum achado", () => {
    expect(diagnoseState(snapshot(), UNSET)).toEqual([]);
  });

  it("ordena falhas antes de avisos antes de informações", () => {
    const files = { "AGENTS.md": { hash: "h", source: "engine:common", baseHash: HASH } };
    const findings = diagnoseState(snapshot({
      manifest: manifest(files),
      inUse: "files",
      recorded: undefined,
      bases: new Map([["b".repeat(64), Buffer.from("x")]]),
    }), UNSET);
    expect(findings.map((f) => f.severity)).toEqual(["fail", "warn", "info"]);
  });

  it("base corrompida não é contada como órfã nem gera base-missing duplicado", () => {
    const files = { "AGENTS.md": { hash: "h", source: "engine:common", baseHash: HASH } };
    const problems: BaseProblem[] = [{ origin: "pack", kind: "hash-mismatch", hash: HASH, detail: "d" }];
    const findings = diagnoseState(snapshot({ manifest: manifest(files), problems }), UNSET);
    expect(findings.map((f) => f.code)).toEqual(["base-corrupt"]);
  });
});
