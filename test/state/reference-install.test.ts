import { afterEach, describe, expect, it } from "vitest";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { BASES_DIR, LOCKFILE, MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** Lê os padrões do `.maker/.gitignore` gerado (não um duplicado hard-coded do contrato). */
async function gitignorePatterns(target: string): Promise<string[]> {
  const raw = await readFile(join(target, ".maker/.gitignore"), "utf-8");
  return raw.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    .map((pattern) => pattern.replace(/^\//, "").replace(/\/$/, ""));
}

/** Padrões âncorados na raiz de `.maker`, sem glob (o `.gitignore` gerado só usa `/<nome>/` e `/<nome>`). */
function isIgnored(relPathInMaker: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => relPathInMaker === pattern || relPathInMaker.startsWith(`${pattern}/`));
}

async function walk(dir: string, root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, root)));
    else out.push(relative(root, abs).split("\\").join("/"));
  }
  return out;
}

describe("install de referência: Claude + Codex + add-on saas (SC-001, SC-008)", () => {
  it("SC-001: ≤ 16 arquivos versionados em .maker no default, sem opt-in, já no init", async () => {
    const target = await initInstall("maker-reference-sc001-", { agents: ["claude", "codex"], addon: "saas" });
    directories.push(target);

    const makerDir = join(target, ".maker");
    const patterns = await gitignorePatterns(target);
    const versioned = (await walk(makerDir, makerDir)).filter((rel) => !isIgnored(rel, patterns));
    expect(versioned.length).toBeLessThanOrEqual(16);

    const controlFiles = versioned.filter((rel) => rel === ".gitattributes" || rel === ".gitignore");
    expect(controlFiles).toHaveLength(2);
    // 14 arquivos de estado/conteúdo (lockfile + estado de add-on + papéis de workflow) + 2 de controle.
    expect(versioned.length - controlFiles.length).toBeLessThanOrEqual(14);
    expect(versioned).toContain("maker.lock");
    // pack: sem .maker/bases/ nem .maker/manifest.json (formato "files").
    expect(versioned.some((rel) => rel === "bases" || rel.startsWith("bases/"))).toBe(false);
    expect(versioned).not.toContain("manifest.json");
  });
});

describe("install de referência: tamanho do lockfile compacto (SC-008)", () => {
  it("SC-008: o lockfile não excede a soma das bases por arquivo mais o overhead de cabeçalhos e do base64", async () => {
    const filesTarget = await initInstall("maker-reference-sc008-files-", { agents: ["claude", "codex"], addon: "saas", format: "files" });
    directories.push(filesTarget);
    const packTarget = await initInstall("maker-reference-sc008-pack-", { agents: ["claude", "codex"], addon: "saas", format: "pack" });
    directories.push(packTarget);

    const basesDir = join(filesTarget, BASES_DIR);
    let basesTotal = 0;
    // Overhead independente do codec: recalculado a partir da gramática do contrato (bytes de
    // `@base .../@end ...` por bloco e a expansão do base64), não do `serializeLockfile` testado.
    let headerOverhead = 0;
    for (const hash of await readdir(basesDir)) {
      const content = await readFile(join(basesDir, hash));
      basesTotal += content.length;
      let encoding: "utf8" | "base64" = "utf8";
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        encoding = "base64";
      }
      const header = `@base sha256=${hash} size=${content.length} encoding=${encoding}\n`;
      const footer = `@end sha256=${hash}\n`;
      const blankLine = 1;
      const payloadLen = encoding === "utf8"
        ? content.length + 1 // conteúdo + "\n" antes do "@end"
        : (() => {
          const b64 = content.toString("base64");
          const lines = content.length === 0 ? 0 : Math.ceil(b64.length / 76);
          return b64.length + lines; // uma "\n" por linha de base64
        })();
      headerOverhead += header.length + payloadLen + footer.length + blankLine - content.length;
    }
    const manifestJsonSize = (await stat(join(filesTarget, MANIFEST_FILE))).size;
    const lockfileSize = (await stat(join(packTarget, LOCKFILE))).size;

    // manifest.json é uma cota superior generosa da seção [manifest] do lockfile (mesmos dados, texto
    // JSON tende a ser maior que o formato "chave valor" por linha do lockfile).
    expect(lockfileSize).toBeLessThanOrEqual(basesTotal + headerOverhead + manifestJsonSize);
  });
});
