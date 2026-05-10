import { describe, it, expect, vi } from "vitest";
import { convertResponseToAnthropic, mapFinishReason } from "../../src/converters/openai-to-anthropic.js";
import type { OpenAIChatCompletionResponse } from "../../src/converters/openai-to-anthropic.js";

// Mock generateMessageId so IDs are deterministic in tests
vi.mock("../../src/utils/id.js", () => ({
  generateMessageId: () => "msg_test123",
}));

describe("mapFinishReason", () => {
  it("maps 'stop' to 'end_turn'", () => {
    expect(mapFinishReason("stop")).toBe("end_turn");
  });

  it("maps 'tool_calls' to 'tool_use'", () => {
    expect(mapFinishReason("tool_calls")).toBe("tool_use");
  });

  it("maps 'length' to 'max_tokens'", () => {
    expect(mapFinishReason("length")).toBe("max_tokens");
  });

  it("passes through unknown reasons", () => {
    expect(mapFinishReason("content_filter")).toBe("content_filter");
  });

  it("returns null for null input", () => {
    expect(mapFinishReason(null)).toBeNull();
  });
});

describe("convertResponseToAnthropic", () => {
  function makeResponse(
    overrides: Partial<OpenAIChatCompletionResponse> = {},
  ): OpenAIChatCompletionResponse {
    return {
      id: "chatcmpl-abc",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "gpt-4o",
      ...overrides,
    };
  }

  it("converts a text-only response", () => {
    const response = makeResponse();

    const result = convertResponseToAnthropic(response, "claude-sonnet-4-20250514");

    expect(result).toEqual({
      id: "msg_test123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello!" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  it("converts a tool calls response", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"city":"Paris"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "claude-sonnet-4-20250514");

    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: "call_abc",
        name: "get_weather",
        input: { city: "Paris" },
      },
    ]);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("converts mixed text + tool calls response", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me look that up.",
            tool_calls: [
              {
                id: "call_xyz",
                type: "function",
                function: {
                  name: "search",
                  arguments: '{"query":"test"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "claude-sonnet-4-20250514");

    expect(result.content).toEqual([
      { type: "text", text: "Let me look that up." },
      {
        type: "tool_use",
        id: "call_xyz",
        name: "search",
        input: { query: "test" },
      },
    ]);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("converts multiple tool calls", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "fn_a", arguments: '{"a":1}' },
              },
              {
                id: "call_2",
                type: "function",
                function: { name: "fn_b", arguments: '{"b":2}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "claude-sonnet-4-20250514");

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: "tool_use",
      id: "call_1",
      name: "fn_a",
      input: { a: 1 },
    });
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "call_2",
      name: "fn_b",
      input: { b: 2 },
    });
  });

  it("maps finish_reason 'length' to 'max_tokens'", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Truncated..." },
          finish_reason: "length",
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "model");

    expect(result.stop_reason).toBe("max_tokens");
  });

  it("maps finish_reason null to null", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello" },
          finish_reason: null,
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "model");

    expect(result.stop_reason).toBeNull();
  });

  it("maps usage correctly", () => {
    const response = makeResponse({
      usage: { prompt_tokens: 42, completion_tokens: 13, total_tokens: 55 },
    });

    const result = convertResponseToAnthropic(response, "model");

    expect(result.usage).toEqual({ input_tokens: 42, output_tokens: 13 });
  });

  it("returns empty content when message content is empty string", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "model");

    // Empty string is falsy, so content array should be empty
    expect(result.content).toEqual([]);
  });

  it("returns empty content when message content is null and no tool_calls", () => {
    const response = makeResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: null },
          finish_reason: "stop",
        },
      ],
    });

    const result = convertResponseToAnthropic(response, "model");

    expect(result.content).toEqual([]);
  });

  it("uses the provided model parameter, not the response model", () => {
    const response = makeResponse(); // model: "gpt-4o"

    const result = convertResponseToAnthropic(response, "claude-opus-4-20250514");

    expect(result.model).toBe("claude-opus-4-20250514");
  });
});
