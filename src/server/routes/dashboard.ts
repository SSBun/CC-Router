import type { Context } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedHtml: string | null = null;

function getDashboardHtml(): string {
  if (!cachedHtml) {
    const htmlPath = join(__dirname, "dashboard/index.html");
    cachedHtml = readFileSync(htmlPath, "utf-8");
  }
  return cachedHtml;
}

export function createDashboardHandler() {
  return (c: Context) => {
    return c.html(getDashboardHtml());
  };
}
