import type { Command } from "commander";
import { createInterface } from "node:readline";
import { select, isCancel, intro, outro } from "@clack/prompts";
import { loadConfig } from "../../config/loader.js";
import { resolveRoute } from "../../router/index.js";
import { createAdapter } from "../../providers/factory.js";
import type { AnthropicMessage } from "../../providers/types.js";

function collectModelOptions(config: ReturnType<typeof loadConfig>): Array<{ label: string; value: string }> {
  const seen = new Set<string>();
  const options: Array<{ label: string; value: string }> = [];

  // Models from provider model lists
  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const modelDef of provider.models ?? []) {
      if (!seen.has(modelDef.id)) {
        seen.add(modelDef.id);
        options.push({
          label: `${modelDef.id} (${providerName})`,
          value: modelDef.id,
        });
      }
    }
  }

  // Route match patterns as fallback / additional options
  for (const route of config.routes) {
    if (!seen.has(route.match)) {
      seen.add(route.match);
      const label = route.model
        ? `${route.match} → ${route.provider} (${route.model})`
        : `${route.match} → ${route.provider}`;
      options.push({ label, value: route.match });
    }
  }

  return options;
}

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Chat with an AI provider to test the connection")
    .option("-m, --model <model>", "Model to use. Omitting enters interactive mode.")
    .option("--no-stream", "Disable streaming")
    .action(async (opts: { model?: string; stream: boolean }) => {
      const config = loadConfig();

      // Interactive model selection when -m is omitted
      if (!opts.model) {
        intro("CC-Router Chat");

        const modelOptions = collectModelOptions(config);

        if (modelOptions.length === 0) {
          outro("No models or routes configured. Run 'cc-router setup' first.");
          process.exit(1);
        }

        const selected = await select({
          message: "Select a model to chat with:",
          options: modelOptions,
        });

        if (isCancel(selected)) {
          outro("Goodbye.");
          process.exit(0);
        }

        opts.model = selected as string;
        outro(`Selected: ${opts.model}`);
      }

      let routeResolution;
      try {
        routeResolution = resolveRoute(opts.model, config);
      } catch (err) {
        console.error(`No route found for model "${opts.model}": ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }

      const providerName = Object.entries(config.providers).find(
        ([, v]) => v === routeResolution.provider,
      )?.[0] ?? "unknown";

      console.log(`\nModel: ${opts.model} → ${providerName} (${routeResolution.resolvedModel})\n`);

      const adapter = createAdapter(routeResolution.provider);
      const history: AnthropicMessage[] = [];
      const useStream = opts.stream;

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const prompt = () => {
        rl.question("You: ", async (input) => {
          const trimmed = input.trim();
          if (!trimmed) {
            prompt();
            return;
          }

          if (trimmed === "/exit" || trimmed === "/quit") {
            console.log("Bye.");
            rl.close();
            process.exit(0);
          }

          if (trimmed === "/clear") {
            history.length = 0;
            console.log("History cleared.\n");
            prompt();
            return;
          }

          history.push({ role: "user", content: trimmed });

          try {
            if (useStream) {
              process.stdout.write("Assistant: ");
              let fullText = "";
              for await (const event of adapter.sendStream(
                { model: routeResolution.resolvedModel, messages: [...history], max_tokens: 4096 },
                routeResolution.resolvedModel,
              )) {
                if (event.event === "content_block_delta") {
                  const delta = (event.data as { delta?: { text?: string } }).delta;
                  if (delta?.text) {
                    process.stdout.write(delta.text);
                    fullText += delta.text;
                  }
                }
              }
              console.log("\n");
              history.push({ role: "assistant", content: fullText });
            } else {
              const response = await adapter.send(
                { model: routeResolution.resolvedModel, messages: [...history], max_tokens: 4096 },
                routeResolution.resolvedModel,
              );
              const text = response.content
                .filter((b): b is { type: "text"; text: string } => b.type === "text")
                .map((b) => b.text)
                .join("");
              console.log(`Assistant: ${text}\n`);
              history.push({ role: "assistant", content: text });
            }
          } catch (err) {
            console.error(`\nError: ${err instanceof Error ? err.message : err}\n`);
          }

          prompt();
        });
      };

      console.log('Type a message to chat. /exit to quit, /clear to reset history.\n');
      prompt();
    });
}
