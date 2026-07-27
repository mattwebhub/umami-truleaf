# Umami agent MCP

This package exposes the bounded, read-only Umami agent API as a local stdio
MCP server. One process is configured for one website and gives its tools a
project-specific prefix such as `umami_truleaf_snapshot`.

## Configuration

Required:

- `UMAMI_MCP_BASE_URL` — Umami origin, for example `https://analytics.example.com`
- `UMAMI_MCP_WEBSITE_ID` — exact website UUID
- `UMAMI_MCP_API_KEY` — one-time service key, or use `UMAMI_MCP_API_KEY_FILE`

Optional:

- `UMAMI_MCP_PROJECT` — safe tool-name segment, default `analytics`
- `UMAMI_MCP_DEFAULT_TIMEZONE` — IANA timezone, default `UTC`
- `UMAMI_MCP_TIMEOUT_MS` — request timeout from 1–120 seconds, default 30000

Do not put a service key in a committed MCP configuration. Prefer a
user-readable-only key file outside the repository and pass its absolute path
as `UMAMI_MCP_API_KEY_FILE`. Remote origins must use HTTPS so the bearer key is
never sent over plaintext. HTTP is accepted only for exact loopback hosts
during local development.

Build the server from the Umami workspace:

```sh
pnpm --filter @umami/agent-mcp build
```

Example local project registration:

```json
{
  "mcpServers": {
    "umami-example": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/umami/packages/agent-mcp/dist/index.js"],
      "env": {
        "UMAMI_MCP_BASE_URL": "https://analytics.example.com",
        "UMAMI_MCP_WEBSITE_ID": "00000000-0000-4000-8000-000000000000",
        "UMAMI_MCP_API_KEY_FILE": "/absolute/path/outside/repository/service-key",
        "UMAMI_MCP_PROJECT": "example",
        "UMAMI_MCP_DEFAULT_TIMEZONE": "UTC"
      }
    }
  }
}
```

## Tools

- `<prefix>_catalog`
- `<prefix>_snapshot`
- `<prefix>_timeseries`
- `<prefix>_breakdown`
- `<prefix>_product_health`
- `<prefix>_content_performance`
- `<prefix>_quality`
- `<prefix>_moderation_queue`

The server also exposes `umami://<project>/catalog` as a live JSON resource.
All tools are read-only. Period tools default to the previous complete week in
the configured timezone and may instead receive a complete-day/week/month
preset or an explicit ISO-8601 range.
