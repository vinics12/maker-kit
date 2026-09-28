import { afterEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import type { BasesFormat } from "../../src/render/manifest.js";
import { runList } from "../../src/commands/list.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { runAgentAdd } from "../../src/commands/agent.js";
import { removeAddon } from "../../src/addons/apply.js";
import { initInstall, readAddonStates, readManifest } from "../helpers/state.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function outputOf(action: () => Promise<void>): Promise<{ output: string; exitCode: number }> {
  const messages: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => messages.push(args.map(String).join(" "));
  process.exitCode = 0;
  try { await action(); } finally { console.log = originalLog; }
  const output = messages.join("\n").replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "");
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = 0;
  return { output, exitCode };
}

/** Normaliza saídas de doctor/list para comparação entre formatos: remove o rótulo do formato em uso. */
function normalize(output: string): string {
  return output.replace(/íntegro \((files|pack)\)/g, "íntegro (<formato>)");
}

describe("paridade files ↔ pack — mesmo comportamento observável, só o armazenamento difere (AC-46)", () => {
  it("list, agent add codex e doctor produzem status/saídas equivalentes nos dois formatos", async () => {
    const files = await initInstall("maker-addon-parity-files-", { format: "files", addon: "saas" });
    directories.push(files);
    const pack = await initInstall("maker-addon-parity-pack-", { format: "pack", addon: "saas" });
    directories.push(pack);

    const listFiles = await outputOf(() => runList({ target: files }));
    const listPack = await outputOf(() => runList({ target: pack }));
    expect(normalize(listFiles.output)).toBe(normalize(listPack.output));

    await runAgentAdd("codex", { target: files });
    await runAgentAdd("codex", { target: pack });

    const doctorFiles = await outputOf(() => runDoctor({ target: files }));
    const doctorPack = await outputOf(() => runDoctor({ target: pack }));
    expect(doctorFiles.exitCode).toBe(doctorPack.exitCode);
    expect(normalize(doctorFiles.output)).toBe(normalize(doctorPack.output));
  });

  it("o estado do add-on saas é campo a campo idêntico entre os dois formatos (só o local de armazenamento difere)", async () => {
    const files = await initInstall("maker-addon-parity-state-files-", { format: "files", addon: "saas" });
    directories.push(files);
    const pack = await initInstall("maker-addon-parity-state-pack-", { format: "pack", addon: "saas" });
    directories.push(pack);

    const stateFiles = (await readAddonStates(files)).get("saas")!;
    const statePack = (await readAddonStates(pack)).get("saas")!;
    // appliedAt tem timestamps diferentes entre os dois installs (aplicados em momentos distintos).
    const { appliedAt: _a, ...restFiles } = stateFiles;
    const { appliedAt: _b, ...restPack } = statePack;
    expect(restFiles).toEqual(restPack);
  });

  it("remove: mesmos arquivos removidos/preservados e código de saída nos dois formatos", async () => {
    const targets: Record<BasesFormat, string> = {
      files: await initInstall("maker-addon-parity-remove-files-", { format: "files", addon: "saas" }),
      pack: await initInstall("maker-addon-parity-remove-pack-", { format: "pack", addon: "saas" }),
    };
    directories.push(targets.files, targets.pack);

    const results = await Promise.all((["files", "pack"] as const).map(async (format) => {
      const res = await removeAddon(targets[format], "saas");
      return { format, strippedTargets: res.strippedTargets.sort(), deletedFiles: res.deletedFiles.sort(), keptFiles: res.keptFiles.sort() };
    }));
    expect(results[0]!.strippedTargets).toEqual(results[1]!.strippedTargets);
    expect(results[0]!.deletedFiles).toEqual(results[1]!.deletedFiles);
    expect(results[0]!.keptFiles).toEqual(results[1]!.keptFiles);

    const manifestFiles = await readManifest(targets.files);
    const manifestPack = await readManifest(targets.pack);
    const stripManagedOnly = (manifest: NonNullable<typeof manifestFiles>) =>
      Object.keys(manifest.files).sort();
    expect(stripManagedOnly(manifestFiles!)).toEqual(stripManagedOnly(manifestPack!));
  });
});
