-- The account ban reference is an opaque Truleaf operation ID. Keeping it in a
-- dedicated encrypted table lets the originating Umami session undo an active
-- ban after the short-lived identity proof expires without retaining that proof.
CREATE TABLE "truleaf_session_account_ban_reference" (
    "reference_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "reference_ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "encryption_key_version" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "truleaf_session_account_ban_reference_pkey" PRIMARY KEY ("reference_id")
);

CREATE UNIQUE INDEX "truleaf_session_account_ban_reference_website_id_session_id_key"
    ON "truleaf_session_account_ban_reference"("website_id", "session_id");
CREATE INDEX "truleaf_session_account_ban_reference_expires_at_idx"
    ON "truleaf_session_account_ban_reference"("expires_at");

-- Older dark-rollout builds stripped the proof only from identify/session data.
-- A custom event could therefore copy the credential into generic event_data.
-- Purge both generic stores; browser assertions are never migrated into the
-- trusted, encrypted moderation tables.
DELETE FROM "session_data"
WHERE "data_key" = 'truleafIdentityProof';

DELETE FROM "event_data"
WHERE "data_key" = 'truleafIdentityProof';
