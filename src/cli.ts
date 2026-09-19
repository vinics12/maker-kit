import { Command } from "commander";
import pc from "picocolors";
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runUpdate } from "./commands/update.js";
import { runAdd } from "./commands/add.js";
import { runRemove } from "./commands/remove.js";
import { runRuns } from "./commands/runs.js";
import { runAgentAdd, runAgentList } from "./commands/agent.js";
import { makerVersion } from "./util/version.js";

const program = new Command();

program
  .name("maker")
  .description("Encapsulador do workflow de criação de produtos (motor SpecKit + multi-agente).")
  .version(makerVersion());

program
  .command("init")
  .description("Instala o motor no projeto-alvo.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .option("-c, --config <file>", "caminho para maker.config.json")
  .option("-n, --name <name>", "nome do projeto (modo --yes sem config)")
  .option("-a, --agent <agent>", "CLI agêntica inicial: claude | codex")
  .option("-y, --yes", "não interativo; usa config/defaults")
  .option("-f, --force", "substitui explicitamente arquivos gerados que tenham conteúdo diferente")
  .action(async (opts) => {
    await runInit(opts);
  });

const agent = program.command("agent").description("Gerencia integrações de CLI agêntica.");

agent
  .command("add")
  .argument("<agent>", "integração a adicionar: claude | codex")
  .description("Adiciona outra integração sem remover as já habilitadas.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .option("-c, --config <file>", "config exigida apenas para manifests legados")
  .action(async (provider, opts) => {
    await runAgentAdd(provider, opts);
  });

agent
  .command("list")
  .description("Lista integrações disponíveis, habilitadas e seu estado estrutural.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .action(async (opts) => {
    await runAgentList(opts);
  });

program
  .command("doctor")
  .description("Verifica a integridade de um install contra o manifest.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .action(async (opts) => {
    await runDoctor(opts);
  });

program
  .command("update")
  .description("Atualiza arquivos do motor não modificados localmente.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .action(async (opts) => {
    await runUpdate(opts);
  });

program
  .command("add")
  .argument("<addon>", "id do add-on (ex.: saas)")
  .description("Aplica um add-on sobre um install existente (injeta princípios/agentes/arquivos).")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .option("-s, --set <pair...>", "knob do add-on como nome=valor (repetível)")
  .option("-y, --yes", "não interativo; usa defaults dos knobs")
  .action(async (addon, opts) => {
    await runAdd(addon, opts);
  });

program
  .command("remove")
  .argument("<addon>", "id do add-on (ex.: saas)")
  .description("Remove um add-on aplicado, revertendo injeções e arquivos criados.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .action(async (addon, opts) => {
    await runRemove(addon, opts);
  });

program
  .command("runs")
  .description("Lista runs registrados com custo/tempo por gate + total.")
  .option("-t, --target <dir>", "diretório do projeto (default: cwd)")
  .action(async (opts) => {
    await runRuns(opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(`\nerro: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
