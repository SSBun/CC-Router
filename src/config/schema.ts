import { z } from "zod";

const ProviderType = z.enum(["anthropic-compatible", "openai-compatible"]);

const ModelDefSchema = z.object({
  id: z.string(),
  context_window: z.number().int().positive().optional(),
});

export const ProviderSchema = z.object({
  type: ProviderType,
  api_key: z.string(),
  base_url: z.string().url(),
  headers: z.record(z.string()).optional(),
  models: z
    .array(z.union([z.string(), ModelDefSchema]))
    .default([])
    .transform((arr) =>
      arr.map((m) => (typeof m === "string" ? { id: m } : m)),
    ),
});

export const RouteSchema = z.object({
  match: z.string(),
  provider: z.string(),
  model: z.string().optional(),
});

export const AppConfigSchema = z.object({
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(8787),
    auth_token: z.string().default(""),
  }),
  providers: z.record(ProviderSchema),
  routes: z.array(RouteSchema),
  log_level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
