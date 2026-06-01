import type { Command } from "commander";
import { select, text, confirm, isCancel } from "@clack/prompts";
import { loadConfig, saveConfig } from "../../config/loader.js";

function fmtRoute(r: { match: string; provider: string; model?: string }): string {
  const modelSuffix = r.model ? ` → ${r.model}` : "";
  return `${r.match} → ${r.provider}${modelSuffix}`;
}

function orExit<T>(v: T | symbol): T {
  if (isCancel(v)) {
    console.log("\nCancelled.");
    process.exit(0);
  }
  return v;
}

export function registerRouteCommand(program: Command): void {
  const route = program.command("route").description("Manage routing rules");

  route
    .command("list")
    .description("List all routes")
    .action(() => {
      const config = loadConfig();

      if (config.routes.length === 0) {
        console.log("No routes configured.");
        return;
      }

      console.log("Routes:\n");
      for (const [i, r] of config.routes.entries()) {
        console.log(`  ${i + 1}. ${fmtRoute(r)}`);
      }
    });

  route
    .command("add")
    .description("Add a new route")
    .action(async () => {
      const config = loadConfig();

      const providerNames = Object.keys(config.providers);
      if (providerNames.length === 0) {
        console.log("No providers configured. Run `cc-router setup` first.");
        process.exit(1);
      }

      const match = orExit(
        await text({
          message: "Match pattern (glob, e.g. *opus*, *sonnet*, *):",
          validate: (v: string) => (v.trim() ? undefined : "Pattern is required"),
        }),
      ).trim();

      const provider = orExit(
        await select({
          message: "Provider:",
          options: providerNames.map((p) => ({ label: p, value: p })),
        }),
      );

      let model: string | undefined;
      const hasModel = orExit(
        await confirm({
          message: "Specify a model name for this route?",
          initialValue: true,
        }),
      );
      if (hasModel) {
        model = orExit(
          await text({
            message: "Model name (e.g. deepseek-v4-pro, GLM-5.1):",
            validate: (v: string) => (v.trim() ? undefined : "Model name is required"),
          }),
        ).trim();
      }

      const insertBefore = orExit(
        await select({
          message: "Insert position (routes match top-down, first match wins):",
          options: [
            { label: "Top (highest priority)", value: 0 },
            ...config.routes.map((r, i) => ({
              label: `After route ${i + 1} (${r.match})`,
              value: i + 1,
            })),
            { label: "Bottom (lowest priority)", value: config.routes.length },
          ],
        }),
      );

      const newRoute = { match, provider, model };
      config.routes.splice(insertBefore, 0, newRoute);

      saveConfig(config);
      console.log(`\nRoute added: ${fmtRoute(newRoute)}`);
    });

  route
    .command("edit")
    .description("Edit an existing route")
    .action(async () => {
      const config = loadConfig();

      if (config.routes.length === 0) {
        console.log("No routes to edit.");
        return;
      }

      const providerNames = Object.keys(config.providers);

      const index = orExit(
        await select({
          message: "Select route to edit:",
          options: config.routes.map((r, i) => ({
            label: `${i + 1}. ${fmtRoute(r)}`,
            value: i,
          })),
        }),
      );

      const current = config.routes[index];

      const match = orExit(
        await text({
          message: "Match pattern:",
          initialValue: current.match,
          validate: (v: string) => (v.trim() ? undefined : "Pattern is required"),
        }),
      ).trim();

      const provider = orExit(
        await select({
          message: "Provider:",
          options: providerNames.map((p) => ({
            label: p === current.provider ? `${p} (current)` : p,
            value: p,
          })),
        }),
      );

      let model: string | undefined;
      const setModel = orExit(
        await confirm({
          message: current.model
            ? `Change model? (current: ${current.model})`
            : "Set a model name?",
          initialValue: false,
        }),
      );
      if (setModel) {
        model = orExit(
          await text({
            message: "Model name:",
            initialValue: current.model,
          }),
        ).trim();
      } else {
        model = current.model;
      }

      config.routes[index] = { match, provider, model };
      saveConfig(config);

      console.log(`\nRoute updated: ${fmtRoute(config.routes[index])}`);
    });

  route
    .command("remove")
    .description("Remove a route")
    .action(async () => {
      const config = loadConfig();

      if (config.routes.length === 0) {
        console.log("No routes to remove.");
        return;
      }

      const index = orExit(
        await select({
          message: "Select route to remove:",
          options: config.routes.map((r, i) => ({
            label: `${i + 1}. ${fmtRoute(r)}`,
            value: i,
          })),
        }),
      );

      const removed = config.routes.splice(index, 1)[0];
      saveConfig(config);

      console.log(`\nRemoved: ${fmtRoute(removed)}`);
    });

  route
    .command("reorder")
    .description("Change route priority order")
    .action(async () => {
      const config = loadConfig();

      if (config.routes.length < 2) {
        console.log("Need at least 2 routes to reorder.");
        return;
      }

      console.log("Current route order:\n");
      for (const [i, r] of config.routes.entries()) {
        console.log(`  ${i + 1}. ${fmtRoute(r)}`);
      }
      console.log();

      const fromIndex = orExit(
        await select({
          message: "Select route to move:",
          options: config.routes.map((r, i) => ({
            label: `${i + 1}. ${fmtRoute(r)}`,
            value: i,
          })),
        }),
      );

      const [moved] = config.routes.splice(fromIndex, 1);

      const remainingPositions = config.routes.map((r, i) => ({
        label: `Before: ${i + 1}. ${fmtRoute(r)}`,
        value: i,
      }));
      remainingPositions.push({
        label: "Last position",
        value: config.routes.length,
      });

      const toIndex = orExit(
        await select({
          message: "Move to position:",
          options: remainingPositions,
        }),
      );

      config.routes.splice(toIndex, 0, moved);
      saveConfig(config);

      console.log("\nUpdated route order:\n");
      for (const [i, r] of config.routes.entries()) {
        console.log(`  ${i + 1}. ${fmtRoute(r)}`);
      }
    });
}
