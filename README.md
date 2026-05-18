# CC-Router

Multi-provider model router for [Claude Code](https://claude.ai/code). Route different models to different LLM providers — use Anthropic for Opus, OpenAI for Sonnet, DeepSeek for Haiku, or any combination you want.

CC-Router acts as a local proxy that speaks the Anthropic Messages API on the front end and translates requests to the correct provider on the back end. Claude Code talks to CC-Router as if it were the Anthropic API; CC-Router routes each request based on the model name.

## How It Works

```
Claude Code
    │
    │  ANTHROPIC_BASE_URL=http://127.0.0.1:8787
    ▼
┌─────────────┐     route: *opus*     ┌──────────────┐
│  CC-Router   │ ──────────────────►  │  Anthropic    │
│  (proxy)     │                      │  API          │
│              │     route: *sonnet*   ├──────────────┤
│              │ ──────────────────►  │  OpenAI       │
│              │                      │  API          │
│              │     route: *haiku*    ├──────────────┤
│              │ ──────────────────►  │  DeepSeek     │
└─────────────┘                      │  API          │
                                     └──────────────┘
```

1. Claude Code sends a request to `http://127.0.0.1:8787/v1/messages`
2. CC-Router matches the model name against your route rules
3. The request is forwarded to the matched provider (with format conversion if needed)
4. The response is translated back to Anthropic format and returned to Claude Code

## Install

```bash
npm install -g @ssbun/cc-router
```

Or run without installing:

```bash
npx @ssbun/cc-router --help
```

Requires Node.js 20+.

## Quick Start

### 1. Run the setup wizard

```bash
cc-router setup
```

The interactive wizard walks you through adding providers one by one:

- Choose provider type (`anthropic-compatible` or `openai-compatible`)
- Enter provider name, base URL, and API key
- Add models to the provider
- Configure routes (map model patterns to providers)
- Set server host and port

Config is saved to `~/.cc-router/config.yaml`.

### 2. Start the server

```bash
cc-router start
```

Or run as a background daemon:

```bash
cc-router start --daemon
```

The server prints the environment variables you need to set.

### 3. Configure Claude Code

Add the printed exports to your shell (e.g., `~/.zshrc` or `~/.bashrc`):

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_AUTH_TOKEN="<generated-token>"
export ANTHROPIC_DEFAULT_OPUS_MODEL="glm-5.1"
export ANTHROPIC_DEFAULT_SONNET_MODEL="deepseek-v4-pro"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-v4-flash"
```

Or configure Claude Code interactively:

```bash
cc-router claude
```

This opens an interactive wizard that manages all of `~/.claude/settings.json` — cc-router env vars, feature flags, preferences, and more. Includes a token-efficient preset and j/k vim navigation. The legacy `inject` command is deprecated.

Print exports manually anytime:

```bash
cc-router env
```

### 4. Use Claude Code normally

```bash
claude
```

Claude Code now routes through CC-Router. Opus requests go to Anthropic, Sonnet requests go to OpenAI, Haiku requests go to DeepSeek — all transparent.

## Dashboard

CC-Router includes a built-in web dashboard for monitoring requests in real time. Open it at:

```
http://127.0.0.1:8787/dashboard
```

### Features

- **Live request stream** — real-time feed of all proxied requests via SSE
- **Request details** — click any request to inspect full request/response payloads
- **Structured view** — toggle between raw JSON and parsed chat timeline (messages, tool calls, thinking blocks)
- **Markdown preview** — render message content as markdown
- **Usage stats** — request count, token usage, error rate, latency percentiles
- **Provider & route info** — sidebar with provider status, active routes, top models
- **Config & models viewer** — inspect your routing config and built-in model database

### Persistent History

Request records are stored in SQLite at `~/.cc-router/metrics.db`. History survives server restarts. Use the "Clear History" button in the dashboard to wipe stored data.

### Trace Mode

For full request/response payload capture:

```bash
cc-router start --log-level trace
```

Trace mode stores complete request and response bodies, enabling detailed inspection of messages, tools, and thinking blocks in the dashboard.

## Configuration

Config lives at `~/.cc-router/config.yaml`. Edit it directly or use the CLI:

```bash
cc-router config edit    # Open in $EDITOR
cc-router config show    # Print current config
cc-router config path    # Print config file path
```

### Full Example

```yaml
server:
  host: "127.0.0.1"
  port: 8787
  auth_token: ""

providers:
  anthropic:
    type: "anthropic-compatible"
    api_key: "${ANTHROPIC_API_KEY}"
    base_url: "https://api.anthropic.com"
    models:
      - id: "claude-opus-4-20250514"
        max_input_tokens: 1000000
      - id: "claude-sonnet-4-20250514"
        max_input_tokens: 1000000
      - id: "claude-haiku-4-20251001"
        max_input_tokens: 200000

  openai:
    type: "openai-compatible"
    api_key: "${OPENAI_API_KEY}"
    base_url: "https://api.openai.com/v1"
    models:
      - "gpt-4o"
      - "o3-mini"

  deepseek:
    type: "openai-compatible"
    api_key: "${DEEPSEEK_API_KEY}"
    base_url: "https://api.deepseek.com/v1"
    models:
      - id: "deepseek-chat"
        max_input_tokens: 1000000

routes:
  - match: "*opus*"
    provider: "anthropic"
    model: "claude-opus-4-20250514"

  - match: "*sonnet*"
    provider: "openai"
    model: "gpt-4o"

  - match: "*haiku*"
    provider: "deepseek"
    model: "deepseek-chat"

  - match: "*"
    provider: "anthropic"
```

### Environment Variables

Use `${VAR_NAME}` syntax in config values. CC-Router interpolates them at load time:

```yaml
api_key: "${ANTHROPIC_API_KEY}"
```

If the variable is not set, the literal `${VAR_NAME}` is kept and a warning is logged.

### Provider Types

| Type | Description | API Format |
|------|-------------|------------|
| `anthropic-compatible` | Anthropic or Anthropic-compatible API | Anthropic Messages |
| `openai-compatible` | OpenAI or OpenAI-compatible API | Converted to/from OpenAI Chat Completions |

### Provider Models

Each provider has an optional `models` array. Models can be simple strings or objects with `max_input_tokens` and `max_tokens`:

```yaml
providers:
  openai:
    type: "openai-compatible"
    api_key: "${OPENAI_API_KEY}"
    base_url: "https://api.openai.com/v1"
    models:
      - "gpt-4o"                       # simple string
      - id: "o3-mini"                  # with token limits
        max_input_tokens: 200000
        max_tokens: 16000
```

Context window resolution priority: provider config → built-in database → tier inference. The built-in database covers 15+ models (GLM + DeepSeek).

Query the database:

```bash
cc-router models          # list all known models in table format
cc-router models glm-5.1  # show details for a specific model
```

### Route Matching

Routes use [picomatch](https://github.com/micromatch/picomatch) glob patterns:

| Pattern | Matches |
|---------|---------|
| `*opus*` | Any model containing "opus" |
| `*sonnet*` | Any model containing "sonnet" |
| `*haiku*` | Any model containing "haiku" |
| `claude-*` | Models starting with "claude-" |
| `*` | Everything (catch-all) |

Routes are evaluated top to bottom. First match wins. The optional `model` field overrides the model name sent to the provider.

### Custom Headers

Add extra headers per provider (useful for gateways and proxies):

```yaml
providers:
  gateway:
    type: "anthropic-compatible"
    api_key: "${API_KEY}"
    base_url: "https://my-gateway.example.com"
    models:
      - "claude-sonnet-4-20250514"
    headers:
      X-Custom-Auth: "Bearer ${GATEWAY_TOKEN}"
```

## CLI Reference

```
cc-router start [-p <port>] [-d] [--log-level <level>]   Start the server
cc-router stop                                            Stop the daemon
cc-router restart [-p <port>]                             Restart the daemon
cc-router status                                          Show server status
cc-router list                                            List providers and routes
cc-router env                                             Print export statements
cc-router setup                                           Interactive setup wizard
cc-router claude [--dry-run] [--no-backup]                Configure Claude Code settings
cc-router dashboard                                       Open web dashboard in browser
cc-router models [<id>]                                   Query built-in model database
cc-router config show                                     Print current config
cc-router config path                                     Print config file path
cc-router config edit                                     Open config in $EDITOR
cc-router route list                                      List routes
cc-router route add                                       Add a new route
cc-router route edit                                      Edit an existing route
cc-router route remove                                    Remove a route
cc-router route reorder                                   Change route priority
cc-router chat [-m <model>] [--no-stream]                 Test chat with a provider
```

### Log Levels

```bash
cc-router start --log-level trace    # full request/response payloads
cc-router start --log-level debug    # request summaries
cc-router start --log-level info     # default
cc-router start --verbose            # shorthand for --log-level debug
```

### Route Management

Manage routing rules without editing the config file directly:

```bash
# List current routes with priority order
cc-router route list

# Add a new route (interactive)
cc-router route add

# Edit an existing route's match pattern, provider, or model
cc-router route edit

# Remove a route
cc-router route remove

# Reorder routes (priority matters — first match wins)
cc-router route reorder
```

### Chat Command

Test your provider connections directly from the terminal:

```bash
cc-router chat -m claude-sonnet-4-20250514
cc-router chat -m gpt-4o --no-stream
```

Supports streaming by default. Type `/exit` to quit, `/clear` to reset history.

## How Routing Works with Claude Code

Claude Code lets you set per-tier model overrides via environment variables:

| Variable | Controls |
|----------|----------|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Which model Claude Code uses for "Opus" |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Which model Claude Code uses for "Sonnet" |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Which model Claude Code uses for "Haiku" |

CC-Router's `env` command detects your route config and prints the correct exports. Example: if your route maps `*sonnet*` to OpenAI's `gpt-4o`, `cc-router env` prints:

```bash
export ANTHROPIC_DEFAULT_SONNET_MODEL="gpt-4o"
```

Claude Code then sends requests with model `gpt-4o`. CC-Router matches `*sonnet*` (or `*`), routes to OpenAI, and converts the response back.

## Supported Features

- Streaming and non-streaming responses
- Tool use (function calling) with format conversion between Anthropic and OpenAI
- Multi-turn conversations
- Image inputs
- Thinking/extended thinking blocks
- CORS support
- Request authentication via auth token
- Daemon mode with PID management
- Environment variable interpolation in config
- Built-in web dashboard with real-time monitoring
- SQLite-backed request history persistence

## License

MIT
