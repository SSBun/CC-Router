import type { Command } from "commander";
import {
  lookupDb,
  formatContext,
} from "../../model-info/resolver.js";
import modelDb from "../../data/model-db.json" with { type: "json" };
import type { ModelDbEntry } from "../../model-info/resolver.js";

const DB = (modelDb as { models: Record<string, ModelDbEntry> }).models;

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function renderTable(): void {
  const entries = Object.values(DB);
  const cols = {
    id: Math.max(2, ...entries.map((e) => e.id.length)),
    display: Math.max(12, ...entries.map((e) => e.display_name.length)),
    ctx: 14,
    out: 13,
  };

  const sep = (left: string, mid: string, right: string) =>
    left + "─".repeat(cols.id + 2) + mid
      + "─".repeat(cols.display + 2) + mid
      + "─".repeat(cols.ctx + 2) + mid
      + "─".repeat(cols.out + 2) + right;

  const row = (id: string, display: string, ctx: string, out: string) =>
    `│ ${pad(id, cols.id)} │ ${pad(display, cols.display)} │ ${pad(ctx, cols.ctx)} │ ${pad(out, cols.out)} │`;

  console.log(sep("┌", "┬", "┐"));
  console.log(row("ID", "Display Name", "Context Window", "Max Output"));
  console.log(sep("├", "┼", "┤"));

  for (const e of entries) {
    console.log(row(e.id, e.display_name, formatContext(e.context_window), formatContext(e.max_output_tokens)));
  }

  console.log(sep("└", "┴", "┘"));
}

export function registerModelsCommand(program: Command): void {
  program
    .command("models")
    .description("Query the built-in model database")
    .argument("[id]", "Model ID to look up (case-insensitive)")
    .action((id?: string) => {
      if (id) {
        const entry = lookupDb(id);
        if (!entry) {
          console.log(`Model "${id}" not found in database.`);
          process.exit(1);
        }
        console.log(`  ${entry.display_name} (${entry.id})`);
        console.log(`    context_window:    ${formatContext(entry.context_window)}`);
        console.log(`    max_output_tokens: ${formatContext(entry.max_output_tokens)}`);
        console.log(`    description:       ${entry.description}`);
        return;
      }

      const entries = Object.values(DB);
      console.log(`Built-in model database (${entries.length} models):\n`);
      renderTable();
    });
}
