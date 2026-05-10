import pino from "pino";

const level = (process.env.LOG_LEVEL as pino.Level) ?? "info";

export const logger = pino({
  level,
  ...(process.stdout.isTTY
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
