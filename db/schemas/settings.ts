import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Key-value store for admin-configurable app settings.
 * Keys are namespaced strings like "stripe.secretKey" or "scan.brightnessThreshold".
 * Values are always stored as text (JSON-encoded when complex).
 */
export const appSettings = pgTable('app_settings', {
  key:       text('key').primaryKey(),
  value:     text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
