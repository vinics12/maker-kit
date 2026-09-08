import { describe, it, expect } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Prova P1 (FR-024/SC-004): nenhum arquivo de src/ pode invocar subprocesso —
// o stream de eventos e seus consumidores (incluindo diff) rodam em fs puro.
// Varre src/ inteiro (não só src/runs/) via fs, sem shell.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const SHELLOUT = /\bchild_process\b|\bexecSync\b|\bspawn\b/;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    files.push(...((await stat(path)).isDirectory() ? await walk(path) : [path]));
  }
  return files;
}

describe("no-shellout (prova P1)", () => {
  it("zero ocorrências de child_process|execSync|spawn em todo src/", async () => {
    const files = (await walk(SRC)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf-8");
      content.split("\n").forEach((line, i) => {
        if (SHELLOUT.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
