import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { appUsers } from './users';

// Creator/admin lifetime premium codes. Exactly 50 are seeded once; each is
// redeemable a single time by one user.
export const premiumCodes = pgTable('premium_codes', {
  code: text('code').primaryKey(),
  isRedeemed: boolean('is_redeemed').default(false).notNull(),
  redeemedByOpenid: text('redeemed_by_openid').references(() => appUsers.openid),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  note: text('note'),
});

export type PremiumCode = typeof premiumCodes.$inferSelect;

// Durable idempotency store for Stripe webhook events (multi-instance safe).
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  eventId: text('event_id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
});
