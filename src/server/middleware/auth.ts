import type { Context, Next } from "hono";

export function authMiddleware(authToken: string) {
  return async (c: Context, next: Next) => {
    // Claude Code sends x-api-key, other clients send Authorization: Bearer
    const xApiKey = c.req.header("x-api-key");
    const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const apiKey = xApiKey || bearer;

    if (!apiKey || apiKey !== authToken) {
      return c.json(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: "Invalid API key",
          },
        },
        401,
      );
    }

    await next();
  };
}
