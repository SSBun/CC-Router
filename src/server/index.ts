import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { AppConfig } from "../config/schema.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createMessagesHandler } from "./routes/messages.js";
import { logger } from "../utils/logger.js";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.use("*", cors());
  app.use("*", authMiddleware(config.server.auth_token));
  app.onError(errorHandler);

  app.post("/v1/messages", createMessagesHandler(config));

  return app;
}

export function startServer(config: AppConfig): Promise<void> {
  const app = createApp(config);
  const { host, port } = config.server;

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
      logger.info(`CC-Router running on http://${host}:${port}`);
      resolve();
    });

    const shutdown = () => {
      logger.info("Shutting down...");
      server.close(() => {
        logger.info("Server stopped");
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
