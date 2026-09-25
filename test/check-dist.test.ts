import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findDistIssues } from "../scripts/check-dist.mjs";

const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "maker-dist-test-"));
  workspaces.push(path);
  return path;
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("check-dist", () => {
  it("ignora sourcemap gerado que não é versionado", () => {
    const root = workspace();
    const expected = join(root, "expected");
    const generated = join(root, "generated");
    mkdirSync(expected);
    mkdirSync(generated);
    writeFileSync(join(expected, "cli.js"), "bundle");
    writeFileSync(join(generated, "cli.js"), "bundle");
    writeFileSync(join(generated, "cli.js.map"), "map ignorado");

    expect(findDistIssues(expected, generated).issues).toEqual([]);
  });

  it("continua detectando bundle versionado desatualizado", () => {
    const root = workspace();
    const expected = join(root, "expected");
    const generated = join(root, "generated");
    mkdirSync(expected);
    mkdirSync(generated);
    writeFileSync(join(expected, "cli.js"), "antigo");
    writeFileSync(join(generated, "cli.js"), "novo");

    expect(findDistIssues(expected, generated).issues).toEqual([
      "cli.js: conteúdo desatualizado",
    ]);
  });
});
