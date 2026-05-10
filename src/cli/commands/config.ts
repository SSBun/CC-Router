import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { loadConfig, getConfigPath } from "../../config/loader.js";
import { execSync } from "node:child_process";

export function registerConfigCommand(program: Command): void {
  const cmd = program.command("config").description("Manage configuration");

  cmd
    .command("show")
    .description("Print current configuration")
    .action(() => {
      const config = loadConfig();
      console.log(JSON.stringify(config, null, 2));
    });

  cmd
    .command("path")
    .description("Print config file path")
    .action(() => {
      console.log(getConfigPath());
    });

  cmd
    .command("edit")
    .description("Open config in $EDITOR")
    .action(() => {
      const configPath = getConfigPath();
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      execSync(`${editor} "${configPath}"`, { stdio: "inherit" });
    });

  // Default action: show config
  cmd.action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });
}
