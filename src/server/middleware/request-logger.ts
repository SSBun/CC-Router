import type { Context, Next } from "hono";
import { logger } from "../../utils/logger.js";
import type { AnthropicMessagesRequest } from "../../providers/types.js";

function summarizeMessages(messages: AnthropicMessagesRequest["messages"]) {
  let userCount = 0;
  let assistantCount = 0;
  let hasImages = false;
  let hasToolUse = false;
  let hasToolResult = false;
  let hasThinking = false;

  for (const msg of messages) {
    if (msg.role === "user") userCount++;
    else assistantCount++;

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "image") hasImages = true;
        else if (block.type === "tool_use") hasToolUse = true;
        else if (block.type === "tool_result") hasToolResult = true;
        else if (block.type === "thinking") hasThinking = true;
      }
    }
  }

  const flags: string[] = [];
  if (hasImages) flags.push("images");
  if (hasToolUse) flags.push("tool_use");
  if (hasToolResult) flags.push("tool_result");
  if (hasThinking) flags.push("thinking");

  return `${messages.length} total (${userCount} user, ${assistantCount} assistant)${flags.length ? " [" + flags.join(", ") + "]" : ""}`;
}

export async function requestLogger(c: Context, next: Next) {
  if (c.req.method !== "POST") {
    return next();
  }

  const body = await c.req.json<AnthropicMessagesRequest>();
  c.set("parsedBody", body);

  const pinoLevels = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
  const currentLevel = pinoLevels[logger.level as keyof typeof pinoLevels] ?? 30;

  if (currentLevel <= pinoLevels.debug) {
    const summary: Record<string, unknown> = {
      model: body.model,
      stream: body.stream ?? false,
      max_tokens: body.max_tokens,
      messages: summarizeMessages(body.messages),
    };

    if (body.tools?.length) {
      summary.tools = body.tools.map((t) => t.name);
    }

    if (body.system) {
      summary.system_length =
        typeof body.system === "string"
          ? body.system.length
          : body.system.reduce((sum, b) => sum + b.text.length, 0);
    }

    if (body.thinking) {
      summary.thinking_budget = body.thinking.budget_tokens;
    }

    if (body.tool_choice) {
      summary.tool_choice =
        body.tool_choice.type === "tool"
          ? `tool:${body.tool_choice.name}`
          : body.tool_choice.type;
    }

    if (body.temperature !== undefined) summary.temperature = body.temperature;
    if (body.top_p !== undefined) summary.top_p = body.top_p;
    if (body.top_k !== undefined) summary.top_k = body.top_k;

    logger.debug(summary, "Incoming request");
  }

  logger.trace({ body }, "Full request payload");

  await next();
}
