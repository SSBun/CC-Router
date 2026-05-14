import type { Context } from "hono";
import type { AppConfig } from "../../config/schema.js";
import { modelsFromRoutes } from "../../model-info/resolver.js";

export function createModelsHandler(config: AppConfig) {
  const models = modelsFromRoutes(config);

  return (c: Context) => {
    return c.json({
      data: models.map((m) => ({
        id: m.id,
        type: "model",
        display_name: m.display_name,
        created_at: "2024-01-01T00:00:00Z",
        context_window: m.context_window,
      })),
      has_more: false,
      first_id: models[0]?.id ?? null,
      last_id: models[models.length - 1]?.id ?? null,
    });
  };
}
