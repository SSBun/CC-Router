import type { Command } from "commander";
import { select, input, confirm, checkbox } from "@inquirer/prompts";
import { saveConfig, getConfigPath } from "../../config/loader.js";
import type { AppConfig } from "../../config/schema.js";

interface ProviderAnswers {
  name: string;
  type: "anthropic" | "anthropic-compatible" | "openai" | "openai-compatible";
  api_key: string;
  base_url: string;
}

const PROVIDER_DEFAULTS: Record<string, { type: string; base_url: string }> = {
  anthropic: { type: "anthropic", base_url: "https://api.anthropic.com" },
  openai: { type: "openai", base_url: "https://api.openai.com/v1" },
  deepseek: { type: "openai-compatible", base_url: "https://api.deepseek.com/v1" },
  ollama: { type: "openai-compatible", base_url: "http://localhost:11434/v1" },
};

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard")
    .action(async () => {
      console.log("CC-Router Setup\n");

      // Step 1: Choose providers
      const selectedProviders = await checkbox({
        message: "Which providers do you want to configure?",
        choices: [
          { name: "Anthropic", value: "anthropic" },
          { name: "OpenAI", value: "openai" },
          { name: "DeepSeek", value: "deepseek" },
          { name: "Ollama (local)", value: "ollama" },
          { name: "Custom (Anthropic-compatible)", value: "custom-anthropic" },
          { name: "Custom (OpenAI-compatible)", value: "custom" },
        ],
        required: true,
      });

      // Step 2: Configure each provider
      const providers: Record<string, ProviderAnswers> = {};

      for (const providerKey of selectedProviders) {
        const defaults = PROVIDER_DEFAULTS[providerKey] ?? {
          type: providerKey === "custom-anthropic" ? "anthropic-compatible" : "openai-compatible",
          base_url: "",
        };

        console.log(`\n--- ${providerKey} ---`);

        const name =
          providerKey === "custom" || providerKey === "custom-anthropic"
            ? await input({ message: "Provider name (lowercase, e.g. groq, bigmodel):" })
            : providerKey;

        const apiKey = await input({
          message: "API key:",
          default: providerKey === "ollama" ? "ollama" : "",
        });

        const baseUrl = await input({
          message: "Base URL:",
          default: defaults.base_url,
        });

        const type = defaults.type as ProviderAnswers["type"];

        providers[name] = {
          name,
          type,
          api_key: apiKey,
          base_url: baseUrl,
        };
      }

      // Step 3: Configure model routing
      const providerNames = Object.keys(providers);
      const routes: Array<{ match: string; provider: string; model?: string }> = [];

      const slots = [
        { label: "opus (most capable)", match: "opus" },
        { label: "sonnet (balanced)", match: "sonnet" },
        { label: "haiku (fastest)", match: "haiku" },
      ];

      const configureRouting = await confirm({
        message: "Configure model routing (e.g. opus → Anthropic, sonnet → OpenAI)?",
        default: true,
      });

      if (configureRouting) {
        for (const slot of slots) {
          const useSlot = await confirm({
            message: `Configure ${slot.label} routing?`,
            default: true,
          });

          if (!useSlot) continue;

          const provider = await select({
            message: `Which provider for ${slot.label}?`,
            choices: providerNames.map((p) => ({ name: p, value: p })),
          });

          const modelName = await input({
            message: `Model name for ${slot.label} (e.g. claude-opus-4-20250514, gpt-4o):`,
          });

          routes.push({
            match: `*${slot.match}*`,
            provider,
            model: modelName,
          });
        }
      }

      // Ensure at least one catch-all route
      if (routes.length === 0) {
        const defaultProvider = await select({
          message: "Select default provider (catch-all route):",
          choices: providerNames.map((p) => ({ name: p, value: p })),
        });
        routes.push({ match: "*", provider: defaultProvider });
      }

      // Step 4: Server config
      const host = await input({
        message: "Server host:",
        default: "127.0.0.1",
      });

      const port = await input({
        message: "Server port:",
        default: "8787",
      });

      // Step 5: Build and save config
      const config: AppConfig = {
        server: {
          host,
          port: parseInt(port, 10),
          auth_token: "",
        },
        providers: Object.fromEntries(
          Object.entries(providers).map(([name, p]) => [
            name,
            { type: p.type, api_key: p.api_key, base_url: p.base_url },
          ]),
        ),
        routes,
        log_level: "info",
      };

      saveConfig(config);

      const configPath = getConfigPath();
      console.log(`\nConfig saved to ${configPath}`);
      console.log("\nTo start CC-Router, run:");
      console.log("  cc-router start\n");
      console.log("Then add these to your shell:");
      console.log(`export ANTHROPIC_BASE_URL="http://${host}:${port}"`);
      console.log(`export ANTHROPIC_AUTH_TOKEN="${config.server.auth_token}"`);
      for (const route of routes) {
        const key = route.match
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "_")
          .replace(/^_+|_+$/g, "");
        if (route.model) {
          console.log(`export ANTHROPIC_DEFAULT_${key}_MODEL="${route.model}"`);
        }
      }
      console.log();
    });
}
