import type { Command } from "commander";
import { fork } from "node:child_process";
import picomatch from "picomatch";
import { loadConfig } from "../../config/loader.js";
import { startServer } from "../../server/index.js";
import { logger } from "../../utils/logger.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";

const PID_DIR = join(homedir(), ".cc-router");
const PID_FILE = join(PID_DIR, "cc-router.pid");

export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start the CC-Router server")
    .option("-p, --port <port>", "Override the port from config")
    .option("-d, --daemon", "Run as a background daemon")
    .option("--verbose", "Enable debug logging")
    .action(async (opts: { port?: string; daemon?: boolean; verbose?: boolean }) => {
      const config = loadConfig();

      if (opts.port) {
        config.server.port = parseInt(opts.port, 10);
      }

      if (opts.verbose) {
        logger.level = "debug";
        config.log_level = "debug";
      }

      if (opts.daemon) {
        startDaemon(config, opts);
        return;
      }

      const { host, port, auth_token } = config.server;

      console.log(`CC-Router running on http://${host}:${port}\n`);
      console.log("Add these to your shell:");
      console.log(`export ANTHROPIC_BASE_URL="http://${host}:${port}"`);
      console.log(`export ANTHROPIC_AUTH_TOKEN="${auth_token}"`);
      printModelExports(config);
      console.log();

      await startServer(config);
    });
}

const MODEL_TIERS = [
  { envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL", probeModel: "claude-opus-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL", probeModel: "claude-sonnet-4-20250514" },
  { envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL", probeModel: "claude-haiku-4-20250514" },
] as const;

function printModelExports(config: ReturnType<typeof loadConfig>): void {
  for (const tier of MODEL_TIERS) {
    for (const route of config.routes) {
      if (route.match === "*" || route.match === "**") continue;
      if (picomatch(route.match)(tier.probeModel)) {
        const model = route.model ?? route.match;
        console.log(`export ${tier.envVar}="${model}"`);
        break;
      }
    }
  }
}

function startDaemon(
  config: ReturnType<typeof loadConfig>,
  opts: { port?: string; verbose?: boolean },
): void {
  const args: string[] = [];
  if (opts.port) args.push("-p", opts.port);
  if (opts.verbose) args.push("--verbose");

  const child = fork(
    process.argv[1],
    ["_serve", ...args],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    },
  );

  child.unref();

  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(child.pid), "utf-8");

  const { host, port, auth_token } = config.server;

  console.log(`CC-Router started as daemon (PID: ${child.pid})`);
  console.log(`CC-Router running on http://${host}:${port}\n`);
  console.log("Add these to your shell:");
  console.log(`export ANTHROPIC_BASE_URL="http://${host}:${port}"`);
  console.log(`export ANTHROPIC_AUTH_TOKEN="${auth_token}"`);
  printModelExports(config);
  console.log();

  process.exit(0);
}
