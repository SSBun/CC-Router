import { describe, it, expect } from "vitest";
import { resolveRoute } from "../../src/router/index.js";
import { stripContextSuffix } from "../../src/model-info/resolver.js";
import type { AppConfig } from "../../src/config/schema.js";
import type { ProviderConfig } from "../../src/providers/types.js";

const anthropicProvider: ProviderConfig = {
  type: "anthropic",
  api_key: "sk-ant-test",
  base_url: "https://api.anthropic.com",
};

const openaiProvider: ProviderConfig = {
  type: "openai",
  api_key: "sk-openai-test",
  base_url: "https://api.openai.com/v1",
};

const openrouterProvider: ProviderConfig = {
  type: "openai-compatible",
  api_key: "sk-or-test",
  base_url: "https://openrouter.ai/api/v1",
};

function makeConfig(
  routes: Array<{ match: string; provider: string; model?: string }>,
  providers: Record<string, ProviderConfig>,
): AppConfig {
  return {
    server: { host: "127.0.0.1", port: 8787, auth_token: "test-token" },
    providers,
    routes,
    log_level: "info",
  } satisfies AppConfig;
}

describe("resolveRoute", () => {
  it("matches an exact model name", () => {
    const config = makeConfig(
      [{ match: "claude-sonnet-4-20250514", provider: "anthropic" }],
      { anthropic: anthropicProvider },
    );

    const result = resolveRoute("claude-sonnet-4-20250514", config);

    expect(result.provider).toBe(anthropicProvider);
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
  });

  it("matches a glob pattern like claude-opus-4-*", () => {
    const config = makeConfig(
      [{ match: "claude-opus-4-*", provider: "openrouter" }],
      { openrouter: openrouterProvider },
    );

    const result = resolveRoute("claude-opus-4-20250514", config);

    expect(result.provider).toBe(openrouterProvider);
    expect(result.resolvedModel).toBe("claude-opus-4-20250514");
  });

  it("uses first-match-wins when multiple patterns match", () => {
    const config = makeConfig(
      [
        { match: "claude-opus-*", provider: "openrouter" },
        { match: "claude-*", provider: "anthropic" },
      ],
      {
        openrouter: openrouterProvider,
        anthropic: anthropicProvider,
      },
    );

    const result = resolveRoute("claude-opus-4-20250514", config);

    // Should match the first route (openrouter), not the second (anthropic)
    expect(result.provider).toBe(openrouterProvider);
  });

  it("falls back to * wildcard pattern", () => {
    const config = makeConfig(
      [
        { match: "claude-*", provider: "anthropic" },
        { match: "*", provider: "openrouter" },
      ],
      {
        anthropic: anthropicProvider,
        openrouter: openrouterProvider,
      },
    );

    const result = resolveRoute("gpt-4o", config);

    expect(result.provider).toBe(openrouterProvider);
    expect(result.resolvedModel).toBe("gpt-4o");
  });

  it("overrides model name when route specifies model", () => {
    const config = makeConfig(
      [{ match: "my-custom-model", provider: "openai", model: "gpt-4o" }],
      { openai: openaiProvider },
    );

    const result = resolveRoute("my-custom-model", config);

    expect(result.provider).toBe(openaiProvider);
    expect(result.resolvedModel).toBe("gpt-4o");
  });

  it("throws when no route matches the model", () => {
    const config = makeConfig(
      [{ match: "claude-*", provider: "anthropic" }],
      { anthropic: anthropicProvider },
    );

    expect(() => resolveRoute("gpt-4o", config)).toThrow(
      'No route found for model "gpt-4o"',
    );
  });

  it("throws when matched provider is not defined in config", () => {
    const config = makeConfig(
      [{ match: "*", provider: "nonexistent" }],
      {},
    );

    expect(() => resolveRoute("any-model", config)).toThrow(
      'provider "nonexistent" is not defined',
    );
  });

  it("matches exact model name in provider's models list before glob patterns", () => {
    const config = makeConfig(
      [
        { match: "*haiku*", provider: "openrouter", model: "openrouter-haiku" },
        { match: "*", provider: "openai", model: "gpt-4o" },
      ],
      {
        openai: openaiProvider,
        openrouter: openrouterProvider,
        deepseek: {
          type: "openai-compatible",
          api_key: "sk-ds-test",
          base_url: "https://api.deepseek.com/v1",
          models: [{ id: "deepseek-v4-flash", max_input_tokens: 1_000_000 }],
        },
      },
    );

    const result = resolveRoute("deepseek-v4-flash", config);

    // Should match deepseek provider exactly, not the catch-all glob
    expect(result.provider.base_url).toBe("https://api.deepseek.com/v1");
    expect(result.resolvedModel).toBe("deepseek-v4-flash");
  });

  it("falls back to glob when no provider has the exact model", () => {
    const config = makeConfig(
      [
        { match: "*opus*", provider: "openrouter" },
        { match: "*", provider: "openai" },
      ],
      {
        openai: openaiProvider,
        openrouter: openrouterProvider,
        deepseek: {
          type: "openai-compatible",
          api_key: "sk-ds-test",
          base_url: "https://api.deepseek.com/v1",
          models: [{ id: "deepseek-v4-flash", max_input_tokens: 1_000_000 }],
        },
      },
    );

    // "some-random-model" not in any provider's models list
    const result = resolveRoute("some-random-model", config);

    // Should fall through to glob matching → catch-all
    expect(result.provider).toBe(openaiProvider);
    expect(result.resolvedModel).toBe("some-random-model");
  });

  it("exact model match ignores glob route model override", () => {
    const config = makeConfig(
      [
        { match: "*haiku*", provider: "openrouter", model: "overridden-haiku" },
        { match: "*", provider: "openai", model: "overridden-default" },
      ],
      {
        openai: openaiProvider,
        openrouter: openrouterProvider,
        deepseek: {
          type: "openai-compatible",
          api_key: "sk-ds-test",
          base_url: "https://api.deepseek.com/v1",
          models: [{ id: "deepseek-v4-flash", max_input_tokens: 1_000_000 }],
        },
      },
    );

    const result = resolveRoute("deepseek-v4-flash", config);

    // Exact match wins — no model override, uses original name
    expect(result.provider.base_url).toBe("https://api.deepseek.com/v1");
    expect(result.resolvedModel).toBe("deepseek-v4-flash");
  });

  it("resolves with correct provider config for anthropic type", () => {
    const config = makeConfig(
      [{ match: "*", provider: "anthropic" }],
      { anthropic: anthropicProvider },
    );

    const result = resolveRoute("claude-sonnet-4-20250514", config);

    expect(result.provider.type).toBe("anthropic");
    expect(result.provider.api_key).toBe("sk-ant-test");
    expect(result.provider.base_url).toBe("https://api.anthropic.com");
  });
});

describe("stripContextSuffix", () => {

  it("strips [256k] suffix", () => {
    expect(stripContextSuffix("deepseek-v4-flash[256k]")).toBe("deepseek-v4-flash");
  });

  it("strips [1m] suffix", () => {
    expect(stripContextSuffix("claude-opus-4[1m]")).toBe("claude-opus-4");
  });

  it("strips [1000K] case-insensitive suffix", () => {
    expect(stripContextSuffix("glm-5.1[1000K]")).toBe("glm-5.1");
  });

  it("returns unchanged if no suffix", () => {
    expect(stripContextSuffix("deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("does not strip brackets without km suffix", () => {
    expect(stripContextSuffix("model[test]")).toBe("model[test]");
  });
});

describe("resolveRoute with context suffix", () => {
  it("strips suffix then matches exact model in provider", () => {
    const config = makeConfig(
      [
        { match: "*haiku*", provider: "openrouter", model: "openrouter-haiku" },
        { match: "*", provider: "openai", model: "gpt-4o" },
      ],
      {
        openai: openaiProvider,
        openrouter: openrouterProvider,
        deepseek: {
          type: "openai-compatible",
          api_key: "sk-ds-test",
          base_url: "https://api.deepseek.com/v1",
          models: [{ id: "deepseek-v4-flash", max_input_tokens: 1_000_000 }],
        },
      },
    );

    // Claude Code sends model name with [256k] suffix
    const result = resolveRoute("deepseek-v4-flash[256k]", config);

    expect(result.provider.base_url).toBe("https://api.deepseek.com/v1");
    expect(result.resolvedModel).toBe("deepseek-v4-flash");
  });

  it("strips suffix then falls back to glob matching", () => {
    const config = makeConfig(
      [
        { match: "*sonnet*", provider: "openrouter" },
        { match: "*", provider: "openai" },
      ],
      {
        openai: openaiProvider,
        openrouter: openrouterProvider,
      },
    );

    const result = resolveRoute("claude-sonnet-4-20250514[200k]", config);

    expect(result.provider).toBe(openrouterProvider);
    expect(result.resolvedModel).toBe("claude-sonnet-4-20250514");
  });
});
