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
    input: 14,
    out: 13,
  };

  const sep = (left: string, mid: string, right: string) =>
    left + "─".repeat(cols.id + 2) + mid
      + "─".repeat(cols.display + 2) + mid
      + "─".repeat(cols.input + 2) + mid
      + "─".repeat(cols.out + 2) + right;

  const row = (id: string, display: string, input: string, out: string) =>
    `│ ${pad(id, cols.id)} │ ${pad(display, cols.display)} │ ${pad(input, cols.input)} │ ${pad(out, cols.out)} │`;

  console.log(sep("┌", "┬", "┐"));
  console.log(row("ID", "Display Name", "Max Input", "Max Tokens"));
  console.log(sep("├", "┼", "┤"));

  for (const e of entries) {
    console.log(row(e.id, e.display_name, formatContext(e.max_input_tokens), formatContext(e.max_tokens)));
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
        console.log(`    max_input_tokens: ${formatContext(entry.max_input_tokens)}`);
        console.log(`    max_tokens:       ${formatContext(entry.max_tokens)}`);
        console.log(`    description:      ${entry.description}`);
        return;
      }

      const entries = Object.values(DB);
      console.log(`Built-in model database (${entries.length} models):\n`);
      renderTable();
    });
}
