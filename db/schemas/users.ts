import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

// Local projection of the HappySeeds-authenticated user.
export const appUsers = pgTable('app_users', {
  openid: text('openid').primaryKey(),
  email: text('email'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  locale: text('locale').default('es').notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  isPremium: boolean('is_premium').default(false).notNull(),
  premiumLifetime: boolean('premium_lifetime').default(false).notNull(),
  premiumSince: timestamp('premium_since', { withTimezone: true }),
  premiumExpiresAt: timestamp('premium_expires_at', { withTimezone: true }),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;
