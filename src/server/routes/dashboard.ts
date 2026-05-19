import type { Context } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
// tsup bundles into dist/index.js, dashboard HTML is at dist/dashboard/index.html
const __distDir = dirname(__filename);

let cachedHtml: string | null = null;

function getDashboardHtml(): string | null {
  if (!cachedHtml) {
    try {
      const htmlPath = join(__distDir, "dashboard/index.html");
      cachedHtml = readFileSync(htmlPath, "utf-8");
    } catch {
      return null;
    }
  }
  return cachedHtml;
}

export function createDashboardHandler() {
  return (c: Context) => {
    const html = getDashboardHtml();
    if (!html) {
      return c.text("Dashboard not found. Ensure cc-router is installed correctly.", 500);
    }
    return c.html(html);
  };
}
