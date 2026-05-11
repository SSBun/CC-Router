import type { Command } from "commander";
import { select, input, confirm } from "@inquirer/prompts";
import { loadConfig, saveConfig } from "../../config/loader.js";

function handleCancel(): never {
  console.log("\nCancelled.");
  process.exit(0);
}

function fmtRoute(r: { match: string; provider: string; model?: string }): string {
  const modelSuffix = r.model ? ` → ${r.model}` : "";
  return `${r.match} → ${r.provider}${modelSuffix}`;
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

      let match: string;
      try {
        match = (await input({
          message: "Match pattern (glob, e.g. *opus*, *sonnet*, *):",
          validate: (v: string) => (v.trim() ? true : "Pattern is required"),
        })).trim();
      } catch { handleCancel() }

      let provider: string;
      try {
        provider = await select({
          message: "Provider:",
          choices: providerNames.map((p) => ({ name: p, value: p })),
        });
      } catch { handleCancel() }

      let model: string | undefined;
      try {
        const hasModel = await confirm({
          message: "Specify a model name for this route?",
          default: true,
        });
        if (hasModel) {
          model = (await input({
            message: "Model name (e.g. deepseek-v4-pro, GLM-5.1):",
            validate: (v: string) => (v.trim() ? true : "Model name is required"),
          })).trim();
        }
      } catch { handleCancel() }

      let insertBefore: number;
      try {
        insertBefore = await select({
          message: "Insert position (routes match top-down, first match wins):",
          choices: [
            { name: "Top (highest priority)", value: 0 },
            ...config.routes.map((r, i) => ({
              name: `After route ${i + 1} (${r.match})`,
              value: i + 1,
            })),
            { name: "Bottom (lowest priority)", value: config.routes.length },
          ],
        });
      } catch { handleCancel() }

      const newRoute = { match: match!, provider: provider!, model };
      config.routes.splice(insertBefore!, 0, newRoute);

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

      let index: number;
      try {
        index = await select({
          message: "Select route to edit:",
          choices: config.routes.map((r, i) => ({
            name: `${i + 1}. ${fmtRoute(r)}`,
            value: i,
          })),
        });
      } catch { handleCancel() }

      const current = config.routes[index!];

      let match: string;
      try {
        match = (await input({
          message: "Match pattern:",
          default: current.match,
          validate: (v: string) => (v.trim() ? true : "Pattern is required"),
        })).trim();
      } catch { handleCancel() }

      let provider: string;
      try {
        provider = await select({
          message: "Provider:",
          choices: providerNames.map((p) => ({
            name: p === current.provider ? `${p} (current)` : p,
            value: p,
          })),
          default: undefined,
        });
      } catch { handleCancel() }

      let model: string | undefined;
      try {
        const setModel = await confirm({
          message: current.model
            ? `Change model? (current: ${current.model})`
            : "Set a model name?",
          default: false,
        });
        if (setModel) {
          model = (await input({
            message: "Model name:",
            default: current.model,
          })).trim();
        } else {
          model = current.model;
        }
      } catch { handleCancel() }

      config.routes[index!] = { match: match!, provider: provider!, model };
      saveConfig(config);

      console.log(`\nRoute updated: ${fmtRoute(config.routes[index!])}`);
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

      let index: number;
      try {
        index = await select({
          message: "Select route to remove:",
          choices: config.routes.map((r, i) => ({
            name: `${i + 1}. ${fmtRoute(r)}`,
            value: i,
          })),
        });
      } catch { handleCancel() }

      const removed = config.routes.splice(index!, 1)[0];
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

      let fromIndex: number;
      try {
        fromIndex = await select({
          message: "Select route to move:",
          choices: config.routes.map((r, i) => ({
            name: `${i + 1}. ${fmtRoute(r)}`,
            value: i,
          })),
        });
      } catch { handleCancel() }

      const [moved] = config.routes.splice(fromIndex!, 1);

      const remainingPositions = config.routes.map((r, i) => ({
        name: `Before: ${i + 1}. ${fmtRoute(r)}`,
        value: i,
      }));
      remainingPositions.push({
        name: "Last position",
        value: config.routes.length,
      });

      let toIndex: number;
      try {
        toIndex = await select({
          message: "Move to position:",
          choices: remainingPositions,
        });
      } catch { handleCancel() }

      config.routes.splice(toIndex!, 0, moved);
      saveConfig(config);

      console.log("\nUpdated route order:\n");
      for (const [i, r] of config.routes.entries()) {
        console.log(`  ${i + 1}. ${fmtRoute(r)}`);
      }
    });
}
