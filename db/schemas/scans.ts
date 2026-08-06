import { pgTable, text, timestamp, jsonb, integer, doublePrecision } from 'drizzle-orm/pg-core';
import { appUsers } from './users';

// One scan session = one real inspection run by a user in a physical location.
export const scanSessions = pgTable('scan_sessions', {
  id: text('id').primaryKey(),
  userOpenid: text('user_openid').notNull().references(() => appUsers.openid),
  label: text('label'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // Which detection modules actually ran and produced device-reported data.
  modulesRun: jsonb('modules_run').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('in_progress'), // in_progress | completed | aborted
  riskLevel: text('risk_level'), // clear | low | medium | high — derived only from real findings
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
});

export type ScanSession = typeof scanSessions.$inferSelect;
export type NewScanSession = typeof scanSessions.$inferInsert;

// One finding = one real, device-reported observation (no random generation).
export const scanFindings = pgTable('scan_findings', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => scanSessions.id),
  module: text('module').notNull(), // network | bluetooth | optical | magnetic
  severity: text('severity').notNull(), // info | suspicious | high
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  // Raw structured evidence captured from the device APIs (RSSI, MAC prefix,
  // port, vendor, magnetometer delta, snapshot dataURL, etc.)
  evidence: jsonb('evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type ScanFinding = typeof scanFindings.$inferSelect;
export type NewScanFinding = typeof scanFindings.$inferInsert;

// Usage counter to enforce free-tier scan limits.
export const usageCounters = pgTable('usage_counters', {
  userOpenid: text('user_openid').primaryKey().references(() => appUsers.openid),
  scansThisMonth: integer('scans_this_month').notNull().default(0),
  periodStart: timestamp('period_start', { withTimezone: true }).defaultNow().notNull(),
});

export type UsageCounter = typeof usageCounters.$inferSelect;
