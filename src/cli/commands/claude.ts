import type { Command } from "commander";
import { select, multiselect, confirm, text, isCancel } from "@clack/prompts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../../config/loader.js";
import { generateEnvVars, backupSettings, SETTINGS_PATH } from "./inject.js";
import manifest from "../../claude-settings-manifest.json" with { type: "json" };

type Settings = Record<string, unknown>;

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

async function vimSelect<T>(opts: Parameters<typeof select<T>>[0]): Promise<T | symbol> {
  vimKeysEnabled = true;
  try {
    return await select<T>(opts);
  } finally {
    vimKeysEnabled = false;
  }
}

async function vimMultiselect<T>(opts: Parameters<typeof multiselect<T>>[0]): Promise<T[] | symbol> {
  vimKeysEnabled = true;
  try {
    return await multiselect<T>(opts);
  } finally {
    vimKeysEnabled = false;
  }
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

async function configureFeatureFlags(settings: Settings): Promise<Settings | symbol> {
  const env = { ...(settings.env as Record<string, string> | undefined) };
  const choices = FEATURE_FLAGS.map((flag) => ({
    label: flag.replace(/CLAUDE_CODE_/g, "").replace(/_/g, " ").toLowerCase(),
    value: flag,
    hint: getDescription(`env.${flag}`),
  }));
  const initialValues = FEATURE_FLAGS.filter(
    (flag) => env[flag] === "1" || env[flag] === "true",
  );

  const enabled = await vimMultiselect({
    message: "Feature flags (j/k navigate, space toggle, ESC back)",
    options: choices,
    required: false,
    initialValues,
  });
  if (isCancel(enabled)) return enabled;

  for (const flag of FEATURE_FLAGS) {
    env[flag] = (enabled as string[]).includes(flag) ? "1" : "0";
  }

  return { ...settings, env };
}

async function configureToolSearch(settings: Settings): Promise<Settings | symbol> {
  const env = { ...(settings.env as Record<string, string> | undefined) };
  const value = await vimSelect({
    message: "Tool search (j/k navigate, ESC back)",
    options: [
      { label: "auto", value: "auto", hint: "Decide automatically based on query" },
      { label: "true", value: "true", hint: "Always enable" },
      { label: "false", value: "false", hint: "Always disable" },
    ],
    initialValue: env.ENABLE_TOOL_SEARCH ?? "auto",
  });
  if (isCancel(value)) return value;
  env.ENABLE_TOOL_SEARCH = value as string;
  return { ...settings, env };
}

async function configurePreferences(settings: Settings): Promise<Settings | symbol> {
  let next = structuredClone(settings);

  const effort = await vimSelect({
    message: "Effort level (j/k navigate, ESC back)",
    options: [
      { label: "low", value: "low", hint: getDescription("effortLevel") },
      { label: "med", value: "med", hint: getDescription("effortLevel") },
      { label: "high", value: "high", hint: getDescription("effortLevel") },
      { label: "xhigh", value: "xhigh", hint: getDescription("effortLevel") },
    ],
    initialValue: (next.effortLevel as string) ?? "high",
  });
  if (isCancel(effort)) return effort;
  next.effortLevel = effort as string;

  const editor = await vimSelect({
    message: "Editor mode (j/k navigate, ESC back)",
    options: [
      { label: "default", value: "default", hint: getDescription("editorMode") },
      { label: "vim", value: "vim", hint: getDescription("editorMode") },
      { label: "emacs", value: "emacs", hint: getDescription("editorMode") },
    ],
    initialValue: (next.editorMode as string) ?? "default",
  });
  if (isCancel(editor)) return editor;
  next.editorMode = editor as string;

  const afterToolSearch = await configureToolSearch(next);
  if (isCancel(afterToolSearch)) return afterToolSearch;
  next = afterToolSearch;

  const rateInput = await text({
    message: "Feedback survey rate (0 = disabled)",
    initialValue: String((next.feedbackSurveyRate as number) ?? 0),
    validate: (v) => {
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > 1) return "Must be a number between 0 and 1";
    },
  });
  if (isCancel(rateInput)) return rateInput;
  next.feedbackSurveyRate = Number(rateInput);

  const boolPrefs = [
    { key: "autoConnectIde", label: "Auto-connect IDE" },
    { key: "autoMemoryEnabled", label: "Auto memory" },
    { key: "awaySummaryEnabled", label: "Away summary" },
    { key: "showClearContextOnPlanAccept", label: "Clear context on plan accept" },
    { key: "includeCoAuthoredBy", label: "Include Co-authored-by in commits" },
    { key: "includeGitInstructions", label: "Include git instructions" },
  ];

  const boolOptions = boolPrefs.map((p) => ({
    label: p.label,
    value: p.key,
    hint: getDescription(p.key),
  }));
  const boolInitialValues = boolPrefs
    .filter((p) => (next[p.key] as boolean) ?? false)
    .map((p) => p.key);

  const enabledBools = await vimMultiselect({
    message: "Preferences (j/k navigate, space toggle, ESC back)",
    options: boolOptions,
    required: false,
    initialValues: boolInitialValues,
  });
  if (isCancel(enabledBools)) return enabledBools;

  for (const p of boolPrefs) {
    next[p.key] = (enabledBools as string[]).includes(p.key);
  }

  return next;
}

async function configureAttribution(settings: Settings): Promise<Settings | symbol> {
  const attr = { ...((settings.attribution as Record<string, string>) ?? { commit: "", pr: "" }) };

  const commit = await text({
    message: "Commit attribution",
    initialValue: attr.commit ?? "",
  });
  if (isCancel(commit)) return commit;
  attr.commit = commit as string;

  const pr = await text({
    message: "PR attribution",
    initialValue: attr.pr ?? "",
  });
  if (isCancel(pr)) return pr;
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
        options: [
          { label: "None — keep current settings", value: "__none__", hint: "Start with your current settings.json values" },
          ...presetList.map(([id, p]) => ({
            label: `${p.name} — ${p.description}`,
            value: id,
            hint: p.description,
          })),
        ],
        initialValue: "__none__",
      });
      if (isCancel(presetChoice)) {
        console.log("Cancelled.");
        return;
      }

      if (presetChoice && presetChoice !== "__none__") {
        settings = applyPreset(settings, presetChoice as string);
        console.log(`Applied preset: ${(manifest._presets as Record<string, { name: string }>)[presetChoice as string].name}\n`);
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
          options: [
            { label: "CC-Router env vars (read-only)", value: "cc-router-env", hint: "View auto-injected environment variables" },
            { label: "Feature flags", value: "features", hint: "Toggle Claude Code behaviors" },
            { label: "Preferences", value: "preferences", hint: "Effort level, editor mode, IDE, misc settings" },
            { label: "Attribution", value: "attribution", hint: "Git commit/PR attribution metadata" },
            { label: "Review & save", value: "save" },
            { label: "Cancel", value: "cancel" },
          ],
        });
        if (isCancel(action)) {
          console.log("Cancelled.");
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
          if (!isCancel(result)) current = result;
          continue;
        }

        if (action === "preferences") {
          const result = await configurePreferences(current);
          if (!isCancel(result)) current = result;
          continue;
        }

        if (action === "attribution") {
          const result = await configureAttribution(current);
          if (!isCancel(result)) current = result;
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

      const ok = await confirm({ message: "Apply these changes?", initialValue: true });
      if (isCancel(ok) || !ok) {
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
