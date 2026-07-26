-- New collectors must strip the reserved proof before this migration runs.
-- Requiring a quiet window turns that deployment-order contract into an
-- executable preflight and prevents a legacy collector racing the mutations.
SELECT throwIf(
    count() > 0,
    'Migration 14 requires truleafIdentityProof ingestion to be stopped for at least 5 minutes'
)
FROM (
    SELECT created_at
    FROM umami.session_data
    WHERE data_key = 'truleafIdentityProof'
        AND created_at > now() - INTERVAL 5 MINUTE
    UNION ALL
    SELECT created_at
    FROM umami.event_data
    WHERE data_key = 'truleafIdentityProof'
        AND created_at > now() - INTERVAL 5 MINUTE
);

-- session_data_pivot was intentionally retired upstream. Older installations
-- may still have it, while upgraded installations never created it. Removing
-- both objects with IF EXISTS makes those histories converge and eliminates
-- any aggregate proof residue without resurrecting an unused table.
DROP VIEW IF EXISTS umami.session_data_pivot_mv SYNC;
DROP TABLE IF EXISTS umami.session_data_pivot SYNC;

-- Synchronous base mutations also rewrite session_data projections.
ALTER TABLE umami.session_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;

ALTER TABLE umami.event_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;

-- Source-table mutations do not retract state already emitted by an
-- incremental materialized view. Rewrite each physical aggregate state in
-- place instead of deleting and rebuilding groups. Concurrent collector
-- inserts are safe after the preflight: the deployed collector cannot emit the
-- reserved key, and new safe-only states merge once with the sanitized state.
ALTER TABLE umami.event_data_pivot
    UPDATE
        property_keys = arrayReduce(
            'groupArrayState',
            arrayMap(
                item -> item.1,
                arrayFilter(
                    item -> item.1 != 'truleafIdentityProof',
                    arrayZip(
                        finalizeAggregation(property_keys),
                        finalizeAggregation(property_values),
                        finalizeAggregation(property_types)
                    )
                )
            )
        ),
        property_values = arrayReduce(
            'groupArrayState',
            arrayMap(
                item -> item.2,
                arrayFilter(
                    item -> item.1 != 'truleafIdentityProof',
                    arrayZip(
                        finalizeAggregation(property_keys),
                        finalizeAggregation(property_values),
                        finalizeAggregation(property_types)
                    )
                )
            )
        ),
        property_types = arrayReduce(
            'groupArrayState',
            arrayMap(
                item -> item.3,
                arrayFilter(
                    item -> item.1 != 'truleafIdentityProof',
                    arrayZip(
                        finalizeAggregation(property_keys),
                        finalizeAggregation(property_values),
                        finalizeAggregation(property_types)
                    )
                )
            )
        )
    WHERE has(finalizeAggregation(property_keys), 'truleafIdentityProof')
    SETTINGS mutations_sync = 2;
