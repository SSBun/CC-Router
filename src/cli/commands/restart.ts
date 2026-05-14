import type { Command } from "commander";
import { fork } from "node:child_process";
import { readFileSync, unlinkSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import picomatch from "picomatch";
import { loadConfig } from "../../config/loader.js";
import { modelIdWithSuffix } from "../../model-info/resolver.js";
import { printBanner } from "../../utils/banner.js";

const PID_DIR = join(homedir(), ".cc-router");
const PID_FILE = join(PID_DIR, "cc-router.pid");

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
        const model = modelIdWithSuffix(route.model ?? route.match, config);
        console.log(`export ${tier.envVar}="${model}"`);
        break;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerRestartCommand(program: Command): void {
  program
    .command("restart")
    .description("Restart the CC-Router daemon")
    .option("-p, --port <port>", "Override the port from config")
    .option("--verbose", "Enable debug logging")
    .action(async (opts: { port?: string; verbose?: boolean }) => {
      // Stop existing daemon
      if (existsSync(PID_FILE)) {
        try {
          const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
          process.kill(pid, "SIGTERM");
          console.log(`Stopped daemon (PID: ${pid})`);
          try { unlinkSync(PID_FILE); } catch { /* best-effort */ }
          await sleep(500);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ESRCH") {
            try { unlinkSync(PID_FILE); } catch { /* best-effort */ }
          } else {
            console.log(`Failed to stop: ${(err as Error).message}`);
            process.exit(1);
          }
        }
      } else {
        console.log("No running daemon found, starting fresh...");
      }

      // Start new daemon
      const config = loadConfig();
      if (opts.port) {
        config.server.port = parseInt(opts.port, 10);
      }

      const args: string[] = ["_serve"];
      if (opts.port) args.push("-p", opts.port);
      if (opts.verbose) args.push("--verbose");

      const child = fork(process.argv[1], args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();

      mkdirSync(PID_DIR, { recursive: true });
      writeFileSync(PID_FILE, String(child.pid), "utf-8");

      const { host, port, auth_token } = config.server;

      printBanner();
      console.log(`CC-Router restarted as daemon (PID: ${child.pid})`);
      console.log(`CC-Router running on http://${host}:${port}\n`);
      console.log("Add these to your shell:");
      console.log(`export ANTHROPIC_BASE_URL="http://${host}:${port}"`);
      console.log(`export ANTHROPIC_AUTH_TOKEN="${auth_token}"`);
      printModelExports(config);
      console.log();

      process.exit(0);
    });
}
