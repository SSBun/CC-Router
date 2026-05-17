import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppConfig } from "../../config/schema.js";
import { resolveRoute } from "../../router/index.js";
import { createAdapter } from "../../providers/factory.js";
import { logger } from "../../utils/logger.js";
import type { MetricsCollector } from "../middleware/metrics.js";
import type {
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
} from "../../providers/types.js";

export function createMessagesHandler(
  config: AppConfig,
  metrics: MetricsCollector,
  isTrace: boolean,
) {
  return async (c: Context) => {
    const body =
      c.get("parsedBody") as AnthropicMessagesRequest | undefined ??
      (await c.req.json<AnthropicMessagesRequest>());
    const { model } = body;

    if (!model) {
      return c.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "model is required",
          },
        },
        400,
      );
    }

    const routeResolution = resolveRoute(model, config);
    const adapter = createAdapter(routeResolution.provider);
    const providerName =
      Object.entries(config.providers).find(
        ([, p]) => p === routeResolution.provider,
      )?.[0] ?? "unknown";

    const startTime = Date.now();

    if (body.stream) {
      return streamSSE(c, async (stream) => {
        let streamUsage: {
          input_tokens: number;
          output_tokens: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        } | null = null;

        try {
          for await (const event of adapter.sendStream(
            body,
            routeResolution.resolvedModel,
          )) {
            // Capture usage from SSE events
            if (event.event === "message_start" && streamUsage === null) {
              const data = event.data as {
                message?: { usage?: AnthropicMessagesResponse["usage"] };
              };
              const usage = data.message?.usage;
              if (usage) {
                streamUsage = {
                  input_tokens: usage.input_tokens ?? 0,
                  output_tokens: 0,
                  cache_creation_input_tokens:
                    usage.cache_creation_input_tokens ?? 0,
                  cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
                };
              }
            }
            if (event.event === "message_delta") {
              const data = event.data as {
                usage?: { output_tokens?: number };
              };
              if (streamUsage && data.usage?.output_tokens != null) {
                streamUsage.output_tokens = data.usage.output_tokens;
              }
            }

            await stream.writeSSE({
              event: event.event,
              data: JSON.stringify(event.data),
            });
          }

          // Record successful stream
          const latencyMs = Date.now() - startTime;
          const syntheticResponse: AnthropicMessagesResponse | null =
            streamUsage
              ? {
                  id: "",
                  type: "message",
                  role: "assistant",
                  content: [],
                  model,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: streamUsage,
                }
              : null;
          metrics.record(
            body,
            routeResolution.resolvedModel,
            providerName,
            syntheticResponse,
            latencyMs,
            null,
            isTrace,
          );
        } catch (err) {
          logger.error({ err, model }, "Stream error");

          // Record errored stream
          const latencyMs = Date.now() - startTime;
          const errMsg =
            err instanceof Error ? err.message : "Stream error";
          metrics.record(
            body,
            routeResolution.resolvedModel,
            providerName,
            null,
            latencyMs,
            errMsg,
            isTrace,
          );

          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              type: "error",
              error: {
                type: "api_error",
                message: errMsg,
              },
            }),
          });
        }
      });
    }

    try {
      const response = await adapter.send(body, routeResolution.resolvedModel);
      const latencyMs = Date.now() - startTime;
      metrics.record(
        body,
        routeResolution.resolvedModel,
        providerName,
        response,
        latencyMs,
        null,
        isTrace,
      );
      return c.json(response);
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : "Unknown error";
      metrics.record(
        body,
        routeResolution.resolvedModel,
        providerName,
        null,
        latencyMs,
        message,
        isTrace,
      );
      const status = message.includes("401") ? 401
        : message.includes("403") ? 403
        : message.includes("404") ? 404
        : message.includes("429") ? 429
        : 502;
      return c.json(
        {
          type: "error",
          error: {
            type: status === 429 ? "rate_limit_error"
              : status === 401 ? "authentication_error"
              : status === 403 ? "permission_error"
              : status === 404 ? "not_found_error"
              : "api_error",
            message,
          },
        },
        status as 401,
      );
    }
  };
}
