import 'server-only';
import { db } from '@/db';
import { appUsers, type AppUser } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import type { HappySeedsUser } from './happyseeds-platform-auth';

/**
 * Idempotent upsert run on every successful HappySeeds login.
 * All emails listed in ADMIN_EMAILS (comma-separated) are auto-promoted to
 * admin + lifetime premium on first sign-in. ADMIN_EMAIL (singular) is also
 * supported for backwards compatibility.
 */
export async function upsertUserOnLogin(user: HappySeedsUser): Promise<void> {
  // Support both ADMIN_EMAILS (comma-separated) and legacy ADMIN_EMAIL
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? '';
  const adminEmails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isCreator = adminEmails.length > 0 && !!user.email && adminEmails.includes(user.email.trim().toLowerCase());

  const [existing] = await db.select().from(appUsers).where(eq(appUsers.openid, user.openid)).limit(1);

  if (!existing) {
    await db.insert(appUsers).values({
      openid: user.openid,
      email: user.email ?? null,
      displayName: user.display_name ?? null,
      avatarUrl: user.avatar_url ?? null,
      isAdmin: isCreator,
      isPremium: isCreator,
      premiumLifetime: isCreator,
      premiumSince: isCreator ? new Date() : null,
    });
    return;
  }

  await db
    .update(appUsers)
    .set({
      email: user.email ?? existing.email,
      displayName: user.display_name ?? existing.displayName,
      avatarUrl: user.avatar_url ?? existing.avatarUrl,
      lastLoginAt: new Date(),
      ...(isCreator && !existing.premiumLifetime
        ? { isAdmin: true, isPremium: true, premiumLifetime: true, premiumSince: existing.premiumSince ?? new Date() }
        : {}),
    })
    .where(eq(appUsers.openid, user.openid));
}

export async function getUserByOpenid(openid: string): Promise<AppUser | undefined> {
  const [row] = await db.select().from(appUsers).where(eq(appUsers.openid, openid)).limit(1);
  return row;
}

export function isPremiumActive(user: AppUser): boolean {
  if (user.premiumLifetime) return true;
  if (!user.isPremium) return false;
  if (!user.premiumExpiresAt) return true;
  return new Date(user.premiumExpiresAt).getTime() > Date.now();
}
