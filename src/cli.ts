import { Command } from "commander";
import pc from "picocolors";
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runUpdate } from "./commands/update.js";
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
  .option("-y, --yes", "não interativo; usa config/defaults")
  .option("-f, --force", "reinstala por cima de um .specify/ existente")
  .action(async (opts) => {
    await runInit(opts);
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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(`\nerro: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
