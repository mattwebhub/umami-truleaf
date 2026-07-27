CREATE TABLE "service_api_key" (
    "service_api_key_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_prefix" VARCHAR(24) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "scopes" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "rate_limit_window_at" TIMESTAMPTZ(6),
    "rate_limit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_api_key_pkey" PRIMARY KEY ("service_api_key_id")
);

CREATE UNIQUE INDEX "service_api_key_key_prefix_key"
ON "service_api_key"("key_prefix");

CREATE INDEX "service_api_key_website_id_created_at_idx"
ON "service_api_key"("website_id", "created_at");

CREATE INDEX "service_api_key_expires_at_idx"
ON "service_api_key"("expires_at");

CREATE TABLE "service_api_key_audit" (
    "service_api_key_audit_id" UUID NOT NULL,
    "service_api_key_id" UUID NOT NULL,
    "website_id" UUID,
    "action" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(32),
    "query_type" VARCHAR(32),
    "status" VARCHAR(20) NOT NULL,
    "duration_ms" INTEGER,
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_api_key_audit_pkey" PRIMARY KEY ("service_api_key_audit_id")
);

CREATE INDEX "service_api_key_audit_service_api_key_id_created_at_idx"
ON "service_api_key_audit"("service_api_key_id", "created_at");

CREATE INDEX "service_api_key_audit_website_id_created_at_idx"
ON "service_api_key_audit"("website_id", "created_at");

CREATE TABLE "agent_api_ingress_window" (
    "fingerprint" CHAR(64) NOT NULL,
    "window_at" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_api_ingress_window_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "agent_api_ingress_window_updated_at_idx"
ON "agent_api_ingress_window"("updated_at");
