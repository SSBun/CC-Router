import type { Command } from "commander";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import picomatch from "picomatch";
import { loadConfig } from "../../config/loader.js";
import { modelIdWithSuffix } from "../../model-info/resolver.js";
import { logger } from "../../utils/logger.js";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

const MODEL_TIERS = [
  { envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL", probeModel: "claude-opus-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL", probeModel: "claude-sonnet-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL", probeModel: "claude-haiku-4-20250514" },
] as const;

function generateEnvVars(): Record<string, string> {
  const config = loadConfig();
  const { host, port, auth_token } = config.server;
  const env: Record<string, string> = {};

  env["ANTHROPIC_BASE_URL"] = `http://${host}:${port}`;
  env["ANTHROPIC_AUTH_TOKEN"] = auth_token;
  env["API_TIMEOUT_MS"] = "600000";

  // Tier-specific routes
  for (const tier of MODEL_TIERS) {
    for (const route of config.routes) {
      if (route.match === "*" || route.match === "**") continue;
      if (picomatch(route.match)(tier.probeModel)) {
        env[tier.envVar] = modelIdWithSuffix(route.model ?? route.match, config);
        break;
      }
    }
  }

  return env;
}

function backupSettings(): string | null {
  try {
    const backupDir = join(homedir(), ".cc-router", "backups");
    mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `settings.json.${timestamp}`);
    copyFileSync(SETTINGS_PATH, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

export function registerInjectCommand(program: Command): void {
  program
    .command("inject")
    .description("Inject cc-router env vars into Claude Code settings.json")
    .option("--dry-run", "Print what would be written without modifying files")
    .option("--no-backup", "Skip creating a backup before modifying")
    .action((opts: { dryRun?: boolean; backup?: boolean }) => {
      const newEnv = generateEnvVars();
      const settingsDir = join(homedir(), ".claude");
      let settings: Record<string, unknown> = {};

      // Read existing settings
      try {
        settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      } catch {
        mkdirSync(settingsDir, { recursive: true });
      }

      const oldEnv = settings.env as Record<string, string> | undefined;

      console.log("Environment variables to set:");
      for (const [key, value] of Object.entries(newEnv).sort()) {
        const changed = oldEnv?.[key] !== undefined && oldEnv[key] !== value;
        const prefix = changed ? "~" : " ";
        console.log(`  ${prefix} ${key}=${value}`);
      }

      // Show removed vars
      if (oldEnv) {
        const removed = Object.keys(oldEnv).filter(
          (k) => !(k in newEnv) && k.startsWith("ANTHROPIC_"),
        );
        for (const key of removed) {
          console.log(`  - ${key} (removed)`);
        }
      }

      if (opts.dryRun) {
        console.log("\nDry-run mode. No files modified.");
        return;
      }

      // Backup
      let backupPath: string | null = null;
      if (opts.backup !== false) {
        backupPath = backupSettings();
      }

      // Merge env: keep non-ANTHROPIC_* vars, replace cc-router vars
      const mergedEnv = { ...(settings.env as Record<string, string> | undefined) };
      for (const key of Object.keys(mergedEnv)) {
        if (key.startsWith("ANTHROPIC_") || key === "API_TIMEOUT_MS") {
          delete mergedEnv[key];
        }
      }
      Object.assign(mergedEnv, newEnv);
      settings.env = mergedEnv;

      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");

      if (backupPath) {
        console.log(`\nBackup saved: ${backupPath}`);
      }
      console.log("\nInjected cc-router env into Claude Code settings.");
      console.log("Restart Claude Code or run `/reload` to apply.");
    });
}
