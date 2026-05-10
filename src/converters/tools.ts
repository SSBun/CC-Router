import type { AnthropicTool } from "../providers/types.js";

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export function convertToolsToOpenAI(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      ...(tool.description != null && { description: tool.description }),
      parameters: tool.input_schema,
    },
  }));
}
