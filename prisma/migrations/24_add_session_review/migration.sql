-- Session reviews are operator-authored workflow state. They are not analytics
-- events and cannot be created by the public collection endpoint.
CREATE TABLE "session_review" (
    "review_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "severity" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "severity_rank" INTEGER NOT NULL DEFAULT 1,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "session_review_pkey" PRIMARY KEY ("review_id")
);

CREATE UNIQUE INDEX "session_review_website_id_session_id_key"
    ON "session_review"("website_id", "session_id");
CREATE INDEX "session_review_website_id_status_severity_rank_updated_at_idx"
    ON "session_review"("website_id", "status", "severity_rank", "updated_at");
