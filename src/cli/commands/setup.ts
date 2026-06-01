import type { Command } from "commander";
import { select, text, confirm, intro, outro, isCancel, log } from "@clack/prompts";
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
  models: AppConfig["providers"][string]["models"];
}

const TYPE_DEFAULTS: Record<string, string> = {
  "anthropic-compatible": "https://api.anthropic.com",
  "openai-compatible": "https://api.openai.com/v1",
};

function orExit<T>(v: T | symbol): T {
  if (isCancel(v)) {
    outro("Setup cancelled.");
    process.exit(0);
  }
  return v;
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard")
    .action(async () => {
      intro("CC-Router Setup");

      // Step 1: Add providers
      const providers: Record<string, ProviderEntry> = {};

      while (true) {
        const hasProviders = Object.keys(providers).length > 0;
        const addMore = orExit(
          await confirm({
            message: hasProviders ? "Add another provider?" : "Add a provider?",
            initialValue: !hasProviders,
          }),
        );
        if (!addMore) break;

        const type = orExit(
          await select({
            message: "Provider type:",
            options: [
              { label: "Anthropic-compatible", value: "anthropic-compatible" as const },
              { label: "OpenAI-compatible", value: "openai-compatible" as const },
            ],
          }),
        );

        const name = orExit(
          await text({
            message: "Provider name (e.g. anthropic, openai, deepseek):",
            validate: (v: string) => {
              if (!v.trim()) return "Name is required";
              if (providers[v.trim()]) return "Provider already exists";
            },
          }),
        );

        const baseUrl = orExit(
          await text({
            message: "Base URL:",
            initialValue: TYPE_DEFAULTS[type],
          }),
        );

        const apiKey = orExit(
          await text({
            message: "API key (or env var like ${MY_API_KEY}):",
          }),
        );

        const models: ProviderEntry["models"] = [];
        while (true) {
          const addModel = orExit(
            await confirm({
              message: models.length === 0 ? "Add a model?" : "Add another model?",
              initialValue: models.length === 0,
            }),
          );
          if (!addModel) break;

          const modelId = orExit(
            await text({
              message: "Model name (e.g. claude-sonnet-4-20250514, gpt-4o):",
              validate: (v: string) => (v.trim() ? undefined : "Model name is required"),
            }),
          );

          const maxInputStr = orExit(
            await text({
              message: "Max input tokens (press Enter to skip):",
              initialValue: "",
            }),
          );
          const maxInput = maxInputStr.trim()
            ? parseInt(maxInputStr.trim(), 10)
            : undefined;

          const maxTokensStr = orExit(
            await text({
              message: "Max output tokens (press Enter to skip):",
              initialValue: "",
            }),
          );
          const maxTokens = maxTokensStr.trim()
            ? parseInt(maxTokensStr.trim(), 10)
            : undefined;

          models.push({
            id: modelId.trim(),
            max_input_tokens: (maxInput && Number.isFinite(maxInput)) ? maxInput : undefined,
            max_tokens: (maxTokens && Number.isFinite(maxTokens)) ? maxTokens : undefined,
          });
        }

        providers[name.trim()] = {
          name: name.trim(),
          type,
          api_key: apiKey,
          base_url: baseUrl,
          models,
        };

        log.info(`Added provider "${name.trim()}" with ${models.length} model(s)`);
      }

      if (Object.keys(providers).length === 0) {
        outro("No providers added. Exiting.");
        process.exit(1);
      }

      // Step 2: Configure routes — pick a model for each tier
      const routes: Array<{ match: string; provider: string; model?: string }> = [];

      // Build flat list of all models across all providers
      const allModelChoices = Object.entries(providers).flatMap(([pName, p]) =>
        p.models.map((m) => ({
          label: `${m.id} (${pName})`,
          value: { provider: pName, model: m.id } as { provider: string; model: string },
        })),
      );

      log.info("Configure Model Routing");

      const tiers = [
        { label: "Opus (most capable)", match: "*opus*" },
        { label: "Sonnet (balanced)", match: "*sonnet*" },
        { label: "Haiku (fastest)", match: "*haiku*" },
      ] as const;

      for (const tier of tiers) {
        if (allModelChoices.length === 0) break;

        const configure = orExit(
          await confirm({
            message: `Configure ${tier.label} routing?`,
            initialValue: true,
          }),
        );
        if (!configure) continue;

        const chosen = orExit(
          await select({
            message: `Which model for ${tier.label}?`,
            options: allModelChoices,
          }),
        );

        routes.push({
          match: tier.match,
          provider: chosen.provider,
          model: chosen.model,
        });

        log.info(`${tier.label}: ${chosen.model} → ${chosen.provider}`);
      }

      // Catch-all route
      if (routes.length > 0) {
        const addCatchAll = orExit(
          await confirm({
            message: "Add a catch-all route for unmatched models?",
            initialValue: true,
          }),
        );

        if (addCatchAll) {
          const chosen = orExit(
            await select({
              message: "Which model for catch-all?",
              options: allModelChoices,
            }),
          );
          routes.push({ match: "*", provider: chosen.provider, model: chosen.model });
          log.info(`Catch-all: ${chosen.model} → ${chosen.provider}`);
        }
      } else if (allModelChoices.length > 0) {
        const chosen = orExit(
          await select({
            message: "Select default model (catch-all route):",
            options: allModelChoices,
          }),
        );
        routes.push({ match: "*", provider: chosen.provider, model: chosen.model });
      } else {
        const providerNames = Object.keys(providers);
        const defaultProvider = orExit(
          await select({
            message: "Select default provider (catch-all route):",
            options: providerNames.map((p) => ({ label: p, value: p })),
          }),
        );
        routes.push({ match: "*", provider: defaultProvider });
      }

      // Step 3: Server config
      log.info("Server Config");

      const host = orExit(
        await text({
          message: "Server host:",
          initialValue: "127.0.0.1",
        }),
      );

      const port = orExit(
        await text({
          message: "Server port:",
          initialValue: "8787",
        }),
      );

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
      outro(`Config saved to ${configPath}`);

      log.info("To start CC-Router, run:");
      log.info("  cc-router start\n");
      log.info("Then add these to your shell:");
      log.step(`export ANTHROPIC_BASE_URL="http://${host}:${port}"`);
      log.step(`export ANTHROPIC_AUTH_TOKEN="${config.server.auth_token}"`);

      const MODEL_TIERS = [
        { match: "*opus*", envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
        { match: "*sonnet*", envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
        { match: "*haiku*", envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
      ] as const;

      for (const tier of MODEL_TIERS) {
        const route = routes.find((r) => r.match === tier.match);
        if (route?.model) {
          const modelId = route.model;
          let ctx = "";
          for (const p of Object.values(providers)) {
            const m = p.models.find((m) => m.id === modelId);
            if (m?.max_input_tokens) {
              const n = m.max_input_tokens;
              ctx = n >= 1_000_000 ? `[${(n / 1_000_000).toFixed(0)}m]` : `[${(n / 1000).toFixed(0)}k]`;
              break;
            }
          }
          log.step(`export ${tier.envVar}="${modelId}${ctx}"`);
        }
      }
    });
}
