CREATE TABLE IF NOT EXISTS "scan_evidence_files" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "capture_nonce" text NOT NULL,
  "phase" text NOT NULL,
  "storage_key" text NOT NULL,
  "sha256" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "mime_type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "scan_evidence_files_session_id_scan_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."scan_sessions"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "scan_evidence_session_nonce_uq"
  ON "scan_evidence_files" ("session_id", "capture_nonce");

CREATE UNIQUE INDEX IF NOT EXISTS "scan_evidence_storage_key_uq"
  ON "scan_evidence_files" ("storage_key");

CREATE INDEX IF NOT EXISTS "scan_evidence_session_created_idx"
  ON "scan_evidence_files" ("session_id", "created_at");
