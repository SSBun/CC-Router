import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppConfig } from "../../config/schema.js";
import { resolveRoute } from "../../router/index.js";
import { createAdapter } from "../../providers/factory.js";
import { logger } from "../../utils/logger.js";
import type { AnthropicMessagesRequest } from "../../providers/types.js";

export function createMessagesHandler(config: AppConfig) {
  return async (c: Context) => {
    const body = await c.req.json<AnthropicMessagesRequest>();
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

    if (body.stream) {
      return streamSSE(c, async (stream) => {
        try {
          for await (const event of adapter.sendStream(body, routeResolution.resolvedModel)) {
            await stream.writeSSE({
              event: event.event,
              data: JSON.stringify(event.data),
            });
          }
        } catch (err) {
          logger.error({ err, model }, "Stream error");
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              type: "error",
              error: {
                type: "api_error",
                message: err instanceof Error ? err.message : "Stream error",
              },
            }),
          });
        }
      });
    }

    try {
      const response = await adapter.send(body, routeResolution.resolvedModel);
      return c.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
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
