import { describe, expect, it } from "vitest";
import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/**
 * Prova arquitetural (D4/INV-5): fora de `src/state/`, nenhum módulo conhece os caminhos concretos
 * do estado nem escreve manifest/estado fora do plano transacional (`writeManifest` não existe em
 * `src/`, exceto o helper de teste — este teste varre só `src/`).
 */
describe("encapsulamento do estado (src/state/)", () => {
  it("nenhuma ocorrência de manifest.json/maker.lock/.maker/bases/'bases' fora de src/state/", async () => {
    const files = await fg("src/**/*.ts", { cwd: ROOT, absolute: true, ignore: ["src/state/**"] });
    const offenders: string[] = [];
    const patterns: RegExp[] = [
      /manifest\.json/,
      /maker\.lock/,
      /\.maker\/bases/,
      // Segmento de caminho literal ("bases" como argumento avulso, ex. join(x, "bases")) — não a
      // chave de config `state.bases` usada em texto de CLI (`"bases": "files"`), sempre seguida de ":".
      /["']bases["'](?!\s*:)/,
    ];
    for (const file of files) {
      const content = await readFile(file, "utf-8");
      for (const pattern of patterns) {
        if (pattern.test(content)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("o identificador writeManifest não existe em src/", async () => {
    const files = await fg("src/**/*.ts", { cwd: ROOT, absolute: true });
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf-8");
      if (/\bwriteManifest\b/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
