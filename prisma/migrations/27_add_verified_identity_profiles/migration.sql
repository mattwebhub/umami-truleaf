ALTER TABLE "truleaf_session_identity"
ADD COLUMN "profile_retry_at" TIMESTAMPTZ(6),
ADD COLUMN "profile_attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "profile_last_attempt_at" TIMESTAMPTZ(6);

CREATE INDEX "truleaf_session_identity_profile_retry_at_idx"
ON "truleaf_session_identity"("profile_retry_at");

CREATE TABLE "verified_identity_profile" (
    "identity_profile_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "distinct_id" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "avatar_url" VARCHAR(2183),
    "role" VARCHAR(50) NOT NULL,
    "plan" VARCHAR(50) NOT NULL,
    "profile_version" VARCHAR(64) NOT NULL,
    "verified_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_identity_profile_pkey" PRIMARY KEY ("identity_profile_id")
);

CREATE UNIQUE INDEX "verified_identity_profile_website_id_distinct_id_key"
ON "verified_identity_profile"("website_id", "distinct_id");

CREATE INDEX "verified_identity_profile_website_id_updated_at_idx"
ON "verified_identity_profile"("website_id", "updated_at");

CREATE INDEX "verified_identity_profile_verified_until_idx"
ON "verified_identity_profile"("verified_until");

CREATE TABLE "verified_session_identity" (
    "session_identity_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "distinct_id" VARCHAR(50) NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_session_identity_pkey" PRIMARY KEY ("session_identity_id")
);

CREATE UNIQUE INDEX "verified_session_identity_website_id_session_id_key"
ON "verified_session_identity"("website_id", "session_id");

CREATE INDEX "verified_session_identity_website_id_distinct_id_idx"
ON "verified_session_identity"("website_id", "distinct_id");

ALTER TABLE "verified_session_identity"
ADD CONSTRAINT "verified_session_identity_website_id_distinct_id_fkey"
FOREIGN KEY ("website_id", "distinct_id")
REFERENCES "verified_identity_profile"("website_id", "distinct_id")
ON DELETE CASCADE
ON UPDATE CASCADE;
