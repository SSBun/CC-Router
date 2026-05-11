import { describe, it, expect } from "vitest";
import { AppConfigSchema } from "../../src/config/schema.js";

describe("AppConfigSchema", () => {
  const validConfig = {
    server: {
      host: "127.0.0.1",
      port: 8787,
      auth_token: "my-secret-token",
    },
    providers: {
      anthropic: {
        type: "anthropic-compatible",
        api_key: "sk-ant-test",
        base_url: "https://api.anthropic.com",
      },
    },
    routes: [
      { match: "*", provider: "anthropic" },
    ],
    log_level: "info",
  };

  it("parses a valid config", () => {
    const result = AppConfigSchema.parse(validConfig);

    expect(result.server.host).toBe("127.0.0.1");
    expect(result.server.port).toBe(8787);
    expect(result.server.auth_token).toBe("my-secret-token");
    expect(result.providers.anthropic.type).toBe("anthropic-compatible");
    expect(result.routes).toHaveLength(1);
    expect(result.log_level).toBe("info");
  });

  it("applies defaults for optional server fields", () => {
    const result = AppConfigSchema.parse({
      server: {},  // server is required but inner fields have defaults
      providers: {
        anthropic: {
          type: "anthropic-compatible",
          api_key: "sk-test",
          base_url: "https://api.anthropic.com",
        },
      },
      routes: [{ match: "*", provider: "anthropic" }],
    });

    expect(result.server.host).toBe("127.0.0.1");
    expect(result.server.port).toBe(8787);
    expect(result.server.auth_token).toBe("");
    expect(result.log_level).toBe("info");
  });

  it("applies default for log_level", () => {
    const result = AppConfigSchema.parse({
      server: { host: "0.0.0.0", port: 3000, auth_token: "tok" },
      providers: {
        anthropic: {
          type: "anthropic-compatible",
          api_key: "sk-test",
          base_url: "https://api.anthropic.com",
        },
      },
      routes: [{ match: "*", provider: "anthropic" }],
    });

    expect(result.log_level).toBe("info");
  });

  it("rejects config with missing providers", () => {
    expect(() =>
      AppConfigSchema.parse({
        server: { host: "127.0.0.1", port: 8787, auth_token: "tok" },
        routes: [{ match: "*", provider: "anthropic" }],
        log_level: "info",
      }),
    ).toThrow();
  });

  it("rejects config with missing routes", () => {
    expect(() =>
      AppConfigSchema.parse({
        server: { host: "127.0.0.1", port: 8787, auth_token: "tok" },
        providers: {
          anthropic: {
            type: "anthropic-compatible",
            api_key: "sk-test",
            base_url: "https://api.anthropic.com",
          },
        },
        log_level: "info",
      }),
    ).toThrow();
  });

  it("rejects an invalid provider type", () => {
    expect(() =>
      AppConfigSchema.parse({
        ...validConfig,
        providers: {
          bad: {
            type: "invalid_provider",
            api_key: "sk-test",
            base_url: "https://example.com",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects provider with missing api_key", () => {
    expect(() =>
      AppConfigSchema.parse({
        ...validConfig,
        providers: {
          anthropic: {
            type: "anthropic-compatible",
            base_url: "https://api.anthropic.com",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects provider with missing base_url", () => {
    expect(() =>
      AppConfigSchema.parse({
        ...validConfig,
        providers: {
          anthropic: {
            type: "anthropic-compatible",
            api_key: "sk-test",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects provider with invalid base_url (not a URL)", () => {
    expect(() =>
      AppConfigSchema.parse({
        ...validConfig,
        providers: {
          anthropic: {
            type: "anthropic-compatible",
            api_key: "sk-test",
            base_url: "not-a-url",
          },
        },
      }),
    ).toThrow();
  });

  it("accepts all valid provider types", () => {
    for (const type of ["anthropic-compatible", "openai-compatible"] as const) {
      const result = AppConfigSchema.parse({
        ...validConfig,
        providers: {
          p: {
            type,
            api_key: "sk-test",
            base_url: "https://api.example.com",
          },
        },
      });
      expect(result.providers.p.type).toBe(type);
    }
  });

  it("accepts optional headers on provider", () => {
    const result = AppConfigSchema.parse({
      ...validConfig,
      providers: {
        anthropic: {
          type: "anthropic-compatible",
          api_key: "sk-test",
          base_url: "https://api.anthropic.com",
          headers: { "X-Custom": "value" },
        },
      },
    });

    expect(result.providers.anthropic.headers).toEqual({ "X-Custom": "value" });
  });

  it("accepts optional model override on route", () => {
    const result = AppConfigSchema.parse({
      ...validConfig,
      routes: [{ match: "custom-*", provider: "anthropic", model: "gpt-4o" }],
    });

    expect(result.routes[0].model).toBe("gpt-4o");
  });

  it("accepts all valid log_level values", () => {
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
      const result = AppConfigSchema.parse({
        ...validConfig,
        log_level: level,
      });
      expect(result.log_level).toBe(level);
    }
  });

  it("rejects invalid log_level", () => {
    expect(() =>
      AppConfigSchema.parse({
        ...validConfig,
        log_level: "verbose",
      }),
    ).toThrow();
  });
});
