import type { AppConfig } from "./schema.js";

export const DEFAULT_CONFIG: Partial<AppConfig> = {
  server: {
    host: "127.0.0.1",
    port: 8787,
    auth_token: "",
  },
  log_level: "info",
};
