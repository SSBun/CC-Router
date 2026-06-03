import type { Command } from "commander";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PID_FILE = join(homedir(), ".cc-router", "cc-router.pid");

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the CC-Router server")
    .action(() => {
      if (!existsSync(PID_FILE)) {
        console.log("CC-Router is not running");
        process.exit(1);
      }

      try {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
        process.kill(pid, "SIGTERM");
        console.log(`CC-Router stopped (PID: ${pid})`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") {
          console.log("CC-Router is not running (stale PID file)");
        } else {
          console.log(`Failed to stop: ${(err as Error).message}`);
        }
      } finally {
        try { unlinkSync(PID_FILE); } catch {}
      }
    });
}
