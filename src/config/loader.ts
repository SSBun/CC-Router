import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { AppConfigSchema, type AppConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { logger } from "../utils/logger.js";

const CONFIG_DIR = join(homedir(), ".cc-router");
const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");

export function getConfigPath(): string {
  return CONFIG_FILE;
}

const ENV_VAR_RE = /\$\{([^}]+)\}/g;

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_RE, (match, varName) => {
      const resolved = process.env[varName];
      if (resolved === undefined) {
        logger.warn(`Environment variable ${varName} is not set, leaving ${match} as-is`);
        return match;
      }
      return resolved;
    });
  }

  if (Array.isArray(value)) {
    return value.map(interpolateEnvVars);
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolateEnvVars(v);
    }
    return result;
  }

  return value;
}

export function loadConfig(): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf-8");
  } catch {
    throw new Error(
      `Config not found at ${CONFIG_FILE}\n` +
        `Create it with your providers and routes. Example:\n\n` +
        `server:\n  host: "127.0.0.1"\n  port: 8787\n\n` +
        `providers:\n  anthropic:\n    type: "anthropic"\n    api_key: "\${ANTHROPIC_API_KEY}"\n    base_url: "https://api.anthropic.com"\n\n` +
        `routes:\n  - match: "*"\n    provider: "anthropic"\n`,
    );
  }

  const parsed = parse(raw);
  const interpolated = interpolateEnvVars(parsed) as Record<string, unknown>;

  const merged = {
    ...DEFAULT_CONFIG,
    ...interpolated,
    server: { ...DEFAULT_CONFIG.server, ...(interpolated.server as Record<string, unknown> ?? {}) },
  };

  const config = AppConfigSchema.parse(merged);

  if (!config.server.auth_token) {
    config.server.auth_token = randomUUID();
    saveConfig(config);
    logger.info(`Generated auth_token and saved to ${CONFIG_FILE}`);
  }

  return config;
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const yaml = stringify(config, { lineWidth: 0 });
  writeFileSync(CONFIG_FILE, yaml, "utf-8");
}
