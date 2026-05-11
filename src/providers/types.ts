export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: string; media_type: string; data: string };
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | AnthropicContentBlock[];
    }
  | { type: "thinking"; thinking: string; signature?: string };

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream?: boolean;
  system?: string | Array<{ type: "text"; text: string }>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?:
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string };
  thinking?: { type: "enabled"; budget_tokens: number };
  metadata?: Record<string, unknown>;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface AnthropicSSEEvent {
  event: string;
  data: unknown;
}

export interface ProviderConfig {
  type: "anthropic-compatible" | "openai-compatible";
  api_key: string;
  base_url: string;
  headers?: Record<string, string>;
  models?: string[];
}

export interface ProviderAdapter {
  send(
    request: AnthropicMessagesRequest,
    model: string,
  ): Promise<AnthropicMessagesResponse>;
  sendStream(
    request: AnthropicMessagesRequest,
    model: string,
  ): AsyncIterable<AnthropicSSEEvent>;
}

export interface RouteResolution {
  provider: ProviderConfig;
  resolvedModel: string;
}
