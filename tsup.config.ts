import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  async onSuccess() {
    const distDashboardDir = join(process.cwd(), "dist/dashboard");
    mkdirSync(distDashboardDir, { recursive: true });
    copyFileSync(
      join(process.cwd(), "src/dashboard/index.html"),
      join(distDashboardDir, "index.html"),
    );
    copyFileSync(
      join(process.cwd(), "src/dashboard/session.html"),
      join(distDashboardDir, "session.html"),
    );
  },
});
