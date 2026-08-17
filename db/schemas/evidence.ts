import { pgTable, text, timestamp, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { scanSessions } from './scans';

export const scanEvidenceFiles = pgTable(
  'scan_evidence_files',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull().references(() => scanSessions.id),
    captureNonce: text('capture_nonce').notNull(),
    phase: text('phase').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mimeType: text('mime_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('scan_evidence_session_nonce_uq').on(table.sessionId, table.captureNonce),
    uniqueIndex('scan_evidence_storage_key_uq').on(table.storageKey),
  ],
);

export type ScanEvidenceFile = typeof scanEvidenceFiles.$inferSelect;
export type NewScanEvidenceFile = typeof scanEvidenceFiles.$inferInsert;
