import type { AppConfig } from "../config/schema.js";
import type { ModelDef } from "../providers/types.js";
import modelDb from "../data/model-db.json" with { type: "json" };

export type ModelDbEntry = {
  id: string;
  display_name: string;
  max_input_tokens: number;
  max_tokens: number;
  description: string;
};

export type Source = "provider config" | "built-in db" | "tier fallback";

export interface ResolvedModel {
  id: string;
  display_name: string;
  max_input_tokens: number;
  max_tokens: number;
  source: Source;
}

const MODEL_DB = (modelDb as { models: Record<string, ModelDbEntry> }).models;

const FALLBACK_MAX_INPUT = 200_000;
const FALLBACK_MAX_TOKENS = 128_000;

const TIER_WINDOWS: Record<string, number> = {
  opus: 1_000_000,
  sonnet: 1_000_000,
  haiku: 200_000,
};

const TIER_MAX_TOKENS: Record<string, number> = {
  opus: 128_000,
  sonnet: 128_000,
  haiku: 16_000,
};

function findModelDef(providerName: string, modelId: string, config: AppConfig): ModelDef | null {
  const provider = config.providers[providerName];
  if (!provider?.models) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export function lookupDb(modelId: string): ModelDbEntry | null {
  return MODEL_DB[modelId.toLowerCase()] ?? null;
}

function inferFromTier(match: string): { max_input_tokens: number; max_tokens: number } {
  const lower = match.toLowerCase();
  for (const tier of Object.keys(TIER_WINDOWS)) {
    if (lower.includes(tier)) {
      return { max_input_tokens: TIER_WINDOWS[tier], max_tokens: TIER_MAX_TOKENS[tier] };
    }
  }
  return { max_input_tokens: FALLBACK_MAX_INPUT, max_tokens: FALLBACK_MAX_TOKENS };
}

export function resolveModel(
  modelId: string,
  providerName: string,
  match: string,
  config: AppConfig,
): ResolvedModel {
  const def = findModelDef(providerName, modelId, config);
  const db = lookupDb(modelId);

  const tier = inferFromTier(match);
  const maxInputTokens = def?.max_input_tokens ?? db?.max_input_tokens ?? tier.max_input_tokens;
  const maxTokens = def?.max_tokens ?? db?.max_tokens ?? tier.max_tokens;

  const source: Source = def?.max_input_tokens != null || def?.max_tokens != null
    ? "provider config"
    : db ? "built-in db" : "tier fallback";

  return {
    id: modelId,
    display_name: db?.display_name ?? modelId,
    max_input_tokens: maxInputTokens,
    max_tokens: maxTokens,
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

export function formatContextShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}m`;
  return `${(n / 1000).toFixed(0)}k`;
}

const CONTEXT_SUFFIX_RE = /\[\d+[km]\]$/i;

export function stripContextSuffix(model: string): string {
  return model.replace(CONTEXT_SUFFIX_RE, "");
}

export function resolveMaxInput(modelId: string, config: AppConfig): number | null {
  for (const provider of Object.values(config.providers)) {
    const def = provider.models?.find((m) => m.id === modelId);
    if (def?.max_input_tokens) return def.max_input_tokens;
  }
  const db = lookupDb(modelId);
  return db?.max_input_tokens ?? null;
}

export function modelIdWithSuffix(modelId: string, config: AppConfig): string {
  const maxInput = resolveMaxInput(modelId, config);
  return maxInput ? `${modelId}[${formatContextShort(maxInput)}]` : modelId;
}
