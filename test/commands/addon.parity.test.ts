import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BasesFormat } from "../../src/render/manifest.js";
import { runList } from "../../src/commands/list.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { runAgentAdd } from "../../src/commands/agent.js";
import { removeAddon } from "../../src/addons/apply.js";
import { runRemove } from "../../src/commands/remove.js";
import { runUpdate } from "../../src/commands/update.js";
import { DEFAULT_MEDIATION_DIR } from "../../src/commands/mediation.js";
import { sha256 } from "../../src/render/manifest.js";
import { addonStateFile } from "../../src/state/paths.js";
import {
  initInstall, lockfileText, putBase, readAddonStates, readManifest, snapshotTree, writeManifest,
} from "../helpers/state.js";

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

  describe("comparação de conteúdo dos arquivos gerenciados e de comandos com upstream novo", () => {
    const CONSTITUTION = ".specify/memory/constitution.md";
    const FORMATS = ["files", "pack"] as const;

    async function installBoth(prefix: string): Promise<Record<BasesFormat, string>> {
      const targets = {} as Record<BasesFormat, string>;
      for (const format of FORMATS) {
        targets[format] = await initInstall(`${prefix}-${format}-`, { format, addon: "saas" });
        directories.push(targets[format]);
      }
      return targets;
    }

    /** Conteúdo (hash) de todo arquivo fora de `.maker`: o que o consumidor vê, independente do formato do estado. */
    async function managedContent(target: string): Promise<Map<string, string>> {
      const tree = await snapshotTree(target);
      return new Map([...tree].filter(([path]) => !path.startsWith(".maker/")));
    }

    async function addonStatesWithoutTime(target: string): Promise<unknown> {
      const states = await readAddonStates(target);
      return [...states].map(([id, { appliedAt: _appliedAt, ...rest }]) => [id, rest]);
    }

    function scrub(output: string, target: string): string {
      return normalize(output.split(target).join("<dir>"));
    }

    it("update com upstream novo reaplica o add-on: mesmo conteúdo dos arquivos, mesmo estado de add-on, mesma saída", async () => {
      const targets = await installBoth("maker-parity-update");
      const results: { output: string; exitCode: number }[] = [];
      let expected: string | undefined;
      const scratch = await initInstall("maker-parity-update-scratch-", { format: "files" });
      directories.push(scratch);
      const templateWithoutAddon = await readFile(join(scratch, CONSTITUTION), "utf-8");
      for (const format of FORMATS) {
        const target = targets[format];
        const original = await readFile(join(target, CONSTITUTION), "utf-8");
        expected = original;
        const lines = original.split("\n");
        const local = original.replace(lines[0]!, "# titulo antigo");
        const base = templateWithoutAddon.replace(lines[0]!, "# titulo antigo");
        const baseHash = await putBase(target, base);
        await writeFile(join(target, CONSTITUTION), local);
        const manifest = (await readManifest(target))!;
        manifest.files[CONSTITUTION] = { ...manifest.files[CONSTITUTION]!, hash: baseHash, baseHash };
        await writeManifest(target, manifest);

        const result = await outputOf(() => runUpdate({ target }));
        results.push({ output: scrub(result.output, target), exitCode: result.exitCode });
        // O template novo entrou e o bloco do add-on foi reaplicado por cima.
        expect(await readFile(join(target, CONSTITUTION), "utf-8")).toBe(expected);
        expect((await readManifest(target))!.files[CONSTITUTION]!.baseHash).not.toBe(baseHash);
      }
      expect(results[0]).toEqual(results[1]);
      expect(await managedContent(targets.files)).toEqual(await managedContent(targets.pack));
      expect(await addonStatesWithoutTime(targets.files)).toEqual(await addonStatesWithoutTime(targets.pack));
      const filesManifest = (await readManifest(targets.files))!;
      const packManifest = (await readManifest(targets.pack))!;
      expect(filesManifest.files).toEqual(packManifest.files);
    });

    it("--export e --apply-resolutions com conflito: mesmos itens, mesmo conteúdo final e mesmo estado de add-on", async () => {
      const targets = await installBoth("maker-parity-mediation");
      const exported: unknown[] = [];
      for (const format of FORMATS) {
        const target = targets[format];
        const upstream = await readFile(join(target, "AGENTS.md"), "utf-8");
        const first = upstream.split("\n")[0]!;
        const base = upstream.replace(first, "BASE");
        const baseHash = sha256(Buffer.from(base));
        await putBase(target, base);
        await writeFile(join(target, "AGENTS.md"), upstream.replace(first, "LOCAL"));
        const manifest = (await readManifest(target))!;
        manifest.files["AGENTS.md"] = { ...manifest.files["AGENTS.md"]!, hash: baseHash, baseHash };
        await writeManifest(target, manifest);

        const exportResult = await outputOf(() => runUpdate({ target, export: true }));
        const dir = join(target, DEFAULT_MEDIATION_DIR);
        const index = JSON.parse(await readFile(join(dir, "mediation.json"), "utf-8"));
        exported.push({
          output: scrub(exportResult.output, target), exitCode: exportResult.exitCode,
          items: index.items.map((item: { path: string; category: string }) => [item.path, item.category]),
        });
        await writeFile(join(dir, "items", index.items[0].id, "resolved"), upstream);
        const applyResult = await outputOf(() => runUpdate({ target, applyResolutions: true, acceptDropped: true }));
        exported.push({ output: scrub(applyResult.output, target), exitCode: applyResult.exitCode });
        expect(await readFile(join(target, "AGENTS.md"), "utf-8")).toBe(upstream);
      }
      const half = exported.length / 2;
      expect(exported.slice(0, half)).toEqual(exported.slice(half));
      expect(await addonStatesWithoutTime(targets.files)).toEqual(await addonStatesWithoutTime(targets.pack));
      expect(await managedContent(targets.files)).toEqual(await managedContent(targets.pack));
    });

    it("agent add não altera o estado do add-on: [addons] byte a byte em pack, JSON byte a byte em files", async () => {
      const targets = await installBoth("maker-parity-agent");
      const lockBefore = await lockfileText(targets.pack);
      const addonsSection = (text: string): string => text.slice(text.indexOf("[addons]"), text.indexOf("[bases]"));
      const jsonBefore = await readFile(join(targets.files, addonStateFile("saas")));
      expect(addonsSection(lockBefore)).toContain('addon "saas"');

      await runAgentAdd("codex", { target: targets.pack });
      await runAgentAdd("codex", { target: targets.files });

      expect(addonsSection(await lockfileText(targets.pack))).toBe(addonsSection(lockBefore));
      expect(await readFile(join(targets.files, addonStateFile("saas")))).toEqual(jsonBefore);
      expect(await addonStatesWithoutTime(targets.files)).toEqual(await addonStatesWithoutTime(targets.pack));
    });

    it("remove pelo comando: mesma saída, mesmo código de saída e mesmo conteúdo dos arquivos; segunda remoção falha igual", async () => {
      const targets = await installBoth("maker-parity-runremove");
      const outcomes: { output: string; exitCode: number; second: string }[] = [];
      for (const format of FORMATS) {
        const target = targets[format];
        const result = await outputOf(() => runRemove("saas", { target }));
        const second = await runRemove("saas", { target }).then(() => "sem erro", (error: Error) => error.message);
        outcomes.push({ output: scrub(result.output, target), exitCode: result.exitCode, second: scrub(second, target) });
      }
      expect(outcomes[0]).toEqual(outcomes[1]);
      expect(outcomes[0]!.output).toContain('Add-on "saas" removido');
      expect(outcomes[0]!.second).toContain('Add-on "saas" não está aplicado em <dir>.');
      expect(await managedContent(targets.files)).toEqual(await managedContent(targets.pack));
      expect((await readAddonStates(targets.files)).size).toBe(0);
      expect((await readAddonStates(targets.pack)).size).toBe(0);
    });
  });
});
