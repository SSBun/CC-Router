import type { ErrorHandler } from "hono";
import { logger } from "../../utils/logger.js";

export const errorHandler: ErrorHandler = (err, c) => {
  logger.error(
    {
      err,
      path: c.req.path,
      method: c.req.method,
    },
    "Unhandled error",
  );

  return c.json(
    {
      type: "error",
      error: {
        type: "api_error",
        message: "Internal server error",
      },
    },
    500,
  );
};
