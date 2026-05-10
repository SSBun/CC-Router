import type {
  ProviderAdapter,
  ProviderConfig,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicSSEEvent,
} from "./types.js";
import { parseSSEStream } from "../utils/sse.js";
import { logger } from "../utils/logger.js";

export class AnthropicAdapter implements ProviderAdapter {
  constructor(private config: ProviderConfig) {}

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.config.api_key,
      "anthropic-version": "2023-06-01",
      ...this.config.headers,
    };
  }

  async send(
    request: AnthropicMessagesRequest,
    model: string,
  ): Promise<AnthropicMessagesResponse> {
    const url = `${this.config.base_url}/v1/messages`;
    const body = { ...request, model, stream: false };

    logger.debug({ url, model }, "Anthropic adapter: sending request");

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    return data;
  }

  async *sendStream(
    request: AnthropicMessagesRequest,
    model: string,
  ): AsyncIterable<AnthropicSSEEvent> {
    const url = `${this.config.base_url}/v1/messages`;
    const body = { ...request, model, stream: true };

    logger.debug({ url, model }, "Anthropic adapter: sending stream request");

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const responseBody = response.body;
    if (!responseBody) {
      throw new Error("Anthropic stream response has no body");
    }

    for await (const sse of parseSSEStream(responseBody as ReadableStream<Uint8Array>)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(sse.data);
      } catch {
        continue;
      }
      yield { event: sse.event ?? "message", data: parsed };
    }
  }

  private async handleError(response: Response): Promise<never> {
    let message: string;
    try {
      const body = (await response.json()) as {
        error?: { type?: string; message?: string };
      };
      if (body.error?.message) {
        message = `Anthropic API error (${response.status}): ${body.error.type ?? "unknown"} — ${body.error.message}`;
      } else {
        message = `Anthropic API error (${response.status}): ${JSON.stringify(body)}`;
      }
    } catch {
      message = `Anthropic API error (${response.status}): ${response.statusText}`;
    }
    throw new Error(message);
  }
}
