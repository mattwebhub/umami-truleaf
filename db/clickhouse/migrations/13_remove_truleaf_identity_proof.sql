-- The reserved moderation proof must never remain available through Umami's
-- generic session-data APIs, exports, or aggregate reports.
ALTER TABLE umami.session_data
    DELETE WHERE data_key = 'truleafIdentityProof'
    SETTINGS mutations_sync = 2;
