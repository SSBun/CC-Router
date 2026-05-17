import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
  async onSuccess() {
    const distDashboardDir = join(process.cwd(), "dist/dashboard");
    mkdirSync(distDashboardDir, { recursive: true });
    copyFileSync(
      join(process.cwd(), "src/dashboard/index.html"),
      join(distDashboardDir, "index.html"),
    );
  },
});
