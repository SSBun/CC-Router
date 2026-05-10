import type {
  ProviderAdapter,
  ProviderConfig,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicSSEEvent,
} from "./types.js";
import { convertRequestToOpenAI } from "../converters/messages.js";
import { convertResponseToAnthropic } from "../converters/openai-to-anthropic.js";
import { convertOpenAIStreamToAnthropic } from "../converters/stream.js";
import { logger } from "../utils/logger.js";

export class OpenAIAdapter implements ProviderAdapter {
  constructor(private config: ProviderConfig) {}

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.config.api_key}`,
      ...this.config.headers,
    };
  }

  async send(
    request: AnthropicMessagesRequest,
    model: string,
  ): Promise<AnthropicMessagesResponse> {
    const url = `${this.config.base_url}/chat/completions`;
    const openaiRequest = convertRequestToOpenAI(request);
    openaiRequest.model = model;
    openaiRequest.stream = false;

    logger.debug({ url, model }, "OpenAI adapter: sending request");

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const openaiResponse = (await response.json()) as {
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
    };

    return convertResponseToAnthropic(openaiResponse, model);
  }

  async *sendStream(
    request: AnthropicMessagesRequest,
    model: string,
  ): AsyncIterable<AnthropicSSEEvent> {
    const url = `${this.config.base_url}/chat/completions`;
    const openaiRequest = convertRequestToOpenAI(request);
    openaiRequest.model = model;
    openaiRequest.stream = true;

    logger.debug({ url, model }, "OpenAI adapter: sending stream request");

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(openaiRequest),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const responseBody = response.body;
    if (!responseBody) {
      throw new Error("OpenAI stream response has no body");
    }

    yield* convertOpenAIStreamToAnthropic(
      responseBody as ReadableStream<Uint8Array>,
      model,
    );
  }

  private async handleError(response: Response): Promise<never> {
    let message: string;
    try {
      const body = (await response.json()) as {
        error?: { message?: string; type?: string; code?: string };
      };
      if (body.error?.message) {
        message = `OpenAI API error (${response.status}): ${body.error.type ?? "unknown"} [${body.error.code ?? "N/A"}] — ${body.error.message}`;
      } else {
        message = `OpenAI API error (${response.status}): ${JSON.stringify(body)}`;
      }
    } catch {
      message = `OpenAI API error (${response.status}): ${response.statusText}`;
    }
    throw new Error(message);
  }
}
