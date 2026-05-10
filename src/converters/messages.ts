import type {
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicMessagesRequest,
} from "../providers/types.js";
import type { OpenAITool } from "./tools.js";
import { convertToolsToOpenAI } from "./tools.js";

export type OpenAIMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | OpenAIMessageContentPart[];
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?:
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };
}

function stringifyContent(
  content: string | AnthropicContentBlock[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function convertContentBlock(
  block: AnthropicContentBlock,
):
  | { textContent?: string; imageUrl?: unknown; toolCall?: OpenAIToolCall; toolResult?: OpenAIChatMessage }
  | null {
  switch (block.type) {
    case "text":
      return { textContent: block.text };
    case "image":
      return {
        imageUrl: {
          type: "image_url" as const,
          image_url: {
            url: `data:${block.source.media_type};${block.source.type},${block.source.data}`,
          },
        },
      };
    case "tool_use":
      return {
        toolCall: {
          id: block.id,
          type: "function" as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        },
      };
    case "tool_result":
      return {
        toolResult: {
          role: "tool" as const,
          tool_call_id: block.tool_use_id,
          content:
            typeof block.content === "string"
              ? block.content
              : stringifyContent(block.content),
        },
      };
    case "thinking":
      return null;
    default:
      return null;
  }
}

export function convertMessagesToOpenAI(
  messages: AnthropicMessage[],
  system?: string | Array<{ type: "text"; text: string }>,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  if (system != null) {
    const text =
      typeof system === "string"
        ? system
        : system.map((s) => s.text).join("\n");
    if (text) {
      result.push({ role: "system", content: text });
    }
  }

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      let textContent = "";
      const toolCalls: NonNullable<OpenAIChatMessage["tool_calls"]> = [];

      for (const block of msg.content) {
        const converted = convertContentBlock(block);
        if (converted == null) continue;
        if (converted.textContent != null) textContent += converted.textContent;
        if (converted.toolCall != null) toolCalls.push(converted.toolCall);
      }

      result.push({
        role: "assistant",
        content: textContent || null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      });
      continue;
    }

    const userParts: OpenAIMessageContentPart[] = [];
    const toolResults: OpenAIChatMessage[] = [];

    for (const block of msg.content) {
      const converted = convertContentBlock(block);
      if (converted == null) continue;
      if (converted.textContent != null) {
        userParts.push({ type: "text", text: converted.textContent });
      }
      if (converted.imageUrl != null) {
        userParts.push(converted.imageUrl as OpenAIMessageContentPart);
      }
      if (converted.toolResult != null) {
        toolResults.push(converted.toolResult);
      }
    }

    if (userParts.length > 0) {
      result.push({
        role: "user",
        content: userParts.length === 1 && userParts[0].type === "text"
          ? userParts[0].text
          : userParts,
      });
    }
    result.push(...toolResults);
  }

  return result;
}

export function convertRequestToOpenAI(
  request: AnthropicMessagesRequest,
): OpenAIChatCompletionRequest {
  const messages = convertMessagesToOpenAI(
    request.messages,
    request.system,
  );

  const result: OpenAIChatCompletionRequest = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
  };

  if (request.stream != null) result.stream = request.stream;
  if (request.temperature != null) result.temperature = request.temperature;
  if (request.top_p != null) result.top_p = request.top_p;
  if (request.stop_sequences != null && request.stop_sequences.length > 0) {
    result.stop = request.stop_sequences;
  }
  if (request.tools != null && request.tools.length > 0) {
    result.tools = convertToolsToOpenAI(request.tools);
  }
  if (request.tool_choice != null) {
    if (request.tool_choice.type === "auto") {
      result.tool_choice = "auto";
    } else if (request.tool_choice.type === "any") {
      result.tool_choice = "required";
    } else if (request.tool_choice.type === "tool") {
      result.tool_choice = {
        type: "function",
        function: { name: request.tool_choice.name },
      };
    }
  }

  return result;
}
