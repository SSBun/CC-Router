import type { Command } from "commander";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const PID_FILE = join(homedir(), ".cc-router", "cc-router.pid");

/** Find all cc-router server processes (foreground or daemon), excluding our own PID. */
function findServerProcesses(): number[] {
  try {
    const out = execFileSync("pgrep", ["-f", "cc-router (start|_serve)"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const ownPid = process.pid;
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number)
      .filter((p) => !isNaN(p) && p !== ownPid);
  } catch {
    return [];
  }
}

export function registerStopCommand(program: Command): void {
  program
    .command("stop")
    .description("Stop the CC-Router daemon")
    .action(() => {
      let stopped = false;

      // Kill daemon by PID file
      if (existsSync(PID_FILE)) {
        try {
          const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
          try {
            process.kill(pid, "SIGTERM");
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
              console.log(
                `Failed to stop daemon process ${pid}: ${(err as Error).message}`,
              );
            }
          }
          unlinkSync(PID_FILE);
          stopped = true;
        } catch {
          // best-effort
        }
      }

      // Kill foreground / daemon _serve server processes
      const servePids = findServerProcesses();
      for (const pid of servePids) {
        try {
          process.kill(pid, "SIGTERM");
          stopped = true;
        } catch {
          // process may have died between pgrep and kill
        }
      }

      if (stopped) {
        console.log("CC-Router stopped");
      } else {
        console.log("CC-Router is not running");
        process.exit(1);
      }
    });
}
