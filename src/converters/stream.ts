import type {
  AnthropicSSEEvent,
} from "../providers/types.js";
import { generateMessageId } from "../utils/id.js";
import { parseSSEStream } from "../utils/sse.js";
import type { ReadableStream } from "node:stream/web";

interface ToolCallBuffer {
  id: string;
  name: string;
  arguments: string;
}

export async function* convertOpenAIStreamToAnthropic(
  body: ReadableStream<Uint8Array>,
  model: string,
): AsyncIterable<AnthropicSSEEvent> {
  let messageStarted = false;
  let openBlockIndex: number | null = null;
  let openBlockType: "text" | "tool_use" | null = null;
  const toolCalls = new Map<number, ToolCallBuffer>();
  let outputTokenCount = 0;
  let inputTokens = 0;

  function closeOpenBlock(): AnthropicSSEEvent | null {
    if (openBlockIndex == null) return null;
    const idx = openBlockIndex;
    openBlockIndex = null;
    openBlockType = null;
    return {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: idx },
    };
  }

  function emitMessageStart(): AnthropicSSEEvent {
    return {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: generateMessageId(),
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    };
  }

  function openTextBlock(index: number): AnthropicSSEEvent {
    openBlockIndex = index;
    openBlockType = "text";
    return {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      },
    };
  }

  function openToolUseBlock(
    index: number,
    tc: ToolCallBuffer,
  ): AnthropicSSEEvent {
    openBlockIndex = index;
    openBlockType = "tool_use";
    return {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: {},
        },
      },
    };
  }

  let blockIndex = 0;

  for await (const sse of parseSSEStream(body)) {
    if (sse.data === "[DONE]") {
      const closeEvent = closeOpenBlock();
      if (closeEvent != null) yield closeEvent;

      if (messageStarted) {
        yield {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: outputTokenCount },
          },
        };
        yield {
          event: "message_stop",
          data: { type: "message_stop" },
        };
      }
      return;
    }

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(sse.data);
    } catch {
      continue;
    }

    if (!messageStarted) {
      inputTokens =
        (chunk as { usage?: { prompt_tokens?: number } }).usage
          ?.prompt_tokens ?? 0;

      yield emitMessageStart();
      messageStarted = true;
    }

    const choices = chunk.choices as
      | Array<{
          delta: {
            role?: string;
            content?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>
      | undefined;

    if (choices == null || choices.length === 0) continue;

    const choice = choices[0];
    const delta = choice.delta;

    if (delta.content != null && delta.content !== "") {
      if (openBlockType !== "text") {
        const closeEvent = closeOpenBlock();
        if (closeEvent != null) yield closeEvent;
        yield openTextBlock(blockIndex);
        blockIndex++;
      }

      outputTokenCount += 1;
      yield {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: openBlockIndex!,
          delta: { type: "text_delta", text: delta.content },
        },
      };
    }

    if (delta.tool_calls != null) {
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index;

        if (tc.id != null && tc.function?.name != null) {
          toolCalls.set(tcIndex, {
            id: tc.id,
            name: tc.function.name,
            arguments: "",
          });

          const closeEvent = closeOpenBlock();
          if (closeEvent != null) yield closeEvent;

          const buffered = toolCalls.get(tcIndex)!;
          yield openToolUseBlock(blockIndex, buffered);
          blockIndex++;
        }

        if (
          tc.function?.arguments != null &&
          tc.function.arguments !== "" &&
          toolCalls.has(tcIndex)
        ) {
          const buffered = toolCalls.get(tcIndex)!;
          buffered.arguments += tc.function.arguments;

          outputTokenCount += 1;
          yield {
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index: openBlockIndex!,
              delta: {
                type: "input_json_delta",
                partial_json: tc.function.arguments,
              },
            },
          };
        }
      }
    }

    if (choice.finish_reason != null) {
      const finishMap: Record<string, string> = {
        stop: "end_turn",
        tool_calls: "tool_use",
        length: "max_tokens",
      };
      const stopReason =
        finishMap[choice.finish_reason] ?? choice.finish_reason;

      const closeEvent = closeOpenBlock();
      if (closeEvent != null) yield closeEvent;

      yield {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: outputTokenCount },
        },
      };
      yield {
        event: "message_stop",
        data: { type: "message_stop" },
      };
      return;
    }
  }

  if (messageStarted) {
    const closeEvent = closeOpenBlock();
    if (closeEvent != null) yield closeEvent;

    yield {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: outputTokenCount },
      },
    };
    yield {
      event: "message_stop",
      data: { type: "message_stop" },
    };
  }
}
