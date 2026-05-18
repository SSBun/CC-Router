import type { Command } from "commander";
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { loadConfig } from "../../config/loader.js";
import { logger } from "../../utils/logger.js";

const OPEN_COMMANDS: Record<string, string> = {
  darwin: "open",
  win32: "cmd",
  linux: "xdg-open",
};

function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function localhost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd = OPEN_COMMANDS[platform];
  if (!cmd) {
    console.log(`Open this URL in your browser: ${url}`);
    return Promise.resolve();
  }
  const args = platform === "win32" ? ["/c", "start", url] : [url];
  return new Promise((resolve) => {
    execFile(cmd, args, (err) => {
      if (err) {
        console.log(`Could not open browser. Open manually: ${url}`);
      } else {
        console.log(`Opening dashboard: ${url}`);
      }
      resolve();
    });
  });
}

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Open the web dashboard in your browser")
    .action(async () => {
      let config: ReturnType<typeof loadConfig>;
      try {
        config = loadConfig();
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        console.error("Failed to load config. Run 'cc-router setup' first.");
        return;
      }

      const { host, port } = config.server;
      const connectHost = localhost(host);
      const listening = await isPortListening(connectHost, port);

      if (!listening) {
        console.error(`CC-Router is not running on ${connectHost}:${port}. Start it with 'cc-router start'.`);
        return;
      }

      const url = `http://${connectHost}:${port}/dashboard`;
      await openBrowser(url);
    });
}
