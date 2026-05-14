# Changelog

## [0.3.0] — 2026-05-15

### Added
- `GET /v1/models` endpoint returning model IDs with `context_window` metadata
- Built-in model database (15 GLM + DeepSeek models) as default context window source
- `cc-router inject` command to write config env vars into `~/.claude/settings.json`
- `cc-router models` command to query the built-in model database
- Provider models config extended to support `{id, context_window}` objects
- Context window resolution chain: provider config → built-in DB → tier inference
- Backward compatible: `string[]` models auto-normalized to `{id}` format
- Shared model resolution logic at `src/model-info/resolver.ts`

## [0.2.0] — 2026-05-13

### Added
- `cc-router route add` / `route remove` / `route list` commands for route management
- Multi-provider model routing with glob pattern matching (`*opus*`, `*sonnet*`, `*haiku*`)
- Anthropic-compatible and OpenAI-compatible provider types
- YAML config with env var interpolation (`${VAR_NAME}`)
- Hono-based HTTP proxy with CORS and auth middleware
- `cc-router setup` interactive configuration wizard
- `cc-router start` / `stop` / `restart` / `status` daemon management
- `cc-router list` to show providers and routes
- `cc-router env` to print shell export commands
- `cc-router chat` for testing model routing from CLI
- `cc-router config` to view configuration
- Stream SSE proxying for streaming responses
- Error mapping from provider status codes to Anthropic error types
- Graceful shutdown on SIGINT/SIGTERM

### Changed
- Provider type schema refined with Zod validation
- Route management moved from manual config editing to CLI commands
