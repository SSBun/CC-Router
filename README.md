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

The interactive wizard walks you through:

- Choosing providers (Anthropic, OpenAI, DeepSeek, Ollama, or custom)
- Entering API keys and base URLs
- Configuring model routing (e.g., opus to Anthropic, sonnet to OpenAI)
- Setting server host and port

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
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-20250514"
export ANTHROPIC_DEFAULT_SONNET_MODEL="gpt-4o"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="deepseek-chat"
```

Or print them anytime:

```bash
cc-router env
```

### 4. Use Claude Code normally

```bash
claude
```

Claude Code now routes through CC-Router. Opus requests go to Anthropic, Sonnet requests go to OpenAI, Haiku requests go to DeepSeek — all transparent.

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
    type: "anthropic"
    api_key: "${ANTHROPIC_API_KEY}"
    base_url: "https://api.anthropic.com"

  openai:
    type: "openai"
    api_key: "${OPENAI_API_KEY}"
    base_url: "https://api.openai.com/v1"

  deepseek:
    type: "openai-compatible"
    api_key: "${DEEPSEEK_API_KEY}"
    base_url: "https://api.deepseek.com/v1"

  ollama:
    type: "openai-compatible"
    api_key: "ollama"
    base_url: "http://localhost:11434/v1"

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
| `anthropic` | Anthropic API (native) | Anthropic Messages |
| `anthropic-compatible` | Third-party Anthropic-compatible API | Anthropic Messages |
| `openai` | OpenAI API | Converted to/from OpenAI Chat Completions |
| `openai-compatible` | Third-party OpenAI-compatible API | Converted to/from OpenAI Chat Completions |

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
    headers:
      X-Custom-Auth: "Bearer ${GATEWAY_TOKEN}"
```

## CLI Reference

```
cc-router start [-p <port>] [-d] [--verbose]   Start the server
cc-router stop                                   Stop the daemon
cc-router status                                 Show server status
cc-router list                                   List providers and routes
cc-router env                                    Print export statements
cc-router setup                                  Interactive setup wizard
cc-router config show                            Print current config
cc-router config path                            Print config file path
cc-router config edit                            Open config in $EDITOR
cc-router chat [-m <model>] [--no-stream]        Test chat with a provider
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

## Logging

Set log level in config:

```yaml
log_level: "debug"   # trace | debug | info | warn | error | fatal
```

Or use `--verbose` when starting:

```bash
cc-router start --verbose
```

## License

MIT
