# Product cockpit

The product cockpit is an optional, configuration-driven website overview for
product outcomes. It adds no product-specific event names to Umami and remains
disabled when no valid configuration is present.

## Capabilities

- bounded server-side aggregates for count and rate metrics;
- unique-session funnel reach and feature adoption;
- identified active-account, retention, performance, content, and review
  summaries;
- browser-observed and server-authoritative provenance labels;
- idempotent managed segments, cohorts, goals, and reports;
- a manual session-review queue;
- runtime route exclusions for replay and heatmap capture.

Normal website and team permissions apply. The aggregate response does not
include distinct IDs, raw network values, or session-level records.

## Configuration

Set `PRODUCT_COCKPIT_CONFIG` to a JSON object with a `websites` array. Invalid
configuration fails closed and logs one actionable error without logging the
configuration value.

```json
{
  "websites": [
    {
      "websiteId": "11111111-1111-4111-8111-111111111111",
      "title": "Product health",
      "authoritativeEvents": ["server.account-created"],
      "metrics": [
        {
          "id": "accounts",
          "label": "Accounts created",
          "type": "count",
          "events": ["server.account-created"],
          "provenance": "server",
          "measure": "accounts"
        },
        {
          "id": "activation",
          "label": "Activation / signup",
          "type": "rate",
          "numerator": ["onboarding-completed"],
          "denominator": ["signup-completed"],
          "measure": "sessions"
        }
      ],
      "funnels": [
        {
          "id": "onboarding",
          "label": "Onboarding reach",
          "steps": [
            { "label": "Signed up", "events": ["signup-completed"] },
            { "label": "Activated", "events": ["onboarding-completed"] }
          ]
        }
      ],
      "features": [
        {
          "id": "projects",
          "label": "Project adoption",
          "events": ["project-opened"]
        }
      ],
      "content": {
        "idProperty": "contentId",
        "viewEvent": "content-view",
        "engagedEvent": "content-engaged",
        "limit": 10
      },
      "bootstrap": {
        "segments": [],
        "cohorts": [],
        "reports": []
      }
    }
  ]
}
```

The schema intentionally bounds the number of websites, aliases, metrics,
funnels, features, and managed objects. Rate cards always return the numerator,
denominator, selected measure, current period, and prior equal-length period.
Cockpit funnel cards show unique-session reach; ordered conversion remains the
responsibility of native funnel reports.

Content ranking is bounded inside the database: the current period selects only
the configured top IDs, and the prior-period query is restricted to that same
bounded set. Publicly supplied high-cardinality property values therefore cannot
expand the aggregate response or application-memory work without limit.

Browser metrics honor normal website filters. Server facts honor the selected
date range only because their ledger does not contain browser device, locale,
referrer, or cohort dimensions; the UI labels this scope explicitly.

The bootstrap endpoint updates only objects carrying its managed marker.
Operator-created objects are never overwritten.

## Trusted server events

Server-authoritative facts use a separate signed endpoint and durable Postgres
ledger. Configure `SERVER_EVENT_KEYS` with one or more 32-byte base64 secrets
scoped to explicit website IDs:

```json
{
  "application-backend": {
    "secret": "BASE64_ENCODED_32_BYTE_SECRET",
    "websiteIds": ["11111111-1111-4111-8111-111111111111"]
  }
}
```

Clients send the exact JSON body to `POST /api/server-events` with:

- `x-umami-key-id`;
- `x-umami-timestamp` as Unix seconds;
- `x-umami-idempotency-key`;
- `x-umami-signature`, the base64url HMAC-SHA256 of
  `timestamp.idempotencyKey.rawBody`.

Keys are website-scoped, timestamps have a five-minute acceptance window, and
idempotency keys are unique per key. Trusted event names must use the reserved
`server.` prefix and must also appear in that website's
`authoritativeEvents` list. The public collector rejects the entire prefix even
when cockpit configuration is absent or malformed, so browser traffic cannot
pre-seed present or future trusted facts during a staged rollout.

The ledger is authoritative. Projection into the normal event store is
best-effort so native reports can consume the event; a projection interruption
returns `202` and may be retried with the same idempotency key.

Keep signing keys in a secret manager. Do not place them in
`PRODUCT_COCKPIT_CONFIG`, images, or browser-visible environment variables.

## Replay route exclusions

The recorder accepts `data-exclude-paths` as a JSON array of at most 20 regular
expression strings. Eligibility is enforced inside the recorder runtime:

- entering an excluded SPA route stops replay and discards pending capture;
- heatmap events are not queued or flushed on excluded routes;
- returning to an eligible route starts a fresh replay snapshot.

Use this together with masking and blocking selectors. Route exclusions do not
replace DOM-level protection for sensitive controls.

## Database and rollout

The feature adds the `session_review` and `server_event_fact` tables through
additive Prisma migrations. Review severity has a numeric sort key and the
operator queue is paginated, so older high-severity work cannot be hidden behind
newer low-severity rows.

Recommended deployment order:

1. back up Postgres and prove restoration;
2. apply migrations in a non-production database;
3. deploy the new image with both environment variables absent;
4. add a staging cockpit configuration;
5. verify public reservation, signed ingestion, idempotent retry, bootstrap,
   permissions, and replay route transitions;
6. enable production websites gradually.

An older image ignores the additive tables, but rollback must still be tested
against a restored production-shaped database before release.
