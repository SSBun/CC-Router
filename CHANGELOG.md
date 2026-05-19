# Changelog

## [0.7.1] — 2026-05-19

### Fixed
- Dashboard HTML path resolution broken by tsup bundling — used 3x `dirname()` assuming
  file layout `dist/server/routes/dashboard.js`, but tsup bundles into single `dist/index.js`

## [0.7.0] — 2026-05-18

### Added
- `cc-router claude` — interactive wizard to configure `~/.claude/settings.json`
- Token-efficient preset that pre-fills all settings
- Category-based menu: feature flags, preferences, attribution
- j/k vim-style navigation in select/checkbox prompts
- ESC to cancel or go back from any prompt
- `cc-router dashboard` — opens the web dashboard in your browser
- Settings manifest (`claude-settings-manifest.json`) with descriptions, types, presets

### Fixed
- Dashboard HTML path resolved to wrong directory (ENOENT at runtime)
- Dashboard handler now returns 500 with message if HTML missing
- `0.0.0.0`/`::` host remapped to `127.0.0.1` for browser URL
- Proper connect timeout in dashboard port check

### Changed
- `inject` command hidden from help (deprecated in favor of `claude`)

## [0.6.0] — 2026-05-18

### Added
- SQLite persistence for request history via `better-sqlite3` — records survive restarts
- DB stored at `~/.cc-router/metrics.db` with WAL mode
- On startup, recent records load back from SQLite into in-memory buffer
- `GET /api/requests/history` — paginated access to full history beyond in-memory buffer
- `DELETE /api/requests` — clear all stored records from SQLite
- "Clear History" button in dashboard feed header with confirmation popover
- Request detail lookup falls back to SQLite when not in memory

### Changed
- `MetricsCollector` now accepts optional `MetricsStore` for write-through persistence
- Dashboard API routes receive store reference for history/clear endpoints

## [0.5.0] — 2026-05-14

### Added
- Context window suffix (`[200k]`, `[1m]`) in `/v1/models` response model IDs — Claude Code displays it in model picker
- `ANTHROPIC_DEFAULT_*_MODEL` env exports now include context window suffix
- Exact model name matching in router before glob pattern fallback
- `stripContextSuffix()` utility routes suffixed model names correctly

### Changed
- Token field rename to match Anthropic API: `context_window` → `max_input_tokens`, `max_output_tokens` → `max_tokens`
- Backward-compatible schema: old `context_window` field auto-transforms to `max_input_tokens`
- Model routing: exact provider model list match checked before glob patterns (`*opus*`, `*sonnet*`, etc.)
- `cc-router models` table columns: "Context Window" → "Max Input", "Max Output" → "Max Tokens"

## [0.4.0] — 2026-05-15

### Added
- Model list view in macOS client provider form — add/edit/remove models with context window
- `cc-router inject` populates `~/.claude/settings.json` with cc-router env vars
- `cc-router models` shows built-in model database in table format
- Backward-compatible `{id, context_window}` model format in YAML config
- macOS client parses `context_window` from `/v1/models` API responses

### Changed
- Provider models config changed from `string[]` to `[{id, context_window?}]` objects
- macOS client models field redesigned from plain text editor to interactive list
- `/v1/models` endpoint now reads context_window from provider config > built-in DB > tier inference

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
