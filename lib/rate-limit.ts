/**
 * rate-limit.ts — Rate limiter distribuido sobre PostgreSQL
 *
 * Usa una tabla rate_limit_counters con operación atómica
 * INSERT … ON CONFLICT DO UPDATE RETURNING para garantizar
 * corrección bajo múltiples instancias, serverless y reinicios.
 *
 * Las utilidades puras (buildRateLimitKey, classifyRoute, edgeRateLimitCheck,
 * RATE_LIMIT_CONFIGS) viven en rate-limit-utils.ts para que los tests puedan
 * importarlas sin disparar la guardia server-only del módulo DB.
 */

import { db } from '@/db';
import { sql } from 'drizzle-orm';
export type { RateLimitConfig, RateLimitResult } from './rate-limit-utils';
export {
  RATE_LIMIT_CONFIGS,
  classifyRoute,
  buildRateLimitKey,
  edgeRateLimitCheck,
} from './rate-limit-utils';

/**
 * Atomic rate-limit check + increment via PostgreSQL.
 * Returns whether the request is allowed and remaining quota.
 *
 * Uses a single statement to prevent TOCTOU races.
 */
export async function checkAndIncrementRateLimit(
  key: string,
  config: import('./rate-limit-utils').RateLimitConfig,
): Promise<import('./rate-limit-utils').RateLimitResult> {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const windowStartTs = new Date(windowStart).toISOString();
  const resetAtMs = now + config.windowMs;

  const result = await db.execute(sql`
    INSERT INTO rate_limit_counters (key, count, window_start)
    VALUES (${key}, 1, NOW())
    ON CONFLICT (key) DO UPDATE
      SET count = CASE
            WHEN rate_limit_counters.window_start < ${windowStartTs}::timestamptz
            THEN 1
            ELSE rate_limit_counters.count + 1
          END,
          window_start = CASE
            WHEN rate_limit_counters.window_start < ${windowStartTs}::timestamptz
            THEN NOW()
            ELSE rate_limit_counters.window_start
          END
    RETURNING count, window_start
  `);

  const rows = (result as unknown as { rows: { count: number; window_start: string }[] }).rows;
  const count = rows[0]?.count ?? 1;

  const allowed = count <= config.max;
  const remaining = Math.max(0, config.max - count);

  return { allowed, remaining, resetAtMs, key };
}
