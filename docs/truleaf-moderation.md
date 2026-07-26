# Truleaf moderation integration

This fork adds an optional Truleaf moderation panel to an Umami session profile.
Umami remains an operator interface and observation point; Truleaf remains the
source of truth for bans, audit history, expiry, and enforcement.

All features are disabled unless explicitly enabled and allowlisted.

## Configuration

```dotenv
TRULEAF_MODERATION_ENABLED=false
TRULEAF_NETWORK_CAPTURE_ENABLED=false
TRULEAF_WEBSITE_IDS=00000000-0000-0000-0000-000000000000
# Explicit Umami user UUIDs allowed to operate moderation. Website update
# permission is still required; an empty allowlist denies every operator.
TRULEAF_MODERATION_OPERATOR_IDS=00000000-0000-0000-0000-000000000000
TRULEAF_NETWORK_RETENTION_DAYS=30

# First entry is active; retained entries can decrypt data during key rotation.
# Generate each value with: openssl rand -base64 32
TRULEAF_NETWORK_ENCRYPTION_KEYS=v2:<base64-32-byte-key>,v1:<previous-key>
TRULEAF_NETWORK_HMAC_KEY=<base64-32-byte-key>

TRULEAF_MODERATION_API_URL=https://api.truleaf.org
TRULEAF_MODERATION_KEY_ID=umami-production-v1
TRULEAF_MODERATION_HMAC_SECRET=<base64-32-byte-key>
TRULEAF_RETENTION_SECRET=<independent-random-32+-character-secret>

# Required when network capture is enabled in production. The ingress must
# overwrite this header and prevent direct access to /api/send.
CLIENT_IP_HEADER=x-real-ip
```

Encryption and blind-index keys must be independently generated. Do not reuse
`APP_SECRET`, database credentials, or the service-signing key.

## Trust boundaries

- The analytics payload's optional `ip` field is never used for moderation.
- Production capture is disabled when `CLIENT_IP_HEADER` is absent.
- Ingress must remove/overwrite the trusted header. Merely setting the variable
  without enforcing that proxy policy still permits spoofing.
- `distinctId` is only a display candidate because a browser can forge it.
  Account actions require a `truleafIdentityProof` minted by the authenticated
  Truleaf backend; Truleaf verifies the proof again before acting.
- `truleafIdentityProof` is a reserved collector property. The fork strips it
  before generic `session_data` and `event_data` persistence (including custom
  events) and stores an encrypted copy in `truleaf_session_identity` only for
  enabled, allowlisted websites. It is never returned by generic properties
  APIs, exports, or aggregate reports.
- Successful account bans create a separate encrypted opaque ban reference
  bound to the originating website, session, and account. This reference is
  server-only and permits that source to undo the active ban after the
  short-lived identity proof expires; it cannot authorize a new ban.
- The browser selects opaque network-record IDs. The server resolves and
  decrypts them; raw addresses never enter browser requests or responses.
- Moderation action responses expose enforcement state only; backend operation,
  target, account, and ban identifiers are stripped before the browser boundary.
- Session moderation loads at most the 50 most recently observed, unexpired
  networks. Operators can select at most 10 total targets per action.
- Share tokens cannot use moderation APIs. The operator's Umami user UUID must
  be explicitly listed in `TRULEAF_MODERATION_OPERATOR_IDS` and the operator
  must also have update access to the website. An administrator is not exempt
  from the explicit operator allowlist.

## Storage and retention

`truleaf_session_network`, `truleaf_session_identity`, and
`truleaf_session_account_ban_reference` are additive and deliberately have no
foreign keys or Prisma relations to Umami sessions. ClickHouse deployments can
have sessions without PostgreSQL session rows, so a foreign key would make valid
capture fail. Identity proofs use the earlier of their signed JWT expiry and a
30-day encrypted-storage cap; network observations use the configured retention
period. Account-ban references contain neither the proof nor the account ID:
they remain only while an indefinite ban is
actionable, or until the ban's explicit expiry, successful unban, website
reset/deletion, or owner deletion. Expired rows, including orphaned mappings,
are removed independently. The production image exposes a dedicated,
authenticated app-runtime endpoint:

```http
POST /api/cron/truleaf-network-retention
Authorization: Bearer <TRULEAF_RETENTION_SECRET>
```

Schedule that endpoint at least daily. `pnpm cleanup-truleaf-network` is also
available from a source checkout for local operations, but is not the production
container mechanism. Network, identity-proof, and account-ban-reference
ciphertext use AES-256-GCM with purpose-separated associated data. Account
references additionally bind the account ID, so moving ciphertext to another
website, session, or account fails authentication. The authentication tag is
appended to the ciphertext. HMAC-SHA256 blind indexes allow network
deduplication without deterministic encryption. The historical
`TRULEAF_NETWORK_ENCRYPTION_KEYS` keyring encrypts all fork-only sensitive
tables; proofs and account references never use the network blind-index key.

## Key rotation

1. Prepend a new version and key to `TRULEAF_NETWORK_ENCRYPTION_KEYS`.
2. Restart all replicas.
3. Keep old keys until every network, identity, and account-reference row using
   them expires, is removed, or is re-encrypted.
4. Rotate `TRULEAF_NETWORK_HMAC_KEY` separately only with a migration that
   recomputes blind indexes; changing it without migration breaks deduplication.

## Service request signing

Requests use `x-truleaf-key-id`, `x-truleaf-timestamp`,
`x-truleaf-nonce`, `x-truleaf-signature`, and `idempotency-key`.
The base64url HMAC-SHA256 signature covers:

```text
v1
METHOD
/absolute/path
unix_timestamp_seconds
nonce
sha256_hex(raw_json_body)
```

The service key is a base64-encoded 32-byte value. HTTPS is mandatory in
production. Truleaf must enforce timestamp skew, nonce replay protection,
proof verification, idempotency, and target-specific authorization.

## Deployment order and rollback

Feature-branch publication produces:

```text
ghcr.io/mattwebhub/umami-truleaf:sha-<full-git-sha>
ghcr.io/mattwebhub/umami-truleaf:feat-truleaf-moderation
```

Both tags are convenience discovery pointers and are not release identities:
registry tags can be repointed by a later publication. Release Git tags
matching `v*.*.*` must have an active GitHub ruleset that rejects updates and
deletions. Resolve the published image to the verified workflow output digest
and pin the Kubernetes manifest to `@sha256:…`; never deploy any tag directly.
The digest-bound image is signed and published with SBOM and provenance
attestations, which the image workflow verifies before it succeeds.

1. Deploy Truleaf proof issuance, moderation API, and enforcement with its
   Umami credential configured.
2. Back up Umami PostgreSQL and run migrations 21–23. Migrations 22 and 23
   delete legacy `truleafIdentityProof` rows from generic session and event data
   rather than trusting and copying browser-provided assertions. ClickHouse
   deployments must also apply migrations 13 and 14 and wait for their
   synchronous delete mutations.
3. Deploy this image with both feature flags disabled.
4. Enable capture for one allowlisted staging website and verify retention.
5. Enable moderation and run anonymous-IP and verified-account E2E tests.
6. Roll out production website IDs.

To roll back, disable both flags, revoke the service credential, and deploy the
pinned upstream image. The additive tables are ignored by upstream and can
remain until the retention job or an explicitly reviewed cleanup removes them.
