import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mergeDiff3 } from "node-diff3";
import {
  canonicalJson,
  parseLockfile,
  serializeLockfile,
  LockfileError,
} from "../../src/state/lockfile.js";
import type { Manifest } from "../../src/render/manifest.js";

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(Buffer.isBuffer(content) ? content : Buffer.from(content)).digest("hex");
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

describe("lockfile — codec (contracts/lockfile-format.md)", () => {
  it("L1 — parse(serialize(m, b)) devolve m (sem config.state) e b", () => {
    const m = manifest({
      config: { agent: "claude", project: { name: "x" }, state: { bases: "pack" } } as unknown as Manifest["config"],
      files: { "AGENTS.md": { hash: "a".repeat(64), source: "engine:common", baseHash: "a".repeat(64) } },
    });
    const base = Buffer.from("conteúdo da base\n");
    const hash = sha256(base);
    const bases = new Map([[hash, base]]);
    const raw = serializeLockfile(m, bases);
    const parsed = parseLockfile(raw);
    expect(parsed.manifest.makerVersion).toBe("1.1.0");
    expect(parsed.manifest.files["AGENTS.md"]).toEqual(m.files["AGENTS.md"]);
    expect((parsed.manifest.config as { state?: unknown } | undefined)?.state).toBeUndefined();
    expect(parsed.bases.get(hash)).toEqual(base);
  });

  it("L2 — mesmo estado lógico com ordens de inserção diferentes produz bytes idênticos; sem \\r estrutural", () => {
    const m1 = manifest({ files: {
      "b.md": { hash: "b".repeat(64), source: "engine:common" },
      "a.md": { hash: "a".repeat(64), source: "engine:common" },
    } });
    const m2 = manifest({ files: {
      "a.md": { hash: "a".repeat(64), source: "engine:common" },
      "b.md": { hash: "b".repeat(64), source: "engine:common" },
    } });
    const base1 = Buffer.from("um");
    const base2 = Buffer.from("dois");
    const bases1 = new Map([[sha256(base2), base2], [sha256(base1), base1]]);
    const bases2 = new Map([[sha256(base1), base1], [sha256(base2), base2]]);
    const raw1 = serializeLockfile(m1, bases1);
    const raw2 = serializeLockfile(m2, bases2);
    expect(raw1.equals(raw2)).toBe(true);
    expect(raw1.toString("utf-8")).not.toContain("\r");
  });

  it("L3 — estrutura visível: cabeçalho, [manifest] com um file por caminho, [bases] com sha256/size/encoding", () => {
    const m = manifest({ files: { "AGENTS.md": { hash: "a".repeat(64), source: "engine:common" } } });
    const base = Buffer.from("hello");
    const hash = sha256(base);
    const text = serializeLockfile(m, new Map([[hash, base]])).toString("utf-8");
    expect(text.startsWith("maker-lockfile 1\n")).toBe(true);
    expect(text).toContain('file "AGENTS.md"');
    expect(text).toContain(`@base sha256=${hash} size=${base.length} encoding=utf8`);
    const notUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    const hashBin = sha256(notUtf8);
    const textBin = serializeLockfile(m, new Map([[hashBin, notUtf8]])).toString("utf-8");
    expect(textBin).toContain(`encoding=base64`);
  });

  it("L4 — base de 0 bytes e lockfile sem bases são válidos", () => {
    const m = manifest();
    const empty = Buffer.alloc(0);
    const hash = sha256(empty);
    const withZeroBase = parseLockfile(serializeLockfile(m, new Map([[hash, empty]])));
    expect(withZeroBase.bases.get(hash)).toEqual(empty);
    const withoutBases = parseLockfile(serializeLockfile(m, new Map()));
    expect(withoutBases.bases.size).toBe(0);
  });

  it("L5 — conteúdo utf8 contendo @end/@base/[bases]/marcadores de conflito é recuperado intacto", () => {
    const m = manifest();
    const tricky = Buffer.from("linha antes\n@end sha256=zzz\n@base sha256=zzz size=1 encoding=utf8\n[bases]\n<<<<<<< HEAD\n=======\n>>>>>>> branch\nfim");
    const hash = sha256(tricky);
    const parsed = parseLockfile(serializeLockfile(m, new Map([[hash, tricky]])));
    expect(parsed.bases.get(hash)).toEqual(tricky);
  });

  it("L6 — conteúdo com \\r\\n e com NUL é recuperado byte a byte", () => {
    const m = manifest();
    const withCrlf = Buffer.from("linha1\r\nlinha2\r\n");
    const withNul = Buffer.from([0x61, 0x00, 0x62]);
    const h1 = sha256(withCrlf);
    const h2 = sha256(withNul);
    const parsed = parseLockfile(serializeLockfile(m, new Map([[h1, withCrlf], [h2, withNul]])));
    expect(parsed.bases.get(h1)).toEqual(withCrlf);
    expect(parsed.bases.get(h2)).toEqual(withNul);
  });

  it("L7 — bloco do meio com size errado/truncado gera problems e os blocos seguintes são recuperados", () => {
    const m = manifest();
    const a = Buffer.from("primeiro");
    const b = Buffer.from("segundo");
    const c = Buffer.from("terceiro");
    const ha = sha256(a);
    const hb = sha256(b);
    const hc = sha256(c);
    const raw = serializeLockfile(m, new Map([[ha, a], [hb, b], [hc, c]])).toString("utf-8");
    // Corrompe o `size` declarado do bloco do meio (hb) sem tocar os outros.
    const broken = raw.replace(`size=${b.length} encoding=utf8`, `size=${b.length + 5} encoding=utf8`);
    const parsed = parseLockfile(Buffer.from(broken, "utf-8"));
    expect(parsed.bases.get(ha)).toEqual(a);
    expect(parsed.bases.get(hc)).toEqual(c);
    expect(parsed.bases.has(hb)).toBe(false);
    expect(parsed.problems.some((p) => p.kind === "size-mismatch" || p.kind === "truncated")).toBe(true);
  });

  it("L8 — bloco com conteúdo alterado gera hash-mismatch e nunca entra em bases", () => {
    const m = manifest();
    const original = Buffer.from("conteudo original");
    const hash = sha256(original);
    const raw = serializeLockfile(m, new Map([[hash, original]])).toString("utf-8");
    const tampered = raw.replace("conteudo original", "conteudo alterado");
    const parsed = parseLockfile(Buffer.from(tampered, "utf-8"));
    expect(parsed.bases.has(hash)).toBe(false);
    expect(parsed.problems.some((p) => p.kind === "hash-mismatch" && !p.recovered)).toBe(true);
  });

  it("L9a — conflito de merge em blocos inteiros: os dois lados são recuperados; conflictMarkers > 0", () => {
    const m = manifest();
    const a = Buffer.from("base A");
    const b = Buffer.from("base B");
    const ha = sha256(a);
    const hb = sha256(b);
    const blockA = `@base sha256=${ha} size=${a.length} encoding=utf8\n${a.toString("utf-8")}\n@end sha256=${ha}\n\n`;
    const blockB = `@base sha256=${hb} size=${b.length} encoding=utf8\n${b.toString("utf-8")}\n@end sha256=${hb}\n\n`;
    const header = serializeLockfile(m, new Map()).toString("utf-8");
    const conflicted = header + `<<<<<<< HEAD\n${blockA}=======\n${blockB}>>>>>>> branch\n`;
    const parsed = parseLockfile(Buffer.from(conflicted, "utf-8"));
    expect(parsed.bases.get(ha)).toEqual(a);
    expect(parsed.bases.get(hb)).toEqual(b);
    expect(parsed.conflictMarkers).toBeGreaterThan(0);
  });

  it("L9b — conflito intercalado dentro do conteúdo de uma base: ela não entra em bases; blocos intactos continuam válidos", () => {
    const m = manifest();
    const intact = Buffer.from("base intacta");
    const hIntact = sha256(intact);
    const content = "linha comum\nlinha alterada\nfim";
    const hOriginal = sha256(Buffer.from(content));
    const intercalated = `@base sha256=${hOriginal} size=${Buffer.byteLength(content)} encoding=utf8\nlinha comum\n<<<<<<< HEAD\nlinha alterada\n=======\nlinha alterada por outra branch\n>>>>>>> branch\nfim\n@end sha256=${hOriginal}\n\n`;
    const header = serializeLockfile(m, new Map([[hIntact, intact]])).toString("utf-8");
    const withoutTrailingBases = header.replace(/\[bases\]\n\n$/, "[bases]\n\n");
    const conflicted = withoutTrailingBases + intercalated;
    const parsed = parseLockfile(Buffer.from(conflicted, "utf-8"));
    expect(parsed.bases.get(hIntact)).toEqual(intact);
    expect(parsed.bases.has(hOriginal)).toBe(false);
  });

  it("L10 — marcador na seção de manifest vira manifest-conflict; manifest truncado vira manifest-invalid", () => {
    const withConflict = "maker-lockfile 1\n# a\n# b\n[manifest]\nmakerVersion \"1.0.0\"\n<<<<<<< HEAD\n\n[bases]\n\n";
    expect(() => parseLockfile(Buffer.from(withConflict, "utf-8"))).toThrowError(LockfileError);
    try {
      parseLockfile(Buffer.from(withConflict, "utf-8"));
    } catch (error) {
      expect((error as LockfileError).kind).toBe("manifest-conflict");
    }
    const truncated = "maker-lockfile 1\n# a\n# b\n[manifest]\nmakerVersion \"1.0.0\"\n\n";
    try {
      parseLockfile(Buffer.from(truncated, "utf-8"));
      expect.fail("deveria lançar");
    } catch (error) {
      expect((error as LockfileError).kind).toBe("manifest-invalid");
    }
  });

  it("L11 — versão desconhecida vira unknown-version; primeira linha inválida vira unreadable", () => {
    const unknownVersion = "maker-lockfile 2\n# a\n# b\n[manifest]\n\n[bases]\n\n";
    try {
      parseLockfile(Buffer.from(unknownVersion, "utf-8"));
      expect.fail("deveria lançar");
    } catch (error) {
      expect((error as LockfileError).kind).toBe("unknown-version");
    }
    try {
      parseLockfile(Buffer.from("isto não é um lockfile", "utf-8"));
      expect.fail("deveria lançar");
    } catch (error) {
      expect((error as LockfileError).kind).toBe("unreadable");
    }
  });

  it("L12 — proxy de merge (node-diff3): edições em entradas file distintas mesclam limpo", () => {
    const m = manifest({ files: {
      "a.md": { hash: "a".repeat(64), source: "engine:common" },
      "b.md": { hash: "b".repeat(64), source: "engine:common" },
    } });
    const base = serializeLockfile(m, new Map()).toString("utf-8").split("\n");
    const localM = manifest({ files: {
      "a.md": { hash: "1".repeat(64), source: "engine:common" },
      "b.md": { hash: "b".repeat(64), source: "engine:common" },
    } });
    const upstreamM = manifest({ files: {
      "a.md": { hash: "a".repeat(64), source: "engine:common" },
      "b.md": { hash: "2".repeat(64), source: "engine:common" },
    } });
    const local = serializeLockfile(localM, new Map()).toString("utf-8").split("\n");
    const upstream = serializeLockfile(upstreamM, new Map()).toString("utf-8").split("\n");
    const result = mergeDiff3(local, base, upstream, { excludeFalseConflicts: true });
    expect(result.conflict).toBe(false);
  });

  it("L12 — duas unidades file novas diferentes no mesmo intervalo geram conflito (documentado)", () => {
    const m = manifest({ files: { "a.md": { hash: "a".repeat(64), source: "engine:common" } } });
    const base = serializeLockfile(m, new Map()).toString("utf-8").split("\n");
    const localM = manifest({ files: {
      "a.md": { hash: "a".repeat(64), source: "engine:common" },
      "novo-local.md": { hash: "1".repeat(64), source: "engine:common" },
    } });
    const upstreamM = manifest({ files: {
      "a.md": { hash: "a".repeat(64), source: "engine:common" },
      "novo-upstream.md": { hash: "2".repeat(64), source: "engine:common" },
    } });
    const local = serializeLockfile(localM, new Map()).toString("utf-8").split("\n");
    const upstream = serializeLockfile(upstreamM, new Map()).toString("utf-8").split("\n");
    // Ambas inserem logo após a mesma linha-âncora ("a.md" + campos): sem linha comum entre as duas
    // inserções, o diff3 não consegue separar os hunks — conflito esperado e documentado.
    const result = mergeDiff3(local, base, upstream, { excludeFalseConflicts: true });
    expect(result.conflict).toBe(true);
  });

  it("L13 — linhas estruturais com \\r: manifest lido, crlf: true; bases utf8 com \\r recuperadas com recovered: true", () => {
    const m = manifest();
    // Conteúdo multilinha sem \r: uma conversão do arquivo inteiro para CRLF (ex.: checkout sem
    // .gitattributes) também converte a quebra de linha interna do conteúdo, mesmo mantendo o
    // `size` declarado (do conteúdo original) intacto.
    const content = Buffer.from("linha1\nlinha2");
    const hash = sha256(content);
    const raw = serializeLockfile(m, new Map([[hash, content]])).toString("utf-8");
    const withCrlf = raw.replace(/\n/g, "\r\n");
    const parsed = parseLockfile(Buffer.from(withCrlf, "utf-8"));
    expect(parsed.crlf).toBe(true);
    expect(parsed.bases.get(hash)).toEqual(content);
    expect(parsed.problems.some((p) => p.hash === hash && p.recovered)).toBe(true);
  });

  it("L14 — base com \\r\\n legítimo alterado de outra forma não é recuperada; \\r\\n intacto é válido sem recuperação", () => {
    const m = manifest();
    const legit = Buffer.from("linha1\r\nlinha2\r\n");
    const hash = sha256(legit);
    const raw = serializeLockfile(m, new Map([[hash, legit]])).toString("utf-8");
    const intact = parseLockfile(Buffer.from(raw, "utf-8"));
    expect(intact.bases.get(hash)).toEqual(legit);
    expect(intact.problems.some((p) => p.hash === hash)).toBe(false);

    const tampered = raw.replace("linha2", "linha3 alterada");
    const parsedTampered = parseLockfile(Buffer.from(tampered, "utf-8"));
    expect(parsedTampered.bases.has(hash)).toBe(false);
  });

  it("L15 — bloco quebrado seguido de linhas de conteúdo até o @end gera um único problema, sem malformed por linha", () => {
    const m = manifest();
    const a = Buffer.from("conteudo a");
    const ha = sha256(a);
    const raw = serializeLockfile(m, new Map([[ha, a]])).toString("utf-8");
    const broken = raw.replace(`size=${a.length} encoding=utf8`, `size=999 encoding=utf8`);
    const parsed = parseLockfile(Buffer.from(broken, "utf-8"));
    const malformed = parsed.problems.filter((p) => p.kind === "malformed");
    expect(malformed.length).toBe(0);
    expect(parsed.problems.some((p) => p.kind === "size-mismatch" || p.kind === "truncated")).toBe(true);
  });

  it("canonicalJson ordena chaves por code unit, não localeCompare", () => {
    expect(canonicalJson({ b: 1, a: 2, Z: 3 })).toBe('{"Z":3,"a":2,"b":1}');
  });
});
