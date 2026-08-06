-- Migration 0003: rate_limit_counters table + observation nonce uniqueness
-- rate_limit_counters: distributed rate limiter backed by PostgreSQL
CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
  "key" text PRIMARY KEY NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  "window_start" timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast pruning of expired windows
CREATE INDEX IF NOT EXISTS "rate_limit_window_idx"
  ON "rate_limit_counters" ("window_start");

-- Add unique constraint on capture_nonce to prevent replay / duplicate observations
-- captureNonce is stored inside the evidence JSONB column of scan_findings.
-- We enforce uniqueness with a unique partial index on the extracted field.
CREATE UNIQUE INDEX IF NOT EXISTS "scan_findings_capture_nonce_idx"
  ON "scan_findings" ((evidence->>'captureNonce'))
  WHERE (evidence->>'captureNonce') IS NOT NULL;
