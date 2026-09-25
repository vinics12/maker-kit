#!/usr/bin/env node

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function filesUnder(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(directory, path));
    }
  };
  visit(directory);
  return files.sort();
}

function comparableContent(path) {
  const content = readFileSync(path);
  if (!path.endsWith(".map")) return content;

  const map = JSON.parse(content.toString("utf8"));
  map.sources = map.sources.map((source) => {
    const srcIndex = source.lastIndexOf("/src/");
    return srcIndex >= 0 ? `../src/${source.slice(srcIndex + 5)}` : source;
  });
  return Buffer.from(JSON.stringify(map));
}

export function findDistIssues(expectedDir, generatedDir) {
  const expectedFiles = filesUnder(expectedDir);
  const generatedFiles = filesUnder(generatedDir);
  const issues = [];

  // Only tracked artifacts define the contract. tsup may generate auxiliary
  // files such as ignored sourcemaps that are intentionally absent in a clean checkout.
  for (const file of expectedFiles) {
    if (!generatedFiles.includes(file)) issues.push(`${file}: não é mais gerado`);
    else if (!comparableContent(join(expectedDir, file)).equals(comparableContent(join(generatedDir, file)))) {
      issues.push(`${file}: conteúdo desatualizado`);
    }
  }

  return { expectedFiles, issues };
}

function main() {
  const expectedDir = join(root, "dist");
  const workspace = mkdtempSync(join(tmpdir(), "maker-dist-check-"));
  const generatedDir = join(workspace, "dist");

  try {
    const build = spawnSync("pnpm", ["exec", "tsup", "--out-dir", generatedDir], {
      cwd: root,
      encoding: "utf8",
    });
    if (build.status !== 0) {
      throw new Error(`build de conferência falhou\n${build.stdout}${build.stderr}`);
    }

    const { expectedFiles, issues } = findDistIssues(expectedDir, generatedDir);
    if (issues.length) {
      throw new Error(`dist/ diverge do fonte; rode pnpm build:\n- ${issues.join("\n- ")}`);
    }

    console.log(`✓ dist/ reproduzível (${expectedFiles.length} arquivos versionados)`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
