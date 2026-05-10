import picomatch from "picomatch";
import type { AppConfig } from "../config/schema.js";
import type { ProviderConfig, RouteResolution } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export interface RouteRule {
  match: string;
  provider: string;
  model?: string;
}

export function resolveRoute(model: string, config: AppConfig): RouteResolution {
  const routes = config.routes as Array<RouteRule>;
  const providers = config.providers as Record<string, ProviderConfig>;

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
        { model, provider: route.provider, resolvedModel, pattern: route.match },
        "Route resolved",
      );

      return { provider, resolvedModel };
    }
  }

  const available = routes.map((r) => `  - match: ${r.match} → provider: ${r.provider}`).join("\n");
  throw new Error(
    `No route found for model "${model}". Available routes:\n${available}`,
  );
}
