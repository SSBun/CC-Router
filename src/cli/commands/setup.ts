import type { Command } from "commander";
import { select, input, confirm } from "@inquirer/prompts";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { saveConfig, getConfigPath } from "../../config/loader.js";
import type { AppConfig } from "../../config/schema.js";

interface ProviderEntry {
  name: string;
  type: "anthropic-compatible" | "openai-compatible";
  api_key: string;
  base_url: string;
  models: Array<{ id: string; context_window?: number }>;
}

const TYPE_DEFAULTS: Record<string, string> = {
  "anthropic-compatible": "https://api.anthropic.com",
  "openai-compatible": "https://api.openai.com/v1",
};

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard")
    .action(async () => {
      try {
        console.log("CC-Router Setup\n");

        // Step 1: Add providers
      const providers: Record<string, ProviderEntry> = {};

      while (true) {
        const hasProviders = Object.keys(providers).length > 0;
        const addMore = await confirm({
          message: hasProviders ? "Add another provider?" : "Add a provider?",
          default: !hasProviders,
        });

        if (!addMore) break;

        const type = await select({
          message: "Provider type:",
          choices: [
            { name: "Anthropic-compatible", value: "anthropic-compatible" as const },
            { name: "OpenAI-compatible", value: "openai-compatible" as const },
          ],
        });

        const name = await input({
          message: "Provider name (e.g. anthropic, openai, deepseek):",
          validate: (v: string) => {
            if (!v.trim()) return "Name is required";
            if (providers[v.trim()]) return "Provider already exists";
            return true;
          },
        });

        const baseUrl = await input({
          message: "Base URL:",
          default: TYPE_DEFAULTS[type],
        });

        const apiKey = await input({
          message: "API key (or env var like ${MY_API_KEY}):",
        });

        const models: Array<{ id: string; context_window?: number }> = [];
        while (true) {
          const addModel = await confirm({
            message: models.length === 0 ? "Add a model?" : "Add another model?",
            default: models.length === 0,
          });
          if (!addModel) break;

          const modelId = await input({
            message: "Model name (e.g. claude-sonnet-4-20250514, gpt-4o):",
            validate: (v: string) => (v.trim() ? true : "Model name is required"),
          });

          const contextWindowStr = await input({
            message: "Context window (press Enter to skip):",
            default: "",
          });
          const contextWindow = contextWindowStr.trim()
            ? parseInt(contextWindowStr.trim(), 10)
            : undefined;

          models.push({
            id: modelId.trim(),
            ...(contextWindow && Number.isFinite(contextWindow) ? { context_window: contextWindow } : {}),
          });
        }

        providers[name.trim()] = {
          name: name.trim(),
          type,
          api_key: apiKey,
          base_url: baseUrl,
          models,
        };

        console.log(`  Added provider "${name.trim()}" with ${models.length} model(s)\n`);
      }

      if (Object.keys(providers).length === 0) {
        console.log("No providers added. Exiting.");
        process.exit(1);
      }

      // Step 2: Configure routes — pick a model for each tier
      const routes: Array<{ match: string; provider: string; model: string }> = [];

      // Build flat list of all models across all providers
      const allModelChoices = Object.entries(providers).flatMap(([pName, p]) =>
        p.models.map((m) => ({
          name: `${m.id} (${pName})`,
          value: { provider: pName, model: m.id } as { provider: string; model: string },
        })),
      );

      console.log("\n--- Configure Model Routing ---\n");

      const tiers = [
        { label: "Opus (most capable)", match: "*opus*" },
        { label: "Sonnet (balanced)", match: "*sonnet*" },
        { label: "Haiku (fastest)", match: "*haiku*" },
      ] as const;

      for (const tier of tiers) {
        if (allModelChoices.length === 0) break;

        const configure = await confirm({
          message: `Configure ${tier.label} routing?`,
          default: true,
        });

        if (!configure) continue;

        const chosen = await select({
          message: `Which model for ${tier.label}?`,
          choices: allModelChoices,
        });

        routes.push({
          match: tier.match,
          provider: chosen.provider,
          model: chosen.model,
        });

        console.log(`  ${tier.label}: ${chosen.model} → ${chosen.provider}\n`);
      }

      // Catch-all route
      if (routes.length > 0) {
        const addCatchAll = await confirm({
          message: "Add a catch-all route for unmatched models?",
          default: true,
        });

        if (addCatchAll) {
          const chosen = await select({
            message: "Which model for catch-all?",
            choices: allModelChoices,
          });
          routes.push({ match: "*", provider: chosen.provider, model: chosen.model });
          console.log(`  Catch-all: ${chosen.model} → ${chosen.provider}\n`);
        }
      } else if (allModelChoices.length > 0) {
        const chosen = await select({
          message: "Select default model (catch-all route):",
          choices: allModelChoices,
        });
        routes.push({ match: "*", provider: chosen.provider, model: chosen.model });
      } else {
        const providerNames = Object.keys(providers);
        const defaultProvider = await select({
          message: "Select default provider (catch-all route):",
          choices: providerNames.map((p) => ({ name: p, value: p })),
        });
        routes.push({ match: "*", provider: defaultProvider });
      }

      // Step 3: Server config
      console.log("\n--- Server Config ---\n");

      const host = await input({
        message: "Server host:",
        default: "127.0.0.1",
      });

      const port = await input({
        message: "Server port:",
        default: "8787",
      });

      // Step 4: Build and save config
      // Reuse existing auth_token if config file already exists
      let existingToken = "";
      try {
        const configPath = getConfigPath();
        if (existsSync(configPath)) {
          const raw = parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
          const server = raw?.server as Record<string, unknown> | undefined;
          if (server?.auth_token && typeof server.auth_token === "string") {
            existingToken = server.auth_token;
          }
        }
      } catch { /* ignore */ }

      const authToken = existingToken || randomUUID();

      const config: AppConfig = {
        server: {
          host,
          port: parseInt(port, 10),
          auth_token: authToken,
        },
        providers: Object.fromEntries(
          Object.entries(providers).map(([name, p]) => [
            name,
            {
              type: p.type,
              api_key: p.api_key,
              base_url: p.base_url,
              models: p.models,
            },
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
      const MODEL_TIERS = [
        { match: "*opus*", envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
        { match: "*sonnet*", envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
        { match: "*haiku*", envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
      ] as const;

      for (const tier of MODEL_TIERS) {
        const route = routes.find((r) => r.match === tier.match);
        if (route?.model) {
          console.log(`export ${tier.envVar}="${route.model}"`);
        }
      }
      console.log();
      } catch (err) {
        if (err instanceof Error && err.name === "ExitPromptError") {
          console.log("\nSetup cancelled.");
          process.exit(0);
        }
        throw err;
      }
    });
}
