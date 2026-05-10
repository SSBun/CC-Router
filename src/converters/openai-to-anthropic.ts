import type { AnthropicMessagesResponse } from "../providers/types.js";
import { generateMessageId } from "../utils/id.js";

export interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
  model: string;
}

export function mapFinishReason(
  reason: string | null,
): string | null {
  if (reason == null) return null;
  const map: Record<string, string> = {
    stop: "end_turn",
    tool_calls: "tool_use",
    length: "max_tokens",
  };
  return map[reason] ?? reason;
}

export function convertResponseToAnthropic(
  response: OpenAIChatCompletionResponse,
  model: string,
): AnthropicMessagesResponse {
  const choice = response.choices[0];
  const message = choice.message;
  const content: AnthropicMessagesResponse["content"] = [];

  if (message.content) {
    content.push({ type: "text", text: message.content });
  }

  if (message.tool_calls != null && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    id: generateMessageId(),
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
    },
  };
}
