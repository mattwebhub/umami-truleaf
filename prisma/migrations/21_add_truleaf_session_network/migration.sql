-- Truleaf moderation network observations are isolated from Umami's core schema.
-- Raw addresses are never persisted; ciphertext contains the GCM authentication tag.
CREATE TABLE "truleaf_session_network" (
    "network_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "ip_hmac" CHAR(64) NOT NULL,
    "ip_ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "encryption_key_version" VARCHAR(32) NOT NULL,
    "address_family" SMALLINT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "truleaf_session_network_pkey" PRIMARY KEY ("network_id")
);

CREATE UNIQUE INDEX "truleaf_session_network_website_id_session_id_ip_hmac_key"
    ON "truleaf_session_network"("website_id", "session_id", "ip_hmac");
CREATE INDEX "truleaf_session_network_website_id_session_id_idx"
    ON "truleaf_session_network"("website_id", "session_id");
CREATE INDEX "truleaf_session_network_expires_at_idx"
    ON "truleaf_session_network"("expires_at");
