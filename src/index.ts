import { Command } from "commander";
import { registerStartCommand } from "./cli/commands/start.js";
import { registerStopCommand } from "./cli/commands/stop.js";
import { registerStatusCommand } from "./cli/commands/status.js";
import { registerListCommand } from "./cli/commands/list.js";
import { registerEnvCommand } from "./cli/commands/env.js";
import { registerSetupCommand } from "./cli/commands/setup.js";
import { registerConfigCommand } from "./cli/commands/config.js";
import { registerChatCommand } from "./cli/commands/chat.js";
import { registerRestartCommand } from "./cli/commands/restart.js";
import { registerRouteCommand } from "./cli/commands/route.js";
import { registerInjectCommand } from "./cli/commands/inject.js";
import { registerModelsCommand } from "./cli/commands/models.js";
import { loadConfig } from "./config/loader.js";
import { startServer } from "./server/index.js";
import { printBanner, VERSION } from "./utils/banner.js";

const program = new Command();

program
  .name("cc-router")
  .description(
    "Multi-provider model router for Claude Code — route different models to different LLM providers",
  )
  .version(VERSION);

registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerListCommand(program);
registerEnvCommand(program);
registerSetupCommand(program);
registerConfigCommand(program);
registerChatCommand(program);
registerRestartCommand(program);
registerRouteCommand(program);
registerInjectCommand(program);
registerModelsCommand(program);

// Internal command for daemon mode (forked process runs the server directly)
program
  .command("_serve")
  .description("(Internal) Run the server directly")
  .option("-p, --port <port>", "Override port")
  .option("--verbose", "Enable debug logging")
  .action(async (opts: { port?: string; verbose?: boolean }) => {
    const config = loadConfig();
    if (opts.port) {
      config.server.port = parseInt(opts.port, 10);
    }
    if (opts.verbose) {
      config.log_level = "debug";
    }
    await startServer(config);
  });

if (process.argv.length <= 2) {
  printBanner();
}

program.parse();
