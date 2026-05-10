import type { Command } from "commander";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { loadConfig } from "../../config/loader.js";

const PID_FILE = join(homedir(), ".cc-router", "cc-router.pid");

function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show CC-Router status")
    .action(async () => {
      let config: ReturnType<typeof loadConfig> | null = null;
      try {
        config = loadConfig();
      } catch {
        // Config might be unavailable
      }

      // Check daemon via PID file
      let daemonPid: number | null = null;
      if (existsSync(PID_FILE)) {
        try {
          const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
          process.kill(pid, 0);
          daemonPid = pid;
        } catch {
          // Stale or corrupt PID file
        }
      }

      // Also check if server is listening on port (works for foreground mode)
      let portActive = false;
      if (config) {
        portActive = await isPortListening(config.server.host, config.server.port);
      }

      if (!daemonPid && !portActive) {
        console.log("CC-Router is not running");
        return;
      }

      if (daemonPid) {
        console.log(`CC-Router is running (daemon PID: ${daemonPid})`);
      } else {
        console.log("CC-Router is running (foreground)");
      }

      if (config) {
        const { host, port } = config.server;
        console.log(`  Listening on: http://${host}:${port}`);
        console.log(`  Providers: ${Object.keys(config.providers).length}`);
        console.log(`  Routes: ${config.routes.length}`);

        if (daemonPid) {
          try {
            const stat = statSync(PID_FILE);
            const uptimeMs = Date.now() - stat.mtimeMs;
            const uptimeSec = Math.floor(uptimeMs / 1000);
            const mins = Math.floor(uptimeSec / 60);
            const hours = Math.floor(mins / 60);
            if (hours > 0) {
              console.log(`  Uptime: ~${hours}h ${mins % 60}m`);
            } else {
              console.log(`  Uptime: ~${mins}m ${uptimeSec % 60}s`);
            }
          } catch {
            // Uptime unavailable
          }
        }
      }
    });
}
