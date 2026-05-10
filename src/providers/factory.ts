import type { ProviderConfig, ProviderAdapter } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";

export function createAdapter(provider: ProviderConfig): ProviderAdapter {
  switch (provider.type) {
    case "anthropic":
    case "anthropic-compatible":
      return new AnthropicAdapter(provider);
    case "openai":
    case "openai-compatible":
      return new OpenAIAdapter(provider);
    default:
      throw new Error(
        `Unknown provider type: "${(provider as ProviderConfig & { type: string }).type}". Supported types: anthropic, anthropic-compatible, openai, openai-compatible`,
      );
  }
}
