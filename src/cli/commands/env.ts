import type { Command } from "commander";
import picomatch from "picomatch";
import { loadConfig } from "../../config/loader.js";
import { modelIdWithSuffix } from "../../model-info/resolver.js";

const MODEL_TIERS = [
  { envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL", probeModel: "claude-opus-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL", probeModel: "claude-sonnet-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL", probeModel: "claude-haiku-4-20250514" },
] as const;

export function registerEnvCommand(program: Command): void {
  program
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
}
