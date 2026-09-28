import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runUpdate } from "../../src/commands/update.js";
import { runAgentAdd, runAgentList } from "../../src/commands/agent.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { exportMediation } from "../../src/commands/mediation.js";
import { MANIFEST_FILE } from "../../src/state/paths.js";
import { initInstall } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * AC-37: um leitor mínimo do contrato 1.0.0 (install ⇔ `existsSync(".maker/manifest.json")`) concluiria
 * "nenhum install" para qualquer comando mutante contra um install em pack — a mesma conclusão que a
 * 1.0.0 real chegaria, sem escrever nada (não executamos o binário antigo, só a mesma checagem).
 */
function legacyReaderSeesInstall(target: string): boolean {
  return existsSync(join(target, MANIFEST_FILE));
}

describe("compatibilidade com a leitura 1.0.0 (AC-37)", () => {
  it("um install em pack é invisível para o leitor legado, nos comandos mutantes", async () => {
    const target = await initInstall("maker-legacy-reader-", { format: "pack" });
    directories.push(target);
    expect(legacyReaderSeesInstall(target)).toBe(false);

    await expect(runUpdate({ target })).resolves.toBeUndefined();
    // O update de verdade (maker atual) segue operando no lockfile; o ponto do teste é que o
    // leitor 1.0.0 nunca veria manifest.json para agir sobre este install.
    expect(legacyReaderSeesInstall(target)).toBe(false);
  });

  it("add/agent add/mediação/doctor num install em pack: leitor legado conclui 'nenhum install', sem escrever", async () => {
    const target = await initInstall("maker-legacy-reader-cmds-", { format: "pack" });
    directories.push(target);
    expect(legacyReaderSeesInstall(target)).toBe(false);

    await expect(runAgentAdd("codex", { target })).resolves.toBeUndefined();
    expect(legacyReaderSeesInstall(target)).toBe(false);

    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(exportMediation(target, true, [], {})).resolves.toBeUndefined();
    expect(legacyReaderSeesInstall(target)).toBe(false);

    await expect(runDoctor({ target })).resolves.toBeUndefined();
    expect(legacyReaderSeesInstall(target)).toBe(false);

    await expect(runAgentList({ target })).resolves.toBeUndefined();
    expect(legacyReaderSeesInstall(target)).toBe(false);
  });
});
