import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import pc from "picocolors";
import fg from "fast-glob";
import { buildContext } from "../render/engine.js";
import { render } from "../render/engine.js";
import { templatesDir } from "../util/scaffold.js";
import {
  readManifest,
  writeManifest,
  sha256,
  manifestKey,
} from "../render/manifest.js";
import { makerVersion } from "../util/version.js";
import { parseConfig } from "../config/schema.js";

export interface UpdateOptions {
  target?: string;
}

/**
 * Refresh conservador: reescreve apenas arquivos do motor que o usuário NÃO
 * modificou desde o install (hash atual == hash no manifest). Arquivos editados
 * localmente são preservados e listados como pulados.
 */
export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const targetDir = resolve(opts.target ?? process.cwd());
  const manifest = await readManifest(targetDir);
  if (!manifest) throw new Error(`Nenhum install do maker em ${targetDir}.`);

  const ctx = buildContext(
    parseConfig({ project: { name: manifest.project.name, slug: manifest.project.slug } }),
  );

  const srcTree = templatesDir("engine");
  const files = await fg("**/*", { cwd: srcTree, dot: true, onlyFiles: true });

  const updated: string[] = [];
  const skipped: string[] = [];

  for (const relSrc of files) {
    const absSrc = join(srcTree, relSrc);
    const isTemplate = relSrc.endsWith(".hbs");
    const relOut = isTemplate ? relSrc.slice(0, -4) : relSrc;
    const absOut = join(targetDir, relOut);
    const key = manifestKey(targetDir, absOut);

    const newContent = isTemplate
      ? Buffer.from(render(await readFile(absSrc, "utf-8"), ctx), "utf-8")
      : await readFile(absSrc);
    const newHash = sha256(newContent);

    if (existsSync(absOut)) {
      const currentHash = sha256(await readFile(absOut));
      const recorded = manifest.files[key]?.hash;
      if (currentHash !== recorded) {
        skipped.push(key); // usuário editou — preserva
        continue;
      }
      if (currentHash === newHash) continue; // idêntico — nada a fazer
    }

    await mkdir(dirname(absOut), { recursive: true });
    if (isTemplate) await writeFile(absOut, newContent);
    else await copyFile(absSrc, absOut);
    manifest.files[key] = { hash: newHash, source: "engine" };
    updated.push(key);
  }

  manifest.makerVersion = makerVersion();
  await writeManifest(targetDir, manifest);

  console.log(pc.green(`✓ ${updated.length} arquivo(s) atualizado(s).`));
  if (skipped.length) {
    console.log(pc.yellow(`${skipped.length} preservado(s) por edição local:`));
    for (const s of skipped) console.log(pc.dim(`  ${s}`));
  }
}
