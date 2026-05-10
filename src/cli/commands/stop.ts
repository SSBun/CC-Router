import type { Command } from "commander";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PID_FILE = join(homedir(), ".cc-router", "cc-router.pid");

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the CC-Router daemon")
    .action(() => {
      if (!existsSync(PID_FILE)) {
        console.log("CC-Router is not running (no PID file found)");
        process.exit(1);
      }

      let pid: number;
      try {
        pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      } catch {
        console.log("Failed to read PID file");
        process.exit(1);
      }

      try {
        process.kill(pid, "SIGTERM");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") {
          console.log("Process not found, cleaning up stale PID file");
        } else {
          console.log(`Failed to stop process ${pid}: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      try {
        unlinkSync(PID_FILE);
      } catch {
        // PID file cleanup is best-effort
      }

      console.log("CC-Router stopped");
    });
}
