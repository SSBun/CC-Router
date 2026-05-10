import { describe, it, expect, vi } from "vitest";
import { convertOpenAIStreamToAnthropic } from "../../src/converters/stream.js";

// Mock generateMessageId for deterministic output
vi.mock("../../src/utils/id.js", () => ({
  generateMessageId: () => "msg_stream_test",
}));

/**
 * Helper: build a ReadableStream<Uint8Array> from SSE-formatted strings.
 * Each entry in `sseLines` becomes one SSE event block (data line(s) + optional event line).
 */
function buildSSEStream(sseLines: string[]): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(sseLines.join("\n\n") + "\n\n");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

/**
 * Helper: build a ReadableStream from OpenAI-style chunk objects.
 * Each chunk is serialized as `data: <JSON>` and the stream ends with `data: [DONE]`.
 */
function buildOpenAIStream(
  chunks: Record<string, unknown>[],
  addDone = true,
): ReadableStream<Uint8Array> {
  const lines: string[] = [];
  for (const chunk of chunks) {
    lines.push(`data: ${JSON.stringify(chunk)}`);
  }
  if (addDone) {
    lines.push("data: [DONE]");
  }
  return buildSSEStream(lines);
}

/** Collect all events from the async iterable into an array. */
async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  model: string,
) {
  const events: Array<{ event: string; data: unknown }> = [];
  for await (const ev of convertOpenAIStreamToAnthropic(stream, model)) {
    events.push(ev);
  }
  return events;
}

describe("convertOpenAIStreamToAnthropic", () => {
  it("emits text-only streaming events in the correct order", async () => {
    const stream = buildOpenAIStream([
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Hello" },
            finish_reason: null,
          },
        ],
        usage: { prompt_tokens: 5 },
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { content: " world" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      },
    ]);

    const events = await collectEvents(stream, "claude-sonnet-4-20250514");

    // Expected sequence:
    // 1. message_start
    // 2. content_block_start (text)
    // 3. content_block_delta (Hello)
    // 4. content_block_delta ( world)
    // 5. content_block_stop
    // 6. message_delta (stop_reason: end_turn)
    // 7. message_stop
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // Verify message_start
    const msgStart = events[0].data as Record<string, unknown>;
    expect(msgStart.type).toBe("message_start");
    const msg = (msgStart as { message: Record<string, unknown> }).message;
    expect(msg.model).toBe("claude-sonnet-4-20250514");
    expect(msg.role).toBe("assistant");

    // Verify content_block_start
    const blockStart = events[1].data as Record<string, unknown>;
    expect(blockStart).toEqual({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    });

    // Verify deltas
    const delta1 = events[2].data as Record<string, unknown>;
    expect(delta1).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    });
    const delta2 = events[3].data as Record<string, unknown>;
    expect(delta2).toEqual({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " world" },
    });

    // Verify message_delta stop_reason
    const msgDelta = events[5].data as Record<string, unknown>;
    expect((msgDelta as { delta: Record<string, unknown> }).delta.stop_reason).toBe("end_turn");
  });

  it("emits tool call streaming events", async () => {
    const stream = buildOpenAIStream([
      {
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: null },
            finish_reason: null,
          },
        ],
        usage: { prompt_tokens: 10 },
      },
      {
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "get_weather", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"city":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '"Tokyo"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-2",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);

    const events = await collectEvents(stream, "claude-sonnet-4-20250514");

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // content_block_start should be a tool_use block
    const blockStart = events[1].data as Record<string, unknown>;
    expect(blockStart).toEqual({
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "call_abc",
        name: "get_weather",
        input: {},
      },
    });

    // Verify input_json_delta events
    const delta1 = events[2].data as Record<string, unknown>;
    expect((delta1 as { delta: Record<string, unknown> }).delta).toEqual({
      type: "input_json_delta",
      partial_json: '{"city":',
    });
    const delta2 = events[3].data as Record<string, unknown>;
    expect((delta2 as { delta: Record<string, unknown> }).delta).toEqual({
      type: "input_json_delta",
      partial_json: '"Tokyo"}',
    });

    // Verify stop_reason is tool_use
    const msgDelta = events[5].data as Record<string, unknown>;
    expect((msgDelta as { delta: Record<string, unknown> }).delta.stop_reason).toBe("tool_use");
  });

  it("emits events for multiple tool calls", async () => {
    const stream = buildOpenAIStream([
      {
        id: "chatcmpl-3",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
        usage: { prompt_tokens: 5 },
      },
      {
        id: "chatcmpl-3",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "fn_a", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-3",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"a":1}' },
                },
                {
                  index: 1,
                  id: "call_2",
                  type: "function",
                  function: { name: "fn_b", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-3",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  function: { arguments: '{"b":2}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-3",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: {}, finish_reason: "tool_calls" },
        ],
      },
    ]);

    const events = await collectEvents(stream, "claude-sonnet-4-20250514");

    // Expected:
    // message_start
    // content_block_start (tool_use 0)
    // content_block_delta (fn_a args)
    // content_block_stop (close tool_use 0)
    // content_block_start (tool_use 1)
    // content_block_delta (fn_b args)
    // content_block_stop (close tool_use 1)
    // message_delta
    // message_stop
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // First tool use block
    const start0 = events[1].data as Record<string, unknown>;
    const cb0 = (start0 as { content_block: Record<string, unknown> }).content_block;
    expect(cb0.id).toBe("call_1");
    expect(cb0.name).toBe("fn_a");

    // Second tool use block
    const start1 = events[4].data as Record<string, unknown>;
    const cb1 = (start1 as { content_block: Record<string, unknown> }).content_block;
    expect(cb1.id).toBe("call_2");
    expect(cb1.name).toBe("fn_b");
  });

  it("handles [DONE] termination without finish_reason", async () => {
    const stream = buildOpenAIStream([
      {
        id: "chatcmpl-4",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null },
        ],
        usage: { prompt_tokens: 3 },
      },
      // No finish_reason chunk, just [DONE]
    ]);

    const events = await collectEvents(stream, "claude-sonnet-4-20250514");

    const eventTypes = events.map((e) => e.event);
    // Should still emit content_block_stop, message_delta, message_stop
    expect(eventTypes).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    // The [DONE] path should set stop_reason to end_turn
    const msgDelta = events[4].data as Record<string, unknown>;
    expect((msgDelta as { delta: Record<string, unknown> }).delta.stop_reason).toBe("end_turn");
  });

  it("produces no events for an empty stream with only [DONE]", async () => {
    const stream = buildOpenAIStream([]);

    const events = await collectEvents(stream, "claude-sonnet-4-20250514");

    // No chunks, no message_started, so no events at all
    expect(events).toEqual([]);
  });
});
