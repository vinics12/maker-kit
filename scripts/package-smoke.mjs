#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "maker-package-smoke-"));
const externalTarball = process.argv[2] ? resolve(process.argv[2]) : null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} falhou (${result.status ?? "sem status"})\n${result.stdout}${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

try {
  let tarball = externalTarball;
  let packedFiles;

  if (tarball) {
    if (!existsSync(tarball)) throw new Error(`tarball não encontrado: ${tarball}`);
  } else {
    const packOutput = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace]);
    const packResult = JSON.parse(packOutput);
    if (!Array.isArray(packResult) || packResult.length !== 1) {
      throw new Error(`npm pack retornou resultado inesperado: ${packOutput}`);
    }
    tarball = join(workspace, packResult[0].filename);
    packedFiles = packResult[0].files.map(({ path }) => path);
  }

  if (!packedFiles) {
    const inspectOutput = run("npm", ["pack", tarball, "--ignore-scripts", "--json", "--dry-run"]);
    const inspectResult = JSON.parse(inspectOutput);
    packedFiles = inspectResult[0].files.map(({ path }) => path);
  }

  const required = ["package.json", "dist/cli.js"];
  for (const file of required) {
    if (!packedFiles.includes(file)) throw new Error(`arquivo obrigatório ausente do pacote: ${file}`);
  }
  for (const prefix of ["templates/", "addons/"]) {
    if (!packedFiles.some((file) => file.startsWith(prefix))) {
      throw new Error(`diretório obrigatório ausente do pacote: ${prefix}`);
    }
  }
  for (const prefix of ["src/", "test/", ".github/", "specs/"]) {
    if (packedFiles.some((file) => file.startsWith(prefix))) {
      throw new Error(`conteúdo de desenvolvimento incluído no pacote: ${prefix}`);
    }
  }

  const installRoot = join(workspace, "install");
  run("npm", ["install", "--global", "--prefix", installRoot, "--ignore-scripts", tarball]);

  const packageDir = join(installRoot, "lib", "node_modules", "@vinicius.cerqueira", "maker");
  const cli = join(packageDir, "dist", "cli.js");
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

  const version = run(process.execPath, [cli, "--version"], { cwd: workspace });
  if (version !== pkg.version) {
    throw new Error(`versão da CLI (${version}) diverge do pacote (${pkg.version})`);
  }

  for (const args of [
    ["--help"],
    ["doctor", "--help"],
    ["update", "--help"],
    ["runs", "--help"],
  ]) {
    run(process.execPath, [cli, ...args], { cwd: workspace });
  }

  console.log(`✓ ${basename(tarball)} validado (${packedFiles.length} arquivos, maker ${version})`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
