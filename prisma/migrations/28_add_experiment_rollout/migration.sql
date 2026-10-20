CREATE TABLE "experiment_rollout" (
  "experiment_rollout_id" UUID NOT NULL,
  "website_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "treatment_percent" SMALLINT NOT NULL,
  "revision" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experiment_rollout_pkey" PRIMARY KEY ("experiment_rollout_id"),
  CONSTRAINT "experiment_rollout_percent_check" CHECK ("treatment_percent" BETWEEN 0 AND 100),
  CONSTRAINT "experiment_rollout_key_check" CHECK ("key" ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);

CREATE UNIQUE INDEX "experiment_rollout_website_id_key_key" ON "experiment_rollout"("website_id", "key");
CREATE INDEX "experiment_rollout_website_id_updated_at_idx" ON "experiment_rollout"("website_id", "updated_at");

ALTER TABLE "experiment_rollout"
  ADD CONSTRAINT "experiment_rollout_website_id_fkey"
  FOREIGN KEY ("website_id") REFERENCES "website"("website_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
