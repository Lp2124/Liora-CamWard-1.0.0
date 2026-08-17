import { pgTable, text, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type { ObservationAnalysisResponse } from '@liora/contracts';
import { scanSessions } from './scans';

export const scanObservationReceipts = pgTable(
  'scan_observation_receipts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull().references(() => scanSessions.id),
    captureNonce: text('capture_nonce').notNull(),
    module: text('module').notNull(),
    response: jsonb('response').$type<ObservationAnalysisResponse>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('scan_observation_session_nonce_uq').on(table.sessionId, table.captureNonce),
  ],
);

export type ScanObservationReceipt = typeof scanObservationReceipts.$inferSelect;
