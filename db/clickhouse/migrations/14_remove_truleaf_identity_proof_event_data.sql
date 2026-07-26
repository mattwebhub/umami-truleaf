-- Materialized views do not retract AggregateFunction state when source rows
-- are mutated. Capture only the pivot groups containing the reserved proof so
-- they can be rebuilt from sanitized base data without dropping unrelated
-- analytics properties.
CREATE TABLE IF NOT EXISTS umami.truleaf_proof_event_pivot_keys
(
    website_id UUID,
    session_id UUID,
    event_id UUID,
    event_name String,
    url_path String,
    created_at DateTime('UTC')
)
ENGINE = MergeTree()
ORDER BY (website_id, session_id, event_id, event_name, created_at);

CREATE TABLE IF NOT EXISTS umami.truleaf_proof_session_pivot_keys
(
    website_id UUID,
    session_id UUID,
    distinct_id String
)
ENGINE = MergeTree()
ORDER BY (website_id, session_id, distinct_id);

INSERT INTO umami.truleaf_proof_event_pivot_keys
SELECT
    website_id,
    session_id,
    event_id,
    event_name,
    url_path,
    created_at
FROM umami.event_data_pivot
GROUP BY website_id, session_id, event_id, event_name, url_path, created_at
HAVING has(groupArrayMerge(property_keys), 'truleafIdentityProof');

INSERT INTO umami.truleaf_proof_session_pivot_keys
SELECT
    website_id,
    session_id,
    distinct_id
FROM umami.session_data_pivot
GROUP BY website_id, session_id, distinct_id
HAVING has(groupArrayMerge(property_keys), 'truleafIdentityProof');

-- Purge generic base storage first. Synchronous mutations also rewrite the
-- session_data projection, but do not repair materialized aggregate targets.
ALTER TABLE umami.session_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;

ALTER TABLE umami.event_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;

ALTER TABLE umami.event_data_pivot
    DELETE WHERE (
        website_id,
        session_id,
        event_id,
        event_name,
        url_path,
        created_at
    ) IN (
        SELECT
            website_id,
            session_id,
            event_id,
            event_name,
            url_path,
            created_at
        FROM umami.truleaf_proof_event_pivot_keys
    )
    SETTINGS mutations_sync = 2;

ALTER TABLE umami.session_data_pivot
    DELETE WHERE (website_id, session_id, distinct_id) IN (
        SELECT website_id, session_id, distinct_id
        FROM umami.truleaf_proof_session_pivot_keys
    )
    SETTINGS mutations_sync = 2;

-- Rebuild only affected groups from the now-sanitized base tables. Groups that
-- contained no other property correctly remain absent.
INSERT INTO umami.event_data_pivot
SELECT
    event_data.website_id,
    event_data.session_id,
    event_data.event_id,
    event_data.event_name,
    event_data.url_path,
    event_data.created_at,
    groupArrayState(event_data.data_key),
    groupArrayState(multiIf(
        event_data.data_type IN (1, 3, 5), ifNull(event_data.string_value, ''),
        event_data.data_type = 2, toString(ifNull(event_data.number_value, 0)),
        event_data.data_type = 4, toString(ifNull(event_data.date_value, toDateTime(0))),
        ''
    )),
    groupArrayState(event_data.data_type)
FROM umami.event_data AS event_data
ANY INNER JOIN umami.truleaf_proof_event_pivot_keys AS affected
    ON affected.website_id = event_data.website_id
    AND affected.session_id = event_data.session_id
    AND affected.event_id = event_data.event_id
    AND affected.event_name = event_data.event_name
    AND affected.url_path = event_data.url_path
    AND affected.created_at = event_data.created_at
WHERE event_data.data_key != 'truleafIdentityProof'
GROUP BY
    event_data.website_id,
    event_data.session_id,
    event_data.event_id,
    event_data.event_name,
    event_data.url_path,
    event_data.created_at;

INSERT INTO umami.session_data_pivot
SELECT
    session_data.website_id,
    session_data.session_id,
    ifNull(session_data.distinct_id, '') AS distinct_id,
    toYYYYMM(max(session_data.created_at)) AS created_year_month,
    maxState(session_data.created_at),
    groupArrayState(session_data.data_key),
    groupArrayState(multiIf(
        session_data.data_type IN (1, 3, 5), ifNull(session_data.string_value, ''),
        session_data.data_type = 2, toString(ifNull(session_data.number_value, 0)),
        session_data.data_type = 4, toString(ifNull(session_data.date_value, toDateTime(0))),
        ''
    )),
    groupArrayState(session_data.data_type)
FROM (
    SELECT *
    FROM umami.session_data FINAL
) AS session_data
ANY INNER JOIN umami.truleaf_proof_session_pivot_keys AS affected
    ON affected.website_id = session_data.website_id
    AND affected.session_id = session_data.session_id
    AND affected.distinct_id = ifNull(session_data.distinct_id, '')
WHERE session_data.data_key != 'truleafIdentityProof'
GROUP BY session_data.website_id, session_data.session_id, session_data.distinct_id;

DROP TABLE umami.truleaf_proof_event_pivot_keys;
DROP TABLE umami.truleaf_proof_session_pivot_keys;
