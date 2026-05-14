import picomatch from "picomatch";
import type { AppConfig } from "../config/schema.js";
import type { ProviderConfig, RouteResolution } from "../providers/types.js";
import { stripContextSuffix } from "../model-info/resolver.js";
import { logger } from "../utils/logger.js";

export interface RouteRule {
  match: string;
  provider: string;
  model?: string;
}

export function resolveRoute(rawModel: string, config: AppConfig): RouteResolution {
  const model = stripContextSuffix(rawModel);
  const routes = config.routes as Array<RouteRule>;
  const providers = config.providers as Record<string, ProviderConfig>;

  // Exact model name match first — find provider that has this model
  for (const [name, provider] of Object.entries(providers)) {
    if (provider.models?.some((m) => m.id === model)) {
      logger.debug(
        { rawModel, model, provider: name },
        "Route resolved (exact model match)",
      );
      return { provider, resolvedModel: model };
    }
  }

  // Then glob pattern matching
  for (const route of routes) {
    if (picomatch(route.match)(model)) {
      const provider = providers[route.provider];
      if (!provider) {
        throw new Error(
          `Route matched pattern "${route.match}" but provider "${route.provider}" is not defined. Available providers: ${Object.keys(providers).join(", ")}`,
        );
      }

      const resolvedModel = route.model ?? model;

      logger.debug(
        { rawModel, model, provider: route.provider, resolvedModel, pattern: route.match },
        "Route resolved (glob match)",
      );

      return { provider, resolvedModel };
    }
  }

  const available = routes.map((r) => `  - match: ${r.match} → provider: ${r.provider}`).join("\n");
  throw new Error(
    `No route found for model "${model}". Available routes:\n${available}`,
  );
}
