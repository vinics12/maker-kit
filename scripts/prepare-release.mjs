#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDir = resolve(process.argv[2] ?? "");
const tag = process.argv[3];

if (!process.argv[2] || !tag) {
  throw new Error("uso: node scripts/prepare-release.mjs <output-dir> <vX.Y.Z>");
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (tag !== `v${pkg.version}`) {
  throw new Error(`tag ${tag} diverge da versão ${pkg.version} do package.json`);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", outputDir], {
  cwd: root,
  encoding: "utf8",
});
if (packed.status !== 0) {
  throw new Error(`npm pack falhou\n${packed.stdout}${packed.stderr}`);
}

const result = JSON.parse(packed.stdout);
if (!Array.isArray(result) || result.length !== 1) {
  throw new Error(`npm pack retornou resultado inesperado: ${packed.stdout}`);
}

const generated = join(outputDir, basename(result[0].filename));
const tarball = join(outputDir, "maker.tgz");
renameSync(generated, tarball);

const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
writeFileSync(join(outputDir, "maker.tgz.sha256"), `${digest}  maker.tgz\n`);

console.log(`✓ release ${tag} preparada em ${tarball}`);
