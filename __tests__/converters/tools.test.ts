import { describe, it, expect } from "vitest";
import { convertToolsToOpenAI } from "../../src/converters/tools.js";
import type { AnthropicTool } from "../../src/providers/types.js";

describe("convertToolsToOpenAI", () => {
  it("converts a single tool", () => {
    const tools: AnthropicTool[] = [
      {
        name: "get_weather",
        description: "Get the current weather in a location",
        input_schema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
          },
          required: ["city"],
        },
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather in a location",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
            },
            required: ["city"],
          },
        },
      },
    ]);
  });

  it("converts multiple tools", () => {
    const tools: AnthropicTool[] = [
      {
        name: "search",
        description: "Search the web",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
      {
        name: "calculator",
        description: "Evaluate math expressions",
        input_schema: {
          type: "object",
          properties: { expr: { type: "string" } },
          required: ["expr"],
        },
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe("search");
    expect(result[1].function.name).toBe("calculator");
  });

  it("omits description when not provided", () => {
    const tools: AnthropicTool[] = [
      {
        name: "no_desc",
        input_schema: { type: "object", properties: {} },
      },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result[0].function.description).toBeUndefined();
  });

  it("preserves the input_schema as parameters", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a"],
      additionalProperties: false,
    };

    const tools: AnthropicTool[] = [
      { name: "test", input_schema: schema },
    ];

    const result = convertToolsToOpenAI(tools);

    expect(result[0].function.parameters).toEqual(schema);
  });
});
