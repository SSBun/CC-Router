import type { Command } from "commander";
import { execSync } from "node:child_process";
import { select, isCancel } from "@clack/prompts";
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

  cmd
    .command("models")
    .description("Fetch model list from provider(s) via /v1/models endpoint")
    .argument("[name]", "Provider name (omit for interactive selection)")
    .action(async (name?: string) => {
      const config = loadConfig();

      if (!name) {
        const names = Object.keys(config.providers);
        if (names.length === 0) {
          console.log("No providers configured.");
          return;
        }
        const chosen = await select({
          message: "Select provider to fetch models:",
          options: [
            { label: "All providers", value: "__all__" },
            ...names.map((n) => ({ label: n, value: n })),
          ],
        });
        if (isCancel(chosen)) {
          console.log("Cancelled.");
          return;
        }
        name = chosen === "__all__" ? undefined : chosen;
      }

      const providers = name
        ? config.providers[name]
          ? { [name]: config.providers[name] }
          : (() => { throw new Error(`Provider "${name}" not found`); })()
        : config.providers;

      for (const [pName, provider] of Object.entries(providers)) {
        console.log(`\n${pName} (${provider.type})`);
        console.log(`  base_url: ${provider.base_url}`);

        const base = provider.base_url.replace(/\/+$/, "");
        const urls = [`${base}/models`, `${base}/v1/models`];
        const headers: Record<string, string> = {
          ...(provider.headers ?? {}),
        };
        if (provider.type === "anthropic-compatible") {
          headers["x-api-key"] = provider.api_key;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${provider.api_key}`;
        }

        let ok = false;
        for (const url of urls) {
          try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
            if (!res.ok) continue;
            const body = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
            const data = body.data;
            if (!Array.isArray(data)) continue;

            for (const m of data) {
              const by = m.owned_by ? ` (${m.owned_by})` : "";
              console.log(`    - ${m.id}${by}`);
            }
            ok = true;
            break;
          } catch {
            continue;
          }
        }

        if (!ok) {
          console.log(`  (no /v1/models endpoint available for this provider)`);
        }
      }
    });

  // Default action: show config
  cmd.action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });
}
