import { describe, it, expect } from "vitest";
import {
  convertMessagesToOpenAI,
  convertRequestToOpenAI,
} from "../../src/converters/messages.js";
import type { AnthropicMessage, AnthropicMessagesRequest } from "../../src/providers/types.js";

describe("convertMessagesToOpenAI", () => {
  // ---- System message extraction ----

  it("extracts a string system prompt as a system message", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Hello" },
    ];

    const result = convertMessagesToOpenAI(messages, "You are helpful.");

    expect(result[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(result[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("extracts an array-form system prompt by joining texts", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Hello" },
    ];

    const result = convertMessagesToOpenAI(messages, [
      { type: "text", text: "Part one." },
      { type: "text", text: "Part two." },
    ]);

    expect(result[0]).toEqual({ role: "system", content: "Part one.\nPart two." });
  });

  it("omits system message when system is undefined", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Hello" },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("omits system message when system is an empty string", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Hello" },
    ];

    const result = convertMessagesToOpenAI(messages, "");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  // ---- Basic text messages ----

  it("converts a simple user text message", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "What is 2+2?" },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toEqual([{ role: "user", content: "What is 2+2?" }]);
  });

  it("converts a simple assistant text message", () => {
    const messages: AnthropicMessage[] = [
      { role: "assistant", content: "The answer is 4." },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toEqual([{ role: "assistant", content: "The answer is 4." }]);
  });

  it("converts multi-turn conversation", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ]);
  });

  // ---- Image blocks ----

  it("converts an image block to an image_url content part", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgo=",
            },
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    const msg = result[0];
    expect(msg.role).toBe("user");
    // When there's a mix of text + image, it becomes an array of content parts
    const parts = msg.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "What is in this image?" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
    });
  });

  // ---- Tool use in assistant ----

  it("converts tool_use blocks in assistant messages to tool_calls", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_abc123",
            name: "get_weather",
            input: { city: "Tokyo" },
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "toolu_abc123",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"city":"Tokyo"}',
          },
        },
      ],
    });
  });

  it("converts mixed text + tool_use in assistant message", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the weather." },
          {
            type: "tool_use",
            id: "toolu_xyz",
            name: "get_weather",
            input: { city: "London" },
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("Let me check the weather.");
    expect(result[0].tool_calls).toEqual([
      {
        id: "toolu_xyz",
        type: "function",
        function: {
          name: "get_weather",
          arguments: '{"city":"London"}',
        },
      },
    ]);
  });

  // ---- Tool result in user ----

  it("converts tool_result blocks to tool role messages", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_abc123",
            content: "Sunny, 22C",
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "tool",
      tool_call_id: "toolu_abc123",
      content: "Sunny, 22C",
    });
  });

  it("stringifies nested content in tool_result", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_def",
            content: [
              { type: "text", text: "Line one" },
              { type: "text", text: "Line two" },
            ],
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "tool",
      tool_call_id: "toolu_def",
      content: "Line one\nLine two",
    });
  });

  // ---- Thinking blocks ----

  it("strips thinking blocks from messages", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal reasoning..." },
          { type: "text", text: "The answer is 42." },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toEqual([{ role: "assistant", content: "The answer is 42." }]);
  });

  // ---- Mixed content in user ----

  it("converts text + tool_result in user message to separate messages", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Here is what I found." },
          {
            type: "tool_result",
            tool_use_id: "toolu_123",
            content: "Result data",
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    // text is one user message, tool_result is a separate tool message
    expect(result).toEqual([
      { role: "user", content: "Here is what I found." },
      { role: "tool", tool_call_id: "toolu_123", content: "Result data" },
    ]);
  });

  it("converts text + image in user to content parts array", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "abcd1234",
            },
          },
        ],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toHaveLength(1);
    const msg = result[0];
    expect(msg.role).toBe("user");
    const parts = msg.content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "Describe this" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,abcd1234" },
    });
  });

  it("simplifies single text-only user content to a string", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Just text" }],
      },
    ];

    const result = convertMessagesToOpenAI(messages);

    expect(result).toEqual([{ role: "user", content: "Just text" }]);
  });
});

describe("convertRequestToOpenAI", () => {
  it("converts a minimal request", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };

    const result = convertRequestToOpenAI(request);

    expect(result).toEqual({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });
  });

  it("converts a full request with all optional fields", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 2048,
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      stop_sequences: ["STOP", "END"],
      system: "You are a helpful assistant.",
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      tool_choice: { type: "auto" },
    };

    const result = convertRequestToOpenAI(request);

    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.max_tokens).toBe(2048);
    expect(result.stream).toBe(true);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stop).toEqual(["STOP", "END"]);
    // system should be extracted into messages
    expect(result.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    // tools should be converted
    expect(result.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      },
    ]);
    expect(result.tool_choice).toBe("auto");
  });

  it("maps tool_choice type 'any' to 'required'", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      tool_choice: { type: "any" },
    };

    const result = convertRequestToOpenAI(request);

    expect(result.tool_choice).toBe("required");
  });

  it("maps tool_choice type 'tool' to function object", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      tool_choice: { type: "tool", name: "get_weather" },
    };

    const result = convertRequestToOpenAI(request);

    expect(result.tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("omits optional fields when not provided", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };

    const result = convertRequestToOpenAI(request);

    expect(result.stream).toBeUndefined();
    expect(result.temperature).toBeUndefined();
    expect(result.top_p).toBeUndefined();
    expect(result.stop).toBeUndefined();
    expect(result.tools).toBeUndefined();
    expect(result.tool_choice).toBeUndefined();
  });

  it("omits stop when stop_sequences is empty", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      stop_sequences: [],
    };

    const result = convertRequestToOpenAI(request);

    expect(result.stop).toBeUndefined();
  });

  it("omits tools when tools is empty", () => {
    const request: AnthropicMessagesRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      tools: [],
    };

    const result = convertRequestToOpenAI(request);

    expect(result.tools).toBeUndefined();
  });
});
