import type { Context } from "hono";
import type { AppConfig } from "../../config/schema.js";
import { modelsFromRoutes, formatContextShort } from "../../model-info/resolver.js";

export function createModelsHandler(config: AppConfig) {
  const models = modelsFromRoutes(config);

  return (c: Context) => {
    return c.json({
      data: models.map((m) => ({
        id: `${m.id}[${formatContextShort(m.max_input_tokens)}]`,
        type: "model",
        display_name: m.display_name,
        created_at: "2024-01-01T00:00:00Z",
        max_input_tokens: m.max_input_tokens,
        max_tokens: m.max_tokens,
      })),
      has_more: false,
      first_id: models[0] ? `${models[0].id}[${formatContextShort(models[0].max_input_tokens)}]` : null,
      last_id: models.length > 0 ? `${models[models.length - 1].id}[${formatContextShort(models[models.length - 1].max_input_tokens)}]` : null,
    });
  };
}
