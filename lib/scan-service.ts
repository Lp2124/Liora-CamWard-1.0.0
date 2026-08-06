import 'server-only';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { scanSessions, scanFindings, usageCounters, type AppUser } from '@/db/schemas';
import { eq, desc, sql } from 'drizzle-orm';
import { isPremiumActive } from './user-service';
import { UnauthorizedError, ValidationError } from './errors';
import { computeRiskLevel } from './scan/risk';

const FREE_MONTHLY_SCAN_LIMIT = 3;

function isSamePeriod(periodStart: Date): boolean {
  const now = new Date();
  return periodStart.getUTCFullYear() === now.getUTCFullYear() && periodStart.getUTCMonth() === now.getUTCMonth();
}

/** Throws if the free-tier user already used up this month's scan quota. */
export async function assertCanStartScan(user: AppUser): Promise<void> {
  if (isPremiumActive(user)) return;

  const [counter] = await db.select().from(usageCounters).where(eq(usageCounters.userOpenid, user.openid)).limit(1);
  if (!counter || !isSamePeriod(new Date(counter.periodStart))) return;

  if (counter.scansThisMonth >= FREE_MONTHLY_SCAN_LIMIT) {
    throw new ValidationError('SCAN_LIMIT_REACHED');
  }
}

/**
 * Atomic upsert: increments scans_this_month or resets to 1 when the period
 * has rolled over. Uses a single SQL statement to prevent race conditions when
 * two concurrent scan requests come in for the same user.
 */
async function incrementUsage(openid: string): Promise<void> {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await db.execute(sql`
    INSERT INTO usage_counters (user_openid, scans_this_month, period_start)
    VALUES (${openid}, 1, ${periodStart.toISOString()}::timestamptz)
    ON CONFLICT (user_openid) DO UPDATE
      SET scans_this_month = CASE
            WHEN usage_counters.period_start < ${periodStart.toISOString()}::timestamptz
            THEN 1
            ELSE usage_counters.scans_this_month + 1
          END,
          period_start = CASE
            WHEN usage_counters.period_start < ${periodStart.toISOString()}::timestamptz
            THEN ${periodStart.toISOString()}::timestamptz
            ELSE usage_counters.period_start
          END
  `);
}

export async function createScanSession(user: AppUser, label: string | null): Promise<{ id: string }> {
  await assertCanStartScan(user);
  const id = randomUUID();
  await db.insert(scanSessions).values({ id, userOpenid: user.openid, label, modulesRun: [] });
  await incrementUsage(user.openid);
  return { id };
}

/**
 * Finalizes a scan session.
 *
 * Risk level is recomputed SERVER-SIDE from the findings already persisted
 * in the DB via /api/inspect/observations/*. The client cannot supply
 * risk level, findings, severity, or any other server-computed field.
 */
export async function finishScanSession(
  user: AppUser,
  sessionId: string,
  modulesRun: string[],
): Promise<void> {
  const [session] = await db.select().from(scanSessions).where(eq(scanSessions.id, sessionId)).limit(1);
  if (!session || session.userOpenid !== user.openid) throw new UnauthorizedError('Sesión no encontrada o no autorizada.');

  // Load findings already persisted via /api/inspect/observations/*
  const persistedFindings = await db
    .select()
    .from(scanFindings)
    .where(eq(scanFindings.sessionId, sessionId));

  // Recompute risk deterministically from server-persisted findings
  const riskLevel = computeRiskLevel(
    persistedFindings.map((f) => ({
      module: f.module as import('./scan/types').ScanModule,
      severity: f.severity as import('./scan/types').Finding['severity'],
      title: f.title,
      detail: f.detail,
      evidence: (f.evidence as Record<string, unknown>) ?? {},
    })),
  );

  await db
    .update(scanSessions)
    .set({ finishedAt: new Date(), status: 'completed', riskLevel, modulesRun })
    .where(eq(scanSessions.id, sessionId));
}

export async function listScanSessions(user: AppUser) {
  return db.select().from(scanSessions).where(eq(scanSessions.userOpenid, user.openid)).orderBy(desc(scanSessions.startedAt));
}

export async function getScanSessionWithFindings(user: AppUser, sessionId: string) {
  const [session] = await db.select().from(scanSessions).where(eq(scanSessions.id, sessionId)).limit(1);
  if (!session || session.userOpenid !== user.openid) return null;
  const findings = await db.select().from(scanFindings).where(eq(scanFindings.sessionId, sessionId)).orderBy(desc(scanFindings.createdAt));
  return { session, findings };
}
