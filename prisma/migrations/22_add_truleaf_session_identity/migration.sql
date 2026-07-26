-- Account-identity proofs are security-sensitive moderation credentials and must
-- remain separate from Umami's generic session properties and analytics queries.
CREATE TABLE "truleaf_session_identity" (
    "identity_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "proof_ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "encryption_key_version" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "truleaf_session_identity_pkey" PRIMARY KEY ("identity_id")
);

CREATE UNIQUE INDEX "truleaf_session_identity_website_id_session_id_key"
    ON "truleaf_session_identity"("website_id", "session_id");
CREATE INDEX "truleaf_session_identity_expires_at_idx"
    ON "truleaf_session_identity"("expires_at");

-- Dark-rollout builds briefly stored this reserved property in generic
-- session_data. Remove those legacy rows rather than copying an unverified
-- browser assertion into the sensitive store.
DELETE FROM "session_data"
WHERE "data_key" = 'truleafIdentityProof';
