CREATE TABLE IF NOT EXISTS "scan_observation_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "capture_nonce" text NOT NULL,
  "module" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "scan_observation_receipts_session_id_scan_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."scan_sessions"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "scan_observation_session_nonce_uq"
  ON "scan_observation_receipts" ("session_id", "capture_nonce");
