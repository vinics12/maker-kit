import { createHash } from "node:crypto";
import { z } from "zod";
import type { Manifest } from "../render/manifest.js";
import { addonStateSchema, isAddonId, isLockfileSerializable, type AddonStateRecord } from "./addon-state.js";

export const LOCKFILE_VERSION = 1;

const HEADER_COMMENT_LINES = [
  "# Estado do maker (manifest, add-ons e bases). Gerado pela CLI — não edite à mão.",
  "# Formato e recuperação: docs/maker-state.md do maker.",
];

const BASE_HEADER = /^@base sha256=([0-9a-f]{64}) size=(\d+) encoding=(utf8|base64)$/;
const BASE_END = (hash: string) => new RegExp(`^@end sha256=${hash}$`);
const CONFLICT_MARKER = /^(<{7}|={7}|>{7}|\|{7})( |$)/;
const BASE64_LINE = /^[A-Za-z0-9+/]*=*$/;

const manifestEntrySchema = z
  .object({
    hash: z.string(),
    source: z.string(),
    baseHash: z.string().optional(),
    edited: z.boolean().optional(),
  })
  .passthrough();

export const manifestSchema = z
  .object({
    makerVersion: z.string(),
    project: z.object({ name: z.string(), slug: z.string() }).passthrough(),
    installedAt: z.string(),
    files: z.record(z.string(), manifestEntrySchema),
    basesFormat: z.enum(["files", "pack"]).optional(),
  })
  .passthrough();

export type BaseProblemKind = "hash-mismatch" | "size-mismatch" | "truncated" | "malformed";

export interface BaseProblem {
  origin: "pack" | "files";
  kind: BaseProblemKind;
  hash?: string;
  detail: string;
  line?: number;
  recovered?: boolean;
}

export interface ParsedLockfile {
  version: 1;
  manifest: Manifest;
  addons: Map<string, AddonStateRecord>;
  bases: Map<string, Buffer>;
  problems: BaseProblem[];
  conflictMarkers: number;
  crlf: boolean;
}

export type LockfileErrorKind =
  | "unreadable" | "unknown-version" | "manifest-invalid" | "manifest-conflict"
  | "addons-invalid" | "addons-conflict";

export class LockfileError extends Error {
  readonly kind: LockfileErrorKind;
  readonly line?: number;
  constructor(kind: LockfileErrorKind, message: string, line?: number) {
    super(message);
    this.kind = kind;
    this.line = line;
  }
}

/** JSON canônico: chaves de objeto ordenadas recursivamente (code unit), sem espaços; arrays na ordem original. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted = Object.keys(value as Record<string, unknown>).sort(codeUnitCompare);
    const out: Record<string, unknown> = {};
    for (const key of sorted) out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isUtf8(content: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

function serializeBase(hash: string, content: Buffer): string {
  const utf8 = isUtf8(content);
  const encoding = utf8 ? "utf8" : "base64";
  const header = `@base sha256=${hash} size=${content.length} encoding=${encoding}\n`;
  let payload: string;
  if (utf8) {
    payload = `${content.toString("utf-8")}\n`;
  } else {
    const b64 = content.toString("base64");
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
    payload = lines.map((line) => `${line}\n`).join("");
  }
  return `${header}${payload}@end sha256=${hash}\n\n`;
}

export function serializeLockfile(
  manifest: Manifest,
  bases: ReadonlyMap<string, Buffer>,
  addons?: ReadonlyMap<string, AddonStateRecord>,
): Buffer {
  const lines: string[] = [];
  lines.push(`maker-lockfile ${LOCKFILE_VERSION}`);
  for (const comment of HEADER_COMMENT_LINES) lines.push(comment);
  lines.push("");
  lines.push("[manifest]");

  const { files, config, ...rest } = manifest as Manifest & { config?: { state?: unknown } };
  const withoutState = config ? withoutStateKey(config) : config;
  const metaSource: Record<string, unknown> = { ...rest };
  if (config !== undefined) metaSource.config = withoutState;
  // Chave presente com valor `undefined` (em vez de simplesmente ausente) não vira linha — mesmo
  // comportamento de JSON.stringify(objeto), que omite essas chaves.
  const metaKeys = Object.keys(metaSource).filter((key) => metaSource[key] !== undefined).sort(codeUnitCompare);
  for (const key of metaKeys) {
    lines.push(`${key} ${canonicalJson(metaSource[key])}`);
  }
  lines.push("");

  const paths = Object.keys(files ?? {}).sort(codeUnitCompare);
  for (const path of paths) {
    lines.push(`file ${canonicalJson(path)}`);
    const entry = (files as unknown as Record<string, Record<string, unknown>>)[path]!;
    const fieldKeys = Object.keys(entry).filter((key) => entry[key] !== undefined).sort(codeUnitCompare);
    for (const key of fieldKeys) lines.push(`  ${key} ${canonicalJson(entry[key])}`);
    lines.push("");
  }

  lines.push("[addons]");
  lines.push("");
  const addonIds = [...(addons?.keys() ?? [])].sort(codeUnitCompare);
  for (const id of addonIds) {
    const record = addons!.get(id)!;
    const reason = isLockfileSerializable(record);
    if (reason) throw new Error(`add-on "${id}" não serializável no lockfile: ${reason}`);
    lines.push(`addon ${canonicalJson(id)}`);
    const fieldKeys = Object.keys(record)
      .filter((key) => key !== "id" && record[key] !== undefined)
      .sort(codeUnitCompare);
    for (const key of fieldKeys) lines.push(`  ${key} ${canonicalJson(record[key])}`);
    lines.push("");
  }

  lines.push("[bases]");
  lines.push("");
  let body = lines.map((line) => `${line}\n`).join("");
  const hashes = [...bases.keys()].sort(codeUnitCompare);
  for (const hash of hashes) body += serializeBase(hash, bases.get(hash)!);
  return Buffer.from(body, "utf-8");
}

function withoutStateKey(config: Record<string, unknown>): Record<string, unknown> {
  const { state: _state, ...rest } = config;
  return rest;
}

export function parseLockfile(raw: Buffer): ParsedLockfile {
  const text = raw.toString("utf-8");
  const rawLines = text.split("\n");
  // Um `\n` final vira uma última linha vazia; removemos para trabalhar com linhas reais.
  if (rawLines.length && rawLines[rawLines.length - 1] === "") rawLines.pop();

  let crlf = false;
  const lines = rawLines.map((line) => {
    if (line.endsWith("\r")) {
      crlf = true;
      return line.slice(0, -1);
    }
    return line;
  });

  const headerMatch = lines[0]?.match(/^maker-lockfile (\d+)$/);
  if (!headerMatch) throw new LockfileError("unreadable", "cabeçalho ausente ou ilegível na linha 1", 1);
  const version = Number(headerMatch[1]);
  if (version !== LOCKFILE_VERSION) {
    throw new LockfileError("unknown-version", `versão de lockfile desconhecida: ${version}`, 1);
  }

  let i = 1;
  while (i < lines.length && lines[i]!.startsWith("# ")) i++;
  if (lines[i] !== "") {
    throw new LockfileError("manifest-invalid", `esperada linha vazia antes de [manifest] na linha ${i + 1}`, i + 1);
  }
  i++;
  if (lines[i] !== "[manifest]") {
    throw new LockfileError("manifest-invalid", "seção [manifest] ausente", i + 1);
  }
  i++;

  const bracketAddonsIndex = lines.findIndex((line, index) => index >= i && line === "[addons]");
  const bracketBasesFallback = lines.findIndex((line, index) => index >= i && line === "[bases]");
  if (bracketAddonsIndex < 0) {
    if (bracketBasesFallback < 0) {
      throw new LockfileError("manifest-invalid", "seção [bases] ausente (arquivo truncado)", lines.length);
    }
    throw new LockfileError("addons-invalid", "seção [addons] ausente", bracketBasesFallback + 1);
  }

  const manifestLines = lines.slice(i, bracketAddonsIndex);
  const { manifestObject } = parseManifestSection(manifestLines, i + 1);
  const parsedManifest = manifestSchema.safeParse(manifestObject);
  if (!parsedManifest.success) {
    throw new LockfileError("manifest-invalid", `manifest inválido: ${parsedManifest.error.message}`, i + 1);
  }

  const bracketBasesIndex = lines.findIndex((line, index) => index > bracketAddonsIndex && line === "[bases]");
  if (bracketBasesIndex < 0) {
    throw new LockfileError("addons-invalid", "seção [bases] ausente (arquivo truncado)", lines.length);
  }

  const addonsLines = lines.slice(bracketAddonsIndex + 1, bracketBasesIndex);
  const addons = parseAddonsSection(addonsLines, bracketAddonsIndex + 2);

  // A seção de bases usa as linhas cruas (não stripadas) para reconstruir o conteúdo byte a byte;
  // `lines` (stripadas) serve só para casar cabeçalhos/`@end`/marcadores, tolerando `\r` estrutural
  // sem descartar um `\r` legítimo dentro do conteúdo de uma base utf8.
  const basesLines = lines.slice(bracketBasesIndex + 1);
  const rawBasesLines = rawLines.slice(bracketBasesIndex + 1);
  const { bases, problems, conflictMarkers } = parseBasesSection(basesLines, rawBasesLines, bracketBasesIndex + 2);

  return {
    version: 1,
    manifest: parsedManifest.data as unknown as Manifest,
    addons,
    bases,
    problems,
    conflictMarkers,
    crlf,
  };
}

function parseAddonsSection(lines: string[], startLineNumber: number): Map<string, AddonStateRecord> {
  const lineNo = (offset: number) => startLineNumber + offset;
  const addons = new Map<string, AddonStateRecord>();
  if (lines.length === 0) return addons;

  if (lines[0] !== "") {
    if (CONFLICT_MARKER.test(lines[0]!)) {
      throw new LockfileError("addons-conflict", `marcador de conflito na linha ${lineNo(0)}`, lineNo(0));
    }
    throw new LockfileError("addons-invalid", `esperada linha vazia após [addons] na linha ${lineNo(0)}`, lineNo(0));
  }
  let index = 1;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line === "") {
      throw new LockfileError("addons-invalid", `linha vazia inesperada na seção [addons] na linha ${lineNo(index)}`, lineNo(index));
    }
    if (CONFLICT_MARKER.test(line)) {
      throw new LockfileError("addons-conflict", `marcador de conflito na linha ${lineNo(index)}`, lineNo(index));
    }
    const unitMatch = line.match(/^addon (.+)$/);
    if (!unitMatch) {
      throw new LockfileError("addons-invalid", `linha fora da gramática na linha ${lineNo(index)}`, lineNo(index));
    }
    let id: unknown;
    try {
      id = JSON.parse(unitMatch[1]!);
    } catch {
      throw new LockfileError("addons-invalid", `id inválido na linha ${lineNo(index)}`, lineNo(index));
    }
    if (typeof id !== "string" || !isAddonId(id)) {
      throw new LockfileError("addons-invalid", `id de add-on inválido na linha ${lineNo(index)}`, lineNo(index));
    }
    if (addons.has(id)) {
      throw new LockfileError("addons-invalid", `"addon" duplicado "${id}" na linha ${lineNo(index)}`, lineNo(index));
    }
    index++;
    const fields: Record<string, unknown> = {};
    let fieldCount = 0;
    while (index < lines.length && lines[index]!.startsWith("  ")) {
      const fieldLine = lines[index]!;
      if (CONFLICT_MARKER.test(fieldLine.trimStart())) {
        throw new LockfileError("addons-conflict", `marcador de conflito na linha ${lineNo(index)}`, lineNo(index));
      }
      const fieldMatch = fieldLine.match(/^ {2}([A-Za-z][A-Za-z0-9]*) (.+)$/);
      if (!fieldMatch) {
        throw new LockfileError("addons-invalid", `campo fora da gramática na linha ${lineNo(index)}`, lineNo(index));
      }
      const [, fieldKey, fieldJson] = fieldMatch;
      if (fieldKey === "id") {
        throw new LockfileError("addons-invalid", `campo "id" reservado na linha ${lineNo(index)}`, lineNo(index));
      }
      if (Object.hasOwn(fields, fieldKey!)) {
        throw new LockfileError("addons-invalid", `campo "${fieldKey}" duplicado em "${id}" na linha ${lineNo(index)}`, lineNo(index));
      }
      try {
        fields[fieldKey!] = JSON.parse(fieldJson!);
      } catch {
        throw new LockfileError("addons-invalid", `JSON inválido na linha ${lineNo(index)}`, lineNo(index));
      }
      fieldCount++;
      index++;
    }
    if (fieldCount === 0) {
      throw new LockfileError("addons-invalid", `unidade "addon ${id}" sem campos na linha ${lineNo(index)}`, lineNo(index));
    }
    if (index < lines.length) {
      if (lines[index] !== "") {
        if (CONFLICT_MARKER.test(lines[index]!)) {
          throw new LockfileError("addons-conflict", `marcador de conflito na linha ${lineNo(index)}`, lineNo(index));
        }
        throw new LockfileError("addons-invalid", `esperada linha vazia após a unidade "addon ${id}" na linha ${lineNo(index)}`, lineNo(index));
      }
      index++;
    }
    const parsed = addonStateSchema.passthrough().safeParse({ id, ...fields });
    if (!parsed.success) {
      throw new LockfileError("addons-invalid", `unidade "addon ${id}" inválida: ${parsed.error.message}`, lineNo(index));
    }
    addons.set(id, parsed.data as AddonStateRecord);
  }

  return addons;
}

function parseManifestSection(
  lines: string[],
  startLineNumber: number,
): { manifestObject: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  const files: Record<string, Record<string, unknown>> = {};
  let index = 0;
  const lineNo = (offset: number) => startLineNumber + offset;

  while (index < lines.length && lines[index] !== "" && !lines[index]!.startsWith("file ")) {
    const line = lines[index]!;
    if (CONFLICT_MARKER.test(line)) {
      throw new LockfileError("manifest-conflict", `marcador de conflito na linha ${lineNo(index)}`, lineNo(index));
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*) (.+)$/);
    if (!match) throw new LockfileError("manifest-invalid", `linha fora da gramática na linha ${lineNo(index)}`, lineNo(index));
    const [, key, jsonText] = match;
    if (key === "files") throw new LockfileError("manifest-invalid", `chave reservada "files" na linha ${lineNo(index)}`, lineNo(index));
    if (Object.hasOwn(meta, key!)) throw new LockfileError("manifest-invalid", `meta-line duplicada "${key}" na linha ${lineNo(index)}`, lineNo(index));
    try {
      meta[key!] = JSON.parse(jsonText!);
    } catch {
      throw new LockfileError("manifest-invalid", `JSON inválido na linha ${lineNo(index)}`, lineNo(index));
    }
    index++;
  }
  if (index >= lines.length) {
    throw new LockfileError("manifest-invalid", "seção [manifest] truncada (sem separador antes de [bases])", lineNo(index));
  }
  if (lines[index] !== "") {
    throw new LockfileError("manifest-invalid", `esperada linha vazia na linha ${lineNo(index)}`, lineNo(index));
  }
  index++;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line === "") { index++; continue; }
    if (CONFLICT_MARKER.test(line)) {
      throw new LockfileError("manifest-conflict", `marcador de conflito na linha ${lineNo(index)}`, lineNo(index));
    }
    const fileMatch = line.match(/^file (.+)$/);
    if (!fileMatch) throw new LockfileError("manifest-invalid", `linha fora da gramática na linha ${lineNo(index)}`, lineNo(index));
    let path: string;
    try {
      path = JSON.parse(fileMatch[1]!);
    } catch {
      throw new LockfileError("manifest-invalid", `caminho inválido na linha ${lineNo(index)}`, lineNo(index));
    }
    if (typeof path !== "string") throw new LockfileError("manifest-invalid", `caminho inválido na linha ${lineNo(index)}`, lineNo(index));
    if (Object.hasOwn(files, path)) throw new LockfileError("manifest-invalid", `"file" duplicado "${path}" na linha ${lineNo(index)}`, lineNo(index));
    index++;
    const entry: Record<string, unknown> = {};
    while (index < lines.length && lines[index]!.startsWith("  ")) {
      const fieldLine = lines[index]!;
      if (CONFLICT_MARKER.test(fieldLine.trimStart())) {
        throw new LockfileError("manifest-conflict", `marcador de conflito na linha ${lineNo(index)}`, lineNo(index));
      }
      const fieldMatch = fieldLine.match(/^ {2}([A-Za-z][A-Za-z0-9]*) (.+)$/);
      if (!fieldMatch) throw new LockfileError("manifest-invalid", `campo de file fora da gramática na linha ${lineNo(index)}`, lineNo(index));
      const [, fieldKey, fieldJson] = fieldMatch;
      if (Object.hasOwn(entry, fieldKey!)) {
        throw new LockfileError("manifest-invalid", `campo "${fieldKey}" duplicado em "${path}" na linha ${lineNo(index)}`, lineNo(index));
      }
      try {
        entry[fieldKey!] = JSON.parse(fieldJson!);
      } catch {
        throw new LockfileError("manifest-invalid", `JSON inválido na linha ${lineNo(index)}`, lineNo(index));
      }
      index++;
    }
    files[path] = entry;
  }

  return { manifestObject: { ...meta, files } };
}

function parseBasesSection(
  lines: string[],
  rawLines: string[],
  startLineNumber: number,
): { bases: Map<string, Buffer>; problems: BaseProblem[]; conflictMarkers: number } {
  const bases = new Map<string, Buffer>();
  const problems: BaseProblem[] = [];
  let conflictMarkers = 0;
  let index = 0;
  const lineNo = (offset: number) => startLineNumber + offset;
  /** Até esta linha (exclusive) o conteúdo pertence à extensão de um bloco já reportado quebrado. */
  let malformedExtentEnd = -1;
  let malformedRunActive = false;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line === "") { index++; malformedRunActive = false; continue; }
    if (CONFLICT_MARKER.test(line)) { conflictMarkers++; index++; malformedRunActive = false; continue; }

    const headerMatch = line.match(BASE_HEADER);
    if (headerMatch) {
      malformedRunActive = false;
      const headerIndex = index;
      const [, hash, sizeText, encoding] = headerMatch as unknown as [string, string, string, "utf8" | "base64"];
      const size = Number(sizeText);
      const result = tryParseBlock(lines, rawLines, index + 1, hash!, size, encoding);
      if (result.kind === "ok") {
        const content = result.content;
        const digest = sha256hex(content);
        if (digest === hash && result.recovered) {
          bases.set(hash!, content);
          problems.push({ origin: "pack", kind: "hash-mismatch", hash, detail: "conteúdo recuperado (\\r\\n → \\n)", line: lineNo(index), recovered: true });
        } else if (digest === hash) {
          bases.set(hash!, content);
        } else {
          const recoveredContent = tryCrlfRecovery(content, hash!);
          if (recoveredContent) {
            bases.set(hash!, recoveredContent);
            problems.push({ origin: "pack", kind: "hash-mismatch", hash, detail: "conteúdo recuperado (\\r\\n → \\n)", line: lineNo(index), recovered: true });
          } else {
            problems.push({ origin: "pack", kind: "hash-mismatch", hash, detail: "sha256 do conteúdo não confere com o hash declarado", line: lineNo(index) });
          }
        }
        index = result.nextIndex;
        continue;
      }
      if (result.kind === "size-mismatch") {
        problems.push({ origin: "pack", kind: "size-mismatch", hash, detail: `tamanho declarado ${size}, conteúdo ${result.actualSize}`, line: lineNo(index) });
        // Retoma na linha seguinte ao cabeçalho quebrado (não confia no `size`), testando cada linha
        // como possível cabeçalho; a extensão até o `@end` encontrado só suprime `malformed` redundante.
        malformedExtentEnd = result.extentEnd;
        index = headerIndex + 1;
        continue;
      }
      // truncated: não achou @end à frente. Também retoma na linha seguinte ao cabeçalho quebrado.
      problems.push({ origin: "pack", kind: "truncated", hash, detail: "bloco truncado; @end não encontrado", line: lineNo(index) });
      index = headerIndex + 1;
      malformedRunActive = false;
      continue;
    }

    // Linha fora da gramática: suprime `malformed` redundante dentro da extensão de um bloco já reportado.
    if (index < malformedExtentEnd) { index++; continue; }
    if (!malformedRunActive) {
      problems.push({ origin: "pack", kind: "malformed", detail: `linha fora da gramática de bases: "${line}"`, line: lineNo(index) });
      malformedRunActive = true;
    }
    index++;
  }

  return { bases, problems, conflictMarkers };
}

type BlockResult =
  | { kind: "ok"; content: Buffer; nextIndex: number; recovered?: boolean }
  | { kind: "size-mismatch"; actualSize: number; extentEnd: number }
  | { kind: "truncated" };

function tryParseBlock(
  lines: string[],
  rawLines: string[],
  bodyStart: number,
  hash: string,
  size: number,
  encoding: "utf8" | "base64",
): BlockResult {
  if (encoding === "utf8") {
    // O payload utf8 é `size` bytes seguidos de "\n"; como já quebramos por "\n", reconstituímos
    // juntando linhas CRUAS (sem strip de `\r`) até que o total de bytes (contando os "\n"
    // reintroduzidos) alcance `size` — um `\r` legítimo dentro do conteúdo nunca é descartado aqui;
    // `lines` (stripadas) só é usada para achar o `@end` que fecha o bloco.
    let consumed = 0;
    let bytes = 0;
    const parts: string[] = [];
    while (bodyStart + consumed < rawLines.length) {
      const line = rawLines[bodyStart + consumed]!;
      const withNewline = bytes > 0 || parts.length > 0 ? `\n${line}` : line;
      const chunkBytes = Buffer.byteLength(withNewline, "utf-8");
      if (bytes + chunkBytes > size) break;
      parts.push(line);
      bytes += chunkBytes;
      consumed++;
      if (bytes === size) break;
    }
    const content = Buffer.from(parts.join("\n"), "utf-8");
    const endLineIndex = bodyStart + consumed;
    const endLine = lines[endLineIndex];
    if (content.length === size && endLine !== undefined && BASE_END(hash).test(endLine)) {
      return { kind: "ok", content, nextIndex: endLineIndex + 1 };
    }
    // Procura @end adiante (sempre existe se a estrutura estiver íntegra); a extensão até ele só
    // suprime `malformed` redundante — a ressincronização em si volta para logo após o cabeçalho.
    const found = findEnd(lines, bodyStart, hash);
    if (found < 0) return { kind: "truncated" };
    const actualRaw = Buffer.from(rawLines.slice(bodyStart, found).join("\n"), "utf-8");
    if (actualRaw.length === size) return { kind: "ok", content: actualRaw, nextIndex: found + 1 };
    // O `size` declarado é do conteúdo original: quando o arquivo inteiro foi convertido para CRLF,
    // toda quebra de linha interna ao conteúdo também virou `\r\n` — inclusive o `\n` do delimitador
    // entre o fim do conteúdo e o `@end` (o `\r` final de `actualRaw` pertence a esse delimitador, não
    // ao conteúdo). Descarta esse `\r` final antes de normalizar, para que blocos multilinha também
    // se qualifiquem para a recuperação (o chamador ainda confere o sha256 do resultado).
    const withoutDelimiterCr = actualRaw.length && actualRaw[actualRaw.length - 1] === 0x0d
      ? actualRaw.subarray(0, -1) : actualRaw;
    if (withoutDelimiterCr.toString("utf-8").includes("\r\n")) {
      const normalized = Buffer.from(withoutDelimiterCr.toString("utf-8").replace(/\r\n/g, "\n"), "utf-8");
      if (normalized.length === size) return { kind: "ok", content: normalized, nextIndex: found + 1, recovered: true };
    }
    return { kind: "size-mismatch", actualSize: actualRaw.length, extentEnd: found + 1 };
  }

  let index = bodyStart;
  const b64Lines: string[] = [];
  while (index < lines.length) {
    const line = lines[index]!;
    if (BASE_END(hash).test(line)) {
      const decoded = Buffer.from(b64Lines.join(""), "base64");
      if (decoded.length !== size) return { kind: "size-mismatch", actualSize: decoded.length, extentEnd: index + 1 };
      return { kind: "ok", content: decoded, nextIndex: index + 1 };
    }
    if (!BASE64_LINE.test(line)) {
      const found = findEnd(lines, bodyStart, hash);
      if (found < 0) return { kind: "truncated" };
      const decoded = Buffer.from(b64Lines.join(""), "base64");
      return { kind: "size-mismatch", actualSize: decoded.length, extentEnd: found + 1 };
    }
    b64Lines.push(line);
    index++;
  }
  return { kind: "truncated" };
}

function findEnd(lines: string[], from: number, hash: string): number {
  const pattern = BASE_END(hash);
  for (let index = from; index < lines.length; index++) {
    if (pattern.test(lines[index]!)) return index;
  }
  return -1;
}

function tryCrlfRecovery(content: Buffer, hash: string): Buffer | null {
  const text = content.toString("utf-8");
  if (!text.includes("\r\n")) return null;
  const normalized = Buffer.from(text.replace(/\r\n/g, "\n"), "utf-8");
  return sha256hex(normalized) === hash ? normalized : null;
}
