import type { Command } from "commander";
import { select, checkbox, confirm, input } from "@inquirer/prompts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../../config/loader.js";
import { generateEnvVars, backupSettings, SETTINGS_PATH } from "./inject.js";
import manifest from "../../claude-settings-manifest.json" with { type: "json" };

type Settings = Record<string, unknown>;

const CANCELLED = Symbol("cancelled");
type MaybeCancelled<T> = T | typeof CANCELLED;

function isCancelled<T>(val: MaybeCancelled<T>): val is typeof CANCELLED {
  return val === CANCELLED;
}

// Patch process.stdin.emit to translate j/k keypresses to up/down when vimKeysEnabled
let vimKeysEnabled = false;
const origEmit = process.stdin.emit;

process.stdin.emit = function (event: string, ...args: unknown[]) {
  if (event === "keypress" && args[1]) {
    const key = args[1] as { name: string; ctrl?: boolean; meta?: boolean };
    if (key.name === "escape") {
      return origEmit.call(process.stdin, "keypress", "\x03", {
        name: "c", ctrl: true, meta: false, shift: false,
      });
    }
    if (vimKeysEnabled && !key.ctrl && !key.meta) {
      if (key.name === "j") {
        return origEmit.call(process.stdin, "keypress", "", {
          name: "down", sequence: "\x1b[B", ctrl: false, meta: false, shift: false,
        });
      }
      if (key.name === "k") {
        return origEmit.call(process.stdin, "keypress", "", {
          name: "up", sequence: "\x1b[A", ctrl: false, meta: false, shift: false,
        });
      }
    }
  }
  return origEmit.call(process.stdin, event, ...args);
};

async function vimSelect<T>(opts: Parameters<typeof select<T>>[0]): Promise<MaybeCancelled<T>> {
  vimKeysEnabled = true;
  return select<T>(opts)
    .catch((err) => {
      if (err instanceof Error && err.name === "ExitPromptError") return CANCELLED as T;
      throw err;
    })
    .finally(() => { vimKeysEnabled = false; });
}

async function vimCheckbox<T>(opts: Parameters<typeof checkbox<T>>[0]): Promise<MaybeCancelled<T>> {
  vimKeysEnabled = true;
  return checkbox<T>(opts)
    .catch((err) => {
      if (err instanceof Error && err.name === "ExitPromptError") return CANCELLED as T;
      throw err;
    })
    .finally(() => { vimKeysEnabled = false; });
}

function safe<T>(promise: Promise<T>): Promise<MaybeCancelled<T>> {
  return promise.catch((err) => {
    if (err instanceof Error && err.name === "ExitPromptError") return CANCELLED;
    throw err;
  });
}

const FEATURE_FLAGS = [
  "CLAUDE_CODE_ATTRIBUTION_HEADER",
  "CLAUDE_CODE_DISABLE_1M_CONTEXT",
  "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
  "DISABLE_EXTRA_USAGE_COMMAND",
  "CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT",
] as const;

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings: Settings): void {
  const dir = join(homedir(), ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function getDescription(key: string): string {
  return (manifest._descriptions as Record<string, string>)[key] ?? key;
}

function applyPreset(settings: Settings, presetName: string): Settings {
  const preset = (manifest._presets as Record<string, { values: Settings }>)[presetName];
  if (!preset) return settings;
  const merged = structuredClone(settings);
  const vals = preset.values;
  if (vals.env) {
    merged.env = { ...(merged.env as Record<string, string> | undefined), ...vals.env };
  }
  for (const [k, v] of Object.entries(vals)) {
    if (k === "env") continue;
    (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

function diffSettings(old: Settings, next: Settings): string[] {
  const lines: string[] = [];
  const oldEnv = (old.env ?? {}) as Record<string, string>;
  const nextEnv = (next.env ?? {}) as Record<string, string>;
  for (const k of Object.keys(nextEnv).sort()) {
    if (oldEnv[k] !== nextEnv[k]) {
      const prefix = oldEnv[k] !== undefined ? "~" : "+";
      lines.push(`  ${prefix} env.${k} = ${nextEnv[k]}`);
    }
  }
  for (const k of Object.keys(oldEnv)) {
    if (!(k in nextEnv)) {
      lines.push(`  - env.${k} (removed)`);
    }
  }
  for (const key of Object.keys(next).sort()) {
    if (key === "env") continue;
    if (JSON.stringify(old[key]) !== JSON.stringify(next[key])) {
      const prefix = old[key] !== undefined ? "~" : "+";
      lines.push(`  ${prefix} ${key} = ${JSON.stringify(next[key])}`);
    }
  }
  return lines;
}

async function showCCRouterEnv(): Promise<void> {
  console.log("\n  CC-Router environment variables (from cc-router config):\n");
  try {
    const env = generateEnvVars();
    for (const [k, v] of Object.entries(env).sort()) {
      console.log(`    ${k}=${v}`);
    }
  } catch {
    console.log("    (no cc-router config found)");
  }
  console.log();
}

async function configureFeatureFlags(settings: Settings): Promise<MaybeCancelled<Settings>> {
  const env = { ...(settings.env as Record<string, string> | undefined) };
  const choices = FEATURE_FLAGS.map((flag) => ({
    name: flag.replace(/CLAUDE_CODE_/g, "").replace(/_/g, " ").toLowerCase(),
    value: flag,
    description: getDescription(`env.${flag}`),
    checked: env[flag] === "1" || env[flag] === "true",
  }));

  const enabled = await vimCheckbox({
    message: "Feature flags (j/k navigate, space toggle, ESC back)",
    choices,
    required: false,
  });
  if (isCancelled(enabled)) return CANCELLED;

  for (const flag of FEATURE_FLAGS) {
    env[flag] = (enabled as string[]).includes(flag) ? "1" : "0";
  }

  return { ...settings, env };
}

async function configureToolSearch(settings: Settings): Promise<MaybeCancelled<Settings>> {
  const env = { ...(settings.env as Record<string, string> | undefined) };
  const current = env.ENABLE_TOOL_SEARCH ?? "auto";
  const value = await vimSelect({
    message: "Tool search (j/k navigate, ESC back)",
    choices: ["auto", "true", "false"].map((v) => ({
      name: v,
      value: v,
      description: v === "auto" ? "Decide automatically based on query" : v === "true" ? "Always enable" : "Always disable",
    })),
    default: current,
  });
  if (isCancelled(value)) return CANCELLED;
  env.ENABLE_TOOL_SEARCH = value as string;
  return { ...settings, env };
}

async function configurePreferences(settings: Settings): Promise<MaybeCancelled<Settings>> {
  const next = structuredClone(settings);

  const currentEffort = (next.effortLevel as string) ?? "high";
  const effort = await vimSelect({
    message: "Effort level (j/k navigate, ESC back)",
    choices: ["low", "med", "high", "xhigh"].map((v) => ({
      name: v,
      value: v,
      description: getDescription("effortLevel"),
    })),
    default: currentEffort,
  });
  if (isCancelled(effort)) return CANCELLED;
  next.effortLevel = effort as string;

  const currentEditor = (next.editorMode as string) ?? "default";
  const editor = await vimSelect({
    message: "Editor mode (j/k navigate, ESC back)",
    choices: ["default", "vim", "emacs"].map((v) => ({
      name: v,
      value: v,
      description: getDescription("editorMode"),
    })),
    default: currentEditor,
  });
  if (isCancelled(editor)) return CANCELLED;
  next.editorMode = editor as string;

  const afterToolSearch = await configureToolSearch(next);
  if (isCancelled(afterToolSearch)) return CANCELLED;
  Object.assign(next, afterToolSearch);

  const currentRate = (next.feedbackSurveyRate as number) ?? 0;
  const rateInput = await safe(input({
    message: "Feedback survey rate (0 = disabled)",
    default: String(currentRate),
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > 1) return "Must be a number between 0 and 1";
      return true;
    },
  }));
  if (isCancelled(rateInput)) return CANCELLED;
  next.feedbackSurveyRate = Number(rateInput);

  const boolPrefs = [
    { key: "autoConnectIde", label: "Auto-connect IDE" },
    { key: "autoMemoryEnabled", label: "Auto memory" },
    { key: "awaySummaryEnabled", label: "Away summary" },
    { key: "showClearContextOnPlanAccept", label: "Clear context on plan accept" },
    { key: "includeCoAuthoredBy", label: "Include Co-authored-by in commits" },
    { key: "includeGitInstructions", label: "Include git instructions" },
  ];

  const boolChoices = boolPrefs.map((p) => ({
    name: p.label,
    value: p.key,
    description: getDescription(p.key),
    checked: (next[p.key] as boolean) ?? false,
  }));

  const enabledBools = await vimCheckbox({
    message: "Preferences (j/k navigate, space toggle, ESC back)",
    choices: boolChoices,
    required: false,
  });
  if (isCancelled(enabledBools)) return CANCELLED;

  for (const p of boolPrefs) {
    next[p.key] = (enabledBools as string[]).includes(p.key);
  }

  return next;
}

async function configureAttribution(settings: Settings): Promise<MaybeCancelled<Settings>> {
  const attr = { ...((settings.attribution as Record<string, string>) ?? { commit: "", pr: "" }) };

  const commit = await safe(input({
    message: "Commit attribution",
    default: attr.commit ?? "",
  }));
  if (isCancelled(commit)) return CANCELLED;
  attr.commit = commit as string;

  const pr = await safe(input({
    message: "PR attribution",
    default: attr.pr ?? "",
  }));
  if (isCancelled(pr)) return CANCELLED;
  attr.pr = pr as string;

  return { ...settings, attribution: attr };
}

export function registerClaudeCommand(program: Command): void {
  program
    .command("claude")
    .description("Configure Claude Code settings interactively")
    .option("--dry-run", "Preview changes without writing")
    .option("--no-backup", "Skip backup before writing")
    .action(async (opts: { dryRun?: boolean; backup?: boolean }) => {
      let settings = readSettings();

      const presetList = Object.entries(manifest._presets as Record<string, { name: string; description: string }>);
      const presetChoice = await vimSelect<string | null>({
        message: "Choose a preset to start from (j/k navigate, ESC cancel)",
        choices: [
          { name: "None — keep current settings", value: "__none__", description: "Start with your current settings.json values" },
          ...presetList.map(([id, p]) => ({
            name: `${p.name} — ${p.description}`,
            value: id,
            description: p.description,
          })),
        ],
        default: "__none__",
      });
      if (isCancelled(presetChoice)) {
        console.log("\nCancelled.");
        return;
      }

      if (presetChoice && presetChoice !== "__none__") {
        settings = applyPreset(settings, presetChoice);
        console.log(`Applied preset: ${(manifest._presets as Record<string, { name: string }>)[presetChoice].name}\n`);
      }

      try {
        const routerEnv = generateEnvVars();
        const env = { ...(settings.env as Record<string, string> | undefined) };
        for (const [k, v] of Object.entries(routerEnv)) {
          env[k] = v;
        }
        settings.env = env;
      } catch {
        // cc-router not configured yet
      }

      let current = structuredClone(settings);

      while (true) {
        const action = await vimSelect({
          message: "What would you like to configure? (j/k navigate, ESC cancel)",
          choices: [
            { name: "CC-Router env vars (read-only)", value: "cc-router-env", description: "View auto-injected environment variables" },
            { name: "Feature flags", value: "features", description: "Toggle Claude Code behaviors" },
            { name: "Preferences", value: "preferences", description: "Effort level, editor mode, IDE, misc settings" },
            { name: "Attribution", value: "attribution", description: "Git commit/PR attribution metadata" },
            { name: "Review & save", value: "save" },
            { name: "Cancel", value: "cancel" },
          ],
        });
        if (isCancelled(action)) {
          console.log("\nCancelled.");
          return;
        }

        if (action === "cancel") {
          console.log("Cancelled.");
          return;
        }

        if (action === "cc-router-env") {
          await showCCRouterEnv();
          continue;
        }

        if (action === "features") {
          const result = await configureFeatureFlags(current);
          if (!isCancelled(result)) current = result;
          continue;
        }

        if (action === "preferences") {
          const result = await configurePreferences(current);
          if (!isCancelled(result)) current = result;
          continue;
        }

        if (action === "attribution") {
          const result = await configureAttribution(current);
          if (!isCancelled(result)) current = result;
          continue;
        }

        if (action === "save") {
          break;
        }
      }

      const original = readSettings();
      const changes = diffSettings(original, current);

      if (changes.length === 0) {
        console.log("No changes detected.");
        return;
      }

      console.log("\nChanges to apply:");
      for (const line of changes) {
        console.log(line);
      }
      console.log();

      const ok = await safe(confirm({ message: "Apply these changes?", default: true }));
      if (isCancelled(ok) || !ok) {
        console.log("Cancelled.");
        return;
      }

      if (opts.dryRun) {
        console.log("\nDry-run mode. No files modified.");
        return;
      }

      if (opts.backup !== false) {
        const backupPath = backupSettings();
        if (backupPath) {
          console.log(`Backup saved: ${backupPath}`);
        }
      }

      writeSettings(current);
      console.log("\nSettings saved to ~/.claude/settings.json");
      console.log("Restart Claude Code or run /reload to apply.");
    });
}
