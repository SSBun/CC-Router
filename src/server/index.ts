import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { AppConfig } from "../config/schema.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { MetricsCollector } from "./middleware/metrics.js";
import { MetricsStore } from "./middleware/metrics-store.js";
import { createDashboardHandler, createSessionHandler } from "./routes/dashboard.js";
import { createApiRoutes } from "./routes/api.js";
import { createMessagesHandler } from "./routes/messages.js";
import { createModelsHandler } from "./routes/models.js";
import { logger } from "../utils/logger.js";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  const isTrace = logger.level === "trace";
  const store = new MetricsStore();
  const metrics = new MetricsCollector(isTrace, store);
  metrics.loadFromStore();
  const api = createApiRoutes(config, metrics, isTrace, store);

  app.use("*", cors());
  app.onError(errorHandler);

  // Dashboard HTML — no auth (browser navigates without headers)
  app.get("/dashboard", createDashboardHandler());
  app.get("/dashboard/session", createSessionHandler());

  // Auth-protected routes
  app.use("*", authMiddleware(config.server.auth_token));
  app.use("*", requestLogger);

  app.post("/v1/messages", createMessagesHandler(config, metrics, isTrace));
  app.get("/v1/models", createModelsHandler(config));

  // Dashboard API
  app.get("/api/stats", api.stats);
  app.get("/api/requests", api.requests);
  app.get("/api/requests/history", api.history);
  app.get("/api/requests/:id", api.requestById);
  app.get("/api/events", api.events);
  app.get("/api/config", api.config);
  app.get("/api/models", api.models);
  app.delete("/api/requests", api.clearRecords);

  return app;
}

export function startServer(config: AppConfig): Promise<void> {
  const app = createApp(config);
  const { host, port } = config.server;

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
      logger.info(`CC-Router running on http://${host}:${port}`);
      logger.info(`Dashboard: http://${host}:${port}/dashboard`);
      resolve();
    });

    const shutdown = () => {
      logger.info("Shutting down...");
      store.close();
      server.close(() => {
        logger.info("Server stopped");
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
