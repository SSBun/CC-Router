import type { Command } from "commander";
import { execSync } from "node:child_process";
import { loadConfig, getConfigPath } from "../../config/loader.js";
import picomatch from "picomatch";
import { modelIdWithSuffix } from "../../model-info/resolver.js";

const MODEL_TIERS = [
  { envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL", probeModel: "claude-opus-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL", probeModel: "claude-sonnet-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL", probeModel: "claude-haiku-4-20250514" },
] as const;

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

  cmd
    .command("list")
    .description("List all configured providers and routes")
    .action(() => {
      const config = loadConfig();

      console.log("Providers:\n");
      for (const [name, provider] of Object.entries(config.providers)) {
        console.log(`  ${name}`);
        console.log(`    type:     ${provider.type}`);
        console.log(`    base_url: ${provider.base_url}`);
        if (provider.headers) {
          console.log(`    headers:  ${Object.keys(provider.headers).join(", ")}`);
        }
        if (provider.models && provider.models.length > 0) {
          console.log(`    models:`);
          for (const m of provider.models) {
            const cw = m.max_input_tokens ? ` (${(m.max_input_tokens / 1000).toFixed(0)}K)` : "";
            console.log(`      - ${m.id}${cw}`);
          }
        }
        console.log();
      }

      console.log("Routes:\n");
      for (const route of config.routes) {
        const modelSuffix = route.model ? ` → ${route.model}` : "";
        console.log(`  ${route.match} → ${route.provider}${modelSuffix}`);
      }
    });

  cmd
    .command("env")
    .description("Print environment variable export statements")
    .action(() => {
      const config = loadConfig();
      const { host, port, auth_token } = config.server;

      console.log(`export ANTHROPIC_BASE_URL="http://${host}:${port}"`);
      console.log(`export ANTHROPIC_AUTH_TOKEN="${auth_token}"`);

      for (const tier of MODEL_TIERS) {
        for (const route of config.routes) {
          if (route.match === "*" || route.match === "**") continue;
          if (picomatch(route.match)(tier.probeModel)) {
            const model = modelIdWithSuffix(route.model ?? route.match, config);
            console.log(`export ${tier.envVar}="${model}"`);
            break;
          }
        }
      }
    });

  // Default action: show config
  cmd.action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });
}
