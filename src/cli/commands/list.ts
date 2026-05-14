import type { Command } from "commander";
import { loadConfig } from "../../config/loader.js";

export function registerListCommand(program: Command): void {
  program
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
}
