import 'server-only';
import { randomUUID } from 'crypto';
import { db } from '@/db';
import { scanSessions, scanFindings, usageCounters, type AppUser } from '@/db/schemas';
import { eq, desc, sql } from 'drizzle-orm';
import { isPremiumActive } from './user-service';
import { UnauthorizedError, ValidationError } from './errors';
import { computeRiskLevel } from './scan/risk';

const FREE_MONTHLY_SCAN_LIMIT = 3;

/**
 * Atomic conditional quota check-and-increment.
 *
 * Uses a single SQL statement that:
 * 1. Inserts a new row with count=1 if none exists.
 * 2. Resets to count=1 if the period has rolled over.
 * 3. Increments ONLY IF count < limit (conditional increment).
 * 4. Returns the resulting count.
 *
 * This ensures no concurrent request can exceed the limit,
 * even under 100+ simultaneous requests for the same user.
 */
async function atomicCheckAndIncrementQuota(openid: string, limit: number): Promise<boolean> {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodTs = periodStart.toISOString();

  const result = await db.execute(sql`
    INSERT INTO usage_counters (user_openid, scans_this_month, period_start)
    VALUES (${openid}, 1, ${periodTs}::timestamptz)
    ON CONFLICT (user_openid) DO UPDATE
      SET scans_this_month = CASE
            -- Period rolled over: reset to 1 unconditionally
            WHEN usage_counters.period_start < ${periodTs}::timestamptz THEN 1
            -- Within period and under limit: increment
            WHEN usage_counters.scans_this_month < ${limit} THEN usage_counters.scans_this_month + 1
            -- At or over limit: do not increment (keep current value)
            ELSE usage_counters.scans_this_month
          END,
          period_start = CASE
            WHEN usage_counters.period_start < ${periodTs}::timestamptz
            THEN ${periodTs}::timestamptz
            ELSE usage_counters.period_start
          END
    RETURNING scans_this_month,
              (scans_this_month <= ${limit}) AS granted
  `);

  type Row = { scans_this_month: number; granted: boolean };
  const rows = (result as unknown as { rows: Row[] }).rows;
  // granted=true means the increment succeeded (was below limit)
  return rows[0]?.granted === true;
}

/** Throws if the free-tier user already used up this month's scan quota. */
export async function assertCanStartScan(user: AppUser): Promise<void> {
  if (isPremiumActive(user)) return;
  const [counter] = await db.select().from(usageCounters).where(eq(usageCounters.userOpenid, user.openid)).limit(1);
  if (!counter) return;
  const now = new Date();
  const sameMonth = new Date(counter.periodStart).getUTCFullYear() === now.getUTCFullYear()
    && new Date(counter.periodStart).getUTCMonth() === now.getUTCMonth();
  if (!sameMonth) return;
  if (counter.scansThisMonth >= FREE_MONTHLY_SCAN_LIMIT) {
    throw new ValidationError('SCAN_LIMIT_REACHED');
  }
}

export async function createScanSession(user: AppUser, label: string | null): Promise<{ id: string }> {
  if (!isPremiumActive(user)) {
    const granted = await atomicCheckAndIncrementQuota(user.openid, FREE_MONTHLY_SCAN_LIMIT);
    if (!granted) throw new ValidationError('SCAN_LIMIT_REACHED');
  }
  const id = randomUUID();
  await db.insert(scanSessions).values({ id, userOpenid: user.openid, label, modulesRun: [] });
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
