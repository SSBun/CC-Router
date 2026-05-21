import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppConfig } from "../../config/schema.js";
import type { MetricsCollector, RequestRecord } from "../middleware/metrics.js";
import type { MetricsStore } from "../middleware/metrics-store.js";
import modelDb from "../../data/model-db.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return "****";
  }
  return key.slice(0, 4) + "****" + key.slice(-4);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function createApiRoutes(
  config: AppConfig,
  metrics: MetricsCollector,
  isTrace: boolean,
  store: MetricsStore,
) {
  return {
    stats(c: Context) {
      return c.json(metrics.getStats());
    },

    requests(c: Context) {
      const limit = Number(c.req.query("limit")) || 100;
      const offset = Number(c.req.query("offset")) || 0;
      const records = metrics.getRequests(limit, offset);
      return c.json({
        limit,
        offset,
        total: records.length,
        data: records,
      });
    },

    requestById(c: Context) {
      const id = c.req.param("id") ?? "";
      const record = metrics.getRequestById(id);
      if (!record) {
        return c.json({ error: "Not found" }, 404);
      }
      return c.json(record);
    },

    history(c: Context) {
      const limit = Number(c.req.query("limit")) || 100;
      const offset = Number(c.req.query("offset")) || 0;
      const total = store.getHistoryCount();
      const data = store.getHistory(limit, offset);
      return c.json({ limit, offset, total, data });
    },

    events(c: Context) {
      return streamSSE(c, async (stream) => {
        // Send initial ping
        await stream.writeSSE({ event: "ping", data: "" });

        // Subscribe to new records
        const unsubscribe = metrics.onRecord(async (record: RequestRecord) => {
          const summary = {
            id: record.id,
            timestamp: record.timestamp,
            model: record.model,
            resolvedModel: record.resolvedModel,
            provider: record.provider,
            stream: record.stream,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            toolCount: record.toolCount,
            toolNames: record.toolNames,
            messageCount: record.messageCount,
            hasThinking: record.hasThinking,
            thinkingBudget: record.thinkingBudget,
            systemLength: record.systemLength,
            latencyMs: record.latencyMs,
            status: record.status,
            errorMessage: record.errorMessage,
          };
          try {
            await stream.writeSSE({
              event: "request",
              data: JSON.stringify(summary),
            });
          } catch {
            // Stream closed
          }
        });

        // Keep-alive pings every 30 seconds
        const pingInterval = setInterval(async () => {
          try {
            await stream.writeSSE({ event: "ping", data: "" });
          } catch {
            // Stream already closed
          }
        }, 30_000);

        // Clean up on abort
        stream.onAbort(() => {
          unsubscribe();
          clearInterval(pingInterval);
        });
      });
    },

    config(c: Context) {
      const server = {
        host: config.server.host,
        port: config.server.port,
        log_level: config.log_level,
        auth: !!config.server.auth_token,
      };

      const providers = Object.entries(config.providers).map(
        ([name, provider]) => ({
          name,
          type: provider.type,
          base_url: provider.base_url,
          api_key: maskApiKey(provider.api_key),
          models: provider.models.map((m) => m.id),
        }),
      );

      return c.json({ server, providers, routes: config.routes });
    },

    models(c: Context) {
      return c.json(modelDb);
    },

    clearRecords(c: Context) {
      const before = c.req.query("before");
      let count: number;
      if (before) {
        count = store.prune(Number(before) * 1000);
      } else {
        count = store.clearAll();
      }
      metrics.clear();
      return c.json({ deleted: count });
    },
  };
}
