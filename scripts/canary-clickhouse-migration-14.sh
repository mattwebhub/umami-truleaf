#!/usr/bin/env bash
set -euo pipefail

readonly CLICKHOUSE_IMAGE='clickhouse/clickhouse-server@sha256:d7556a3841027651307b5aa08d72b5c467d0241d3db5b67d9e158ef3975626f5'
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly MIGRATION="${REPOSITORY_ROOT}/db/clickhouse/migrations/14_remove_truleaf_identity_proof_event_data.sql"
readonly CONTAINER="umami-clickhouse-migration-14-$RANDOM-$$"
readonly MIGRATION_LOG="$(mktemp -t umami-clickhouse-migration-14.XXXXXX)"
readonly EXTERNAL_CLIENT="${CLICKHOUSE_CANARY_CLIENT_BIN:-}"
readonly EXTERNAL_HOST="${CLICKHOUSE_CANARY_HOST:-127.0.0.1}"
readonly EXTERNAL_PORT="${CLICKHOUSE_CANARY_PORT:-9000}"
readonly EXPECTED_VERSION="${CLICKHOUSE_CANARY_EXPECTED_VERSION:-26.7.1.1315}"
readonly EXTERNAL_CLIENT_SHA256="${CLICKHOUSE_CANARY_CLIENT_SHA256:-}"

cleanup() {
  if [[ -z "${EXTERNAL_CLIENT}" ]]; then
    docker rm --force "${CONTAINER}" >/dev/null 2>&1 || true
  fi
  rm -f "${MIGRATION_LOG}"
}

trap cleanup EXIT

client() {
  if [[ -n "${EXTERNAL_CLIENT}" ]]; then
    "${EXTERNAL_CLIENT}" client --host "${EXTERNAL_HOST}" --port "${EXTERNAL_PORT}" "$@"
  else
    docker exec -i "${CONTAINER}" clickhouse-client "$@"
  fi
}

if [[ -n "${EXTERNAL_CLIENT}" ]]; then
  if [[ "${CLICKHOUSE_CANARY_ALLOW_DROP_UMAMI:-}" != '1' ]]; then
    echo 'Existing-server mode recreates the umami database; set CLICKHOUSE_CANARY_ALLOW_DROP_UMAMI=1 only for an isolated canary server' >&2
    exit 1
  fi

  if [[ -z "${EXTERNAL_CLIENT_SHA256}" ]]; then
    echo 'Existing-server mode requires CLICKHOUSE_CANARY_CLIENT_SHA256 to pin the tested binary' >&2
    exit 1
  fi

  actual_client_sha256="$(shasum -a 256 "${EXTERNAL_CLIENT}" | awk '{print $1}')"
  if [[ "${actual_client_sha256}" != "${EXTERNAL_CLIENT_SHA256}" ]]; then
    echo "ClickHouse client checksum mismatch: expected ${EXTERNAL_CLIENT_SHA256}, got ${actual_client_sha256}" >&2
    exit 1
  fi
else
  docker run \
    --detach \
    --name "${CONTAINER}" \
    --env CLICKHOUSE_SKIP_USER_SETUP=1 \
    --ulimit nofile=262144:262144 \
    "${CLICKHOUSE_IMAGE}" >/dev/null

  for _ in {1..60}; do
    if client --query 'SELECT 1' >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

actual_version="$(client --query 'SELECT version()')"
if [[ "${actual_version}" != "${EXPECTED_VERSION}" ]]; then
  echo "ClickHouse version mismatch: expected ${EXPECTED_VERSION}, got ${actual_version}" >&2
  exit 1
fi
echo "${actual_version}"

query() {
  client --query "$1"
}

multiquery() {
  client --multiquery
}

assert_query() {
  local description="$1"
  local sql="$2"
  local expected="$3"
  local actual
  actual="$(query "${sql}")"

  if [[ "${actual}" != "${expected}" ]]; then
    echo "${description}: expected '${expected}', got '${actual}'" >&2
    exit 1
  fi
}

create_schema() {
  local session_pivot="$1"

  multiquery <<'SQL'
DROP DATABASE IF EXISTS umami SYNC;
CREATE DATABASE umami;

CREATE TABLE umami.event_data
(
    website_id UUID,
    session_id UUID,
    event_id UUID,
    url_path String,
    event_name String,
    data_key String,
    string_value Nullable(String),
    number_value Nullable(Decimal(22, 4)),
    date_value Nullable(DateTime('UTC')),
    data_type UInt32,
    created_at DateTime('UTC'),
    job_id Nullable(UUID)
)
ENGINE = MergeTree
ORDER BY (website_id, event_id, data_key, created_at);

CREATE TABLE umami.session_data
(
    website_id UUID,
    session_id UUID,
    data_key String,
    string_value Nullable(String),
    number_value Nullable(Decimal(22, 4)),
    date_value Nullable(DateTime('UTC')),
    data_type UInt32,
    distinct_id String,
    created_at DateTime('UTC'),
    job_id Nullable(UUID)
)
ENGINE = ReplacingMergeTree
ORDER BY (website_id, session_id, data_key);

CREATE TABLE umami.event_data_pivot
(
    website_id UUID,
    session_id UUID,
    event_id UUID,
    event_name LowCardinality(String),
    url_path String,
    created_at DateTime('UTC'),
    property_keys AggregateFunction(groupArray, String),
    property_values AggregateFunction(groupArray, String),
    property_types AggregateFunction(groupArray, UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, event_name, created_at, event_id)
SETTINGS allow_dimensions_outside_sorting_key = 1;

CREATE MATERIALIZED VIEW umami.event_data_pivot_mv
TO umami.event_data_pivot
AS SELECT
    website_id,
    session_id,
    event_id,
    event_name,
    url_path,
    created_at,
    groupArrayState(data_key) AS property_keys,
    groupArrayState(multiIf(
        data_type IN (1, 3, 5), ifNull(string_value, ''),
        data_type = 2, toString(ifNull(number_value, 0)),
        data_type = 4, toString(ifNull(date_value, toDateTime(0))),
        ''
    )) AS property_values,
    groupArrayState(data_type) AS property_types
FROM umami.event_data
GROUP BY website_id, session_id, event_id, event_name, url_path, created_at;
SQL

  if [[ "${session_pivot}" == 'present' ]]; then
    multiquery <<'SQL'
CREATE TABLE umami.session_data_pivot
(
    website_id UUID,
    session_id UUID,
    distinct_id String,
    created_year_month UInt32,
    created_at AggregateFunction(max, DateTime('UTC')),
    property_keys AggregateFunction(groupArray, String),
    property_values AggregateFunction(groupArray, String),
    property_types AggregateFunction(groupArray, UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY created_year_month
ORDER BY (website_id, session_id, distinct_id)
SETTINGS allow_dimensions_outside_sorting_key = 1;

CREATE MATERIALIZED VIEW umami.session_data_pivot_mv
TO umami.session_data_pivot
AS SELECT
    website_id,
    session_id,
    ifNull(distinct_id, '') AS distinct_id,
    toYYYYMM(max(session_data.created_at)) AS created_year_month,
    maxState(session_data.created_at) AS created_at,
    groupArrayState(data_key) AS property_keys,
    groupArrayState(multiIf(
        data_type IN (1, 3, 5), ifNull(string_value, ''),
        data_type = 2, toString(ifNull(number_value, 0)),
        data_type = 4, toString(ifNull(date_value, toDateTime(0))),
        ''
    )) AS property_values,
    groupArrayState(data_type) AS property_types
FROM umami.session_data
GROUP BY website_id, session_id, distinct_id;
SQL
  fi
}

seed_data() {
  multiquery <<'SQL'
INSERT INTO umami.event_data VALUES
(
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '/canary',
    'canary-event',
    'safeEventKey',
    'safe-event-value',
    NULL,
    NULL,
    1,
    '2026-01-01 00:00:00',
    NULL
),
(
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '/canary',
    'canary-event',
    'truleafIdentityProof',
    'must-be-purged',
    NULL,
    NULL,
    1,
    '2026-01-01 00:00:00',
    NULL
);

INSERT INTO umami.event_data VALUES
(
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '44444444-4444-4444-4444-444444444444',
    '/proof-only',
    'proof-only-event',
    'truleafIdentityProof',
    'must-be-purged',
    NULL,
    NULL,
    1,
    '2026-01-01 00:00:00',
    NULL
);

INSERT INTO umami.session_data VALUES
(
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'safeSessionKey',
    'safe-session-value',
    NULL,
    NULL,
    1,
    'account-1',
    '2026-01-01 00:00:00',
    NULL
),
(
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'truleafIdentityProof',
    'must-be-purged',
    NULL,
    NULL,
    1,
    'account-1',
    '2026-01-01 00:00:00',
    NULL
);
SQL
}

assert_sanitized() {
  assert_query \
    'session proof base residue' \
    "SELECT count() FROM umami.session_data FINAL WHERE data_key = 'truleafIdentityProof'" \
    '0'
  assert_query \
    'event proof base residue' \
    "SELECT count() FROM umami.event_data WHERE data_key = 'truleafIdentityProof'" \
    '0'
  assert_query \
    'session safe value count' \
    "SELECT count() FROM umami.session_data FINAL WHERE data_key = 'safeSessionKey' AND string_value = 'safe-session-value'" \
    '1'
  assert_query \
    'event safe aggregate count' \
    "SELECT countIf(item.1 = 'safeEventKey' AND item.2 = 'safe-event-value') FROM (SELECT arrayJoin(arrayZip(groupArrayMerge(property_keys), groupArrayMerge(property_values))) AS item FROM umami.event_data_pivot)" \
    '1'
  assert_query \
    'live event safe aggregate count' \
    "SELECT countIf(item.1 = 'liveSafeEventKey' AND item.2 = 'live-safe-event-value') FROM (SELECT arrayJoin(arrayZip(groupArrayMerge(property_keys), groupArrayMerge(property_values))) AS item FROM umami.event_data_pivot)" \
    '1'
  assert_query \
    'event proof aggregate residue' \
    "SELECT countIf(item.1 = 'truleafIdentityProof' OR item.2 = 'must-be-purged') FROM (SELECT arrayJoin(arrayZip(groupArrayMerge(property_keys), groupArrayMerge(property_values))) AS item FROM umami.event_data_pivot)" \
    '0'
  assert_query \
    'retired session pivot objects' \
    "SELECT count() FROM system.tables WHERE database = 'umami' AND name IN ('session_data_pivot', 'session_data_pivot_mv')" \
    '0'
  assert_query \
    'temporary migration helpers' \
    "SELECT count() FROM system.tables WHERE database = 'umami' AND name LIKE 'truleaf_proof_%'" \
    '0'
}

run_variant() {
  local session_pivot="$1"
  local migration_pid
  local mutation_seen='false'

  echo "Running migration 14 canary with session_data_pivot ${session_pivot}"
  create_schema "${session_pivot}"
  seed_data

  # The executable preflight must reject a collector that still emits proofs.
  query "INSERT INTO umami.session_data VALUES (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'truleafIdentityProof',
    'recent-proof-must-block-migration',
    NULL,
    NULL,
    1,
    'account-1',
    now(),
    NULL
  )"

  if client --multiquery <"${MIGRATION}" >"${MIGRATION_LOG}" 2>&1; then
    echo 'Migration unexpectedly accepted active proof ingestion' >&2
    exit 1
  fi

  if ! grep -q 'requires truleafIdentityProof ingestion to be stopped' "${MIGRATION_LOG}"; then
    cat "${MIGRATION_LOG}" >&2
    echo 'Migration failed without the expected ingestion preflight error' >&2
    exit 1
  fi

  query "ALTER TABLE umami.session_data
    DELETE WHERE data_key = 'truleafIdentityProof'
      AND created_at > now() - INTERVAL 5 MINUTE
    SETTINGS mutations_sync = 2"

  query 'SYSTEM STOP MERGES umami.event_data_pivot'
  client --multiquery <"${MIGRATION}" >"${MIGRATION_LOG}" 2>&1 &
  migration_pid=$!

  for _ in {1..100}; do
    if [[ "$(query "SELECT count() FROM system.mutations WHERE database = 'umami' AND table = 'event_data_pivot' AND is_done = 0")" != '0' ]]; then
      mutation_seen='true'
      break
    fi
    sleep 0.1
  done

  if [[ "${mutation_seen}" != 'true' ]]; then
    query 'SYSTEM START MERGES umami.event_data_pivot'
    wait "${migration_pid}" || true
    cat "${MIGRATION_LOG}" >&2
    echo 'Did not observe the blocked event_data_pivot mutation' >&2
    exit 1
  fi

  query "INSERT INTO umami.event_data VALUES (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '/canary',
    'canary-event',
    'liveSafeEventKey',
    'live-safe-event-value',
    NULL,
    NULL,
    1,
    '2026-01-01 00:00:00',
    NULL
  )"

  query 'SYSTEM START MERGES umami.event_data_pivot'

  if ! wait "${migration_pid}"; then
    cat "${MIGRATION_LOG}" >&2
    exit 1
  fi

  assert_sanitized

  # A successful migration is retry-safe and must not duplicate safe states.
  multiquery <"${MIGRATION}"
  assert_sanitized
}

run_variant 'absent'
run_variant 'present'

echo 'ClickHouse migration 14 canary passed'
