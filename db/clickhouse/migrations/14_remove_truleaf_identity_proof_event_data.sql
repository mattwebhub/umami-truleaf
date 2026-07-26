-- Complete the reserved-property purge for ClickHouse deployments. Mutation
-- synchronization prevents deployment from racing generic analytics reads.
ALTER TABLE umami.session_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;

ALTER TABLE umami.event_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;
