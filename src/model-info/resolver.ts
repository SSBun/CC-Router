import type { AppConfig } from "../config/schema.js";
import type { ModelDef } from "../providers/types.js";
import modelDb from "../data/model-db.json" with { type: "json" };

export type ModelDbEntry = {
  id: string;
  display_name: string;
  context_window: number;
  max_output_tokens: number;
  description: string;
};

export type Source = "provider config" | "built-in db" | "tier fallback";

export interface ResolvedModel {
  id: string;
  display_name: string;
  context_window: number;
  source: Source;
}

const MODEL_DB = (modelDb as { models: Record<string, ModelDbEntry> }).models;

const FALLBACK_CONTEXT_WINDOW = 200_000;

const TIER_WINDOWS: Record<string, number> = {
  opus: 1_000_000,
  sonnet: 1_000_000,
  haiku: 200_000,
};

function findModelDef(providerName: string, modelId: string, config: AppConfig): ModelDef | null {
  const provider = config.providers[providerName];
  if (!provider?.models) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function lookupDb(modelId: string): ModelDbEntry | null {
  return MODEL_DB[modelId.toLowerCase()] ?? null;
}

function inferFromTier(match: string): number {
  const lower = match.toLowerCase();
  for (const [tier, window] of Object.entries(TIER_WINDOWS)) {
    if (lower.includes(tier)) return window;
  }
  return FALLBACK_CONTEXT_WINDOW;
}

export function resolveModel(
  modelId: string,
  providerName: string,
  match: string,
  config: AppConfig,
): ResolvedModel {
  const def = findModelDef(providerName, modelId, config);
  const db = lookupDb(modelId);

  const source: Source = def?.context_window != null
    ? "provider config"
    : db ? "built-in db" : "tier fallback";

  return {
    id: modelId,
    display_name: db?.display_name ?? modelId,
    context_window: def?.context_window ?? db?.context_window ?? inferFromTier(match),
    source,
  };
}

export function modelsFromRoutes(config: AppConfig): ResolvedModel[] {
  const seen = new Set<string>();
  const result: ResolvedModel[] = [];

  for (const route of config.routes) {
    const modelId = route.model ?? route.match;
    if (seen.has(modelId)) continue;
    seen.add(modelId);

    result.push(resolveModel(modelId, route.provider, route.match, config));
  }

  return result;
}

export function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  return `${(n / 1000).toFixed(0)}K`;
}
