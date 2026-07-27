-- Durable, trusted inbox for backend-owned facts. This table remains in the
-- metadata PostgreSQL database even when analytics events use ClickHouse.
CREATE TABLE "server_event_fact" (
    "server_event_fact_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "key_id" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "event_name" VARCHAR(50) NOT NULL,
    "distinct_id" VARCHAR(50) NOT NULL,
    "url_path" VARCHAR(500) NOT NULL,
    "data" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "projected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_event_fact_pkey" PRIMARY KEY ("server_event_fact_id")
);

CREATE UNIQUE INDEX "server_event_fact_key_id_idempotency_key_key"
    ON "server_event_fact"("key_id", "idempotency_key");
CREATE INDEX "server_event_fact_website_id_event_name_occurred_at_idx"
    ON "server_event_fact"("website_id", "event_name", "occurred_at");
CREATE INDEX "server_event_fact_website_id_distinct_id_occurred_at_idx"
    ON "server_event_fact"("website_id", "distinct_id", "occurred_at");
