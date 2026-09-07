import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import fg from "fast-glob";
import { render, type RenderContext } from "../render/engine.js";
import { manifestKey, sha256, type ManifestEntry } from "../render/manifest.js";

const HBS_EXT = ".hbs";

/** Raiz do pacote: sobe a partir do módulo atual até achar o package.json do maker. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // fallback: dist/cli.js → raiz
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function templatesDir(sub = ""): string {
  return join(packageRoot(), "templates", sub);
}

export interface AppliedFile {
  rel: string;
  entry: ManifestEntry;
}

/**
 * Aplica uma árvore de templates sobre `targetDir`, espelhando a estrutura.
 * `.hbs` é renderizado (e perde a extensão); todo o resto é copiado verbatim
 * (byte-a-byte), de modo que arquivos stock do SpecKit nunca passam pelo engine.
 * Retorna as entradas de manifest de tudo que escreveu.
 */
export async function applyTree(
  srcTree: string,
  targetDir: string,
  ctx: RenderContext,
  source: string,
): Promise<AppliedFile[]> {
  const files = await fg("**/*", {
    cwd: srcTree,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  const applied: AppliedFile[] = [];
  for (const relSrc of files) {
    const absSrc = join(srcTree, relSrc);
    const isTemplate = relSrc.endsWith(HBS_EXT);
    const relOut = isTemplate ? relSrc.slice(0, -HBS_EXT.length) : relSrc;
    const absOut = join(targetDir, relOut);
    await mkdir(dirname(absOut), { recursive: true });

    let hash: string;
    if (isTemplate) {
      const rendered = render(await readFile(absSrc, "utf-8"), ctx);
      await writeFile(absOut, rendered, "utf-8");
      hash = sha256(rendered);
    } else {
      await copyFile(absSrc, absOut);
      hash = sha256(await readFile(absSrc));
    }
    applied.push({ rel: manifestKey(targetDir, absOut), entry: { hash, source } });
  }
  return applied;
}
