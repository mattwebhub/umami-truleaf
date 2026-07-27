# Agent analytics API

The self-hosted agent API provides bounded, read-only analytics access for
local tools and MCP servers without reusing a person's dashboard session.
It is product-neutral: project-specific event names and metric definitions
remain in `PRODUCT_COCKPIT_CONFIG`, outside the fork.

## Security model

- Service keys are bound to one website and an explicit set of scopes.
- A 256-bit token is shown once. Only its SHA-256 digest and a display prefix
  are stored.
- Keys can expire and can be revoked immediately.
- Access is rechecked against the creating user's current website permission.
  Deleting the user or removing website access invalidates their keys.
- `moderation:read` additionally requires current website update permission.
- Redis is used for rate limiting when configured. Otherwise an atomic
  PostgreSQL counter enforces the same cluster-wide limit.
- A separate pseudonymous ingress limit runs before credential lookup so
  malformed and unknown tokens cannot bypass admission control.
- Network attribution is disabled by default. Set `AGENT_API_CLIENT_IP_HEADER`
  only to a single-value address header (for example `x-real-ip`) that a
  trusted ingress overwrites after stripping the caller-supplied value. If
  the header is absent or invalid, requests share a conservative
  `unattributed` limiter bucket; arbitrary `X-Forwarded-For` is never trusted.
- Audits record lifecycle/query type, status, duration, and request ID. They
  never record tokens, filters, results, IP addresses, or identity proofs.
- V1 has no write operations, raw SQL, raw IP output, unrestricted session
  search, or moderation mutations.

Available scopes:

- `analytics:summary:read`
- `analytics:product:read`
- `analytics:content:read`
- `analytics:quality:read`
- `moderation:read`

## Key lifecycle

An authenticated website owner or team member with update permission uses:

- `GET /api/websites/:websiteId/service-api-keys`
- `POST /api/websites/:websiteId/service-api-keys`
- `DELETE /api/websites/:websiteId/service-api-keys/:keyId`

Example creation body:

```json
{
  "name": "Local MCP",
  "scopes": [
    "analytics:summary:read",
    "analytics:product:read",
    "analytics:content:read",
    "analytics:quality:read"
  ],
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

The creation response is the only response that includes `token`. Store it in
the MCP process environment; do not commit it to project configuration.
Deleting a key revokes it rather than removing its audit history.

## Machine API

Send the service key as `Authorization: Bearer umami_sk_...`.

- `GET /api/agent/v1/websites/:websiteId/catalog`
- `POST /api/agent/v1/websites/:websiteId/query`

The catalog is filtered to the key's scopes and documents supported periods
and breakdown dimensions.

Example query:

```json
{
  "kind": "snapshot",
  "period": {
    "preset": "week",
    "timezone": "Europe/Lisbon"
  }
}
```

Request bodies are capped at 16 KiB. Supported query kinds are `snapshot`, `timeseries`, `breakdown`, `product`,
`content`, `quality`, and `moderation`. Breakdown dimensions and result sizes
are allowlisted and bounded. Moderation is an as-of-now queue and therefore
does not accept or return a period/comparison range.

Preset periods never include an in-progress period:

- `day`: previous complete local calendar day
- `week`: previous complete Monday–Sunday local calendar week
- `month`: previous complete local calendar month

Custom periods use ISO-8601 `startAt` and `endAt` and are limited to 366 days.
Every response includes schema version, resolved UTC boundaries, timezone,
comparison period, provenance notes, data, and warnings.

The default budget is 120 cost units per minute per key; heavier product
queries consume more units. The pre-authentication ingress limit defaults to
300 requests per minute per pseudonymous network source. Override these with
`AGENT_API_RATE_LIMIT_PER_MINUTE` and
`AGENT_API_INGRESS_RATE_LIMIT_PER_MINUTE`.

## Retention

Call `POST /api/cron/agent-api-retention` daily with a dedicated
`AGENT_API_RETENTION_SECRET` of at least 32 characters. Query audits are kept
for seven days by default, configurable with
`AGENT_API_AUDIT_RETENTION_DAYS` and capped at 90 days. Stale ingress limiter
rows are removed after one day. Query-audit write failures are reported
without masking a successful analytics read; key creation and revocation
remain transactional with their lifecycle audits. Lifecycle audits are not
removed by this retention job.
