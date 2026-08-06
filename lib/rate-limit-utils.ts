/**
 * rate-limit-utils.ts — Pure, side-effect-free helpers for rate limiting.
 *
 * Exported from rate-limit.ts and safe to import in tests and edge middleware
 * without triggering server-only DB imports.
 */

export interface RateLimitConfig {
  /** Requests allowed in windowMs */
  max: number;
  /** Window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  key: string;
}

/** Route-specific limits */
export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  'observation': { max: 20,  windowMs: 60_000 },
  'scan':        { max: 10,  windowMs: 60_000 },
  'auth':        { max: 10,  windowMs: 60_000 },
  'admin':       { max: 30,  windowMs: 60_000 },
  'default':     { max: 60,  windowMs: 60_000 },
};

export function classifyRoute(pathname: string): string {
  if (pathname.startsWith('/api/inspect/observations/')) return 'observation';
  if (pathname.startsWith('/api/scans')) return 'scan';
  if (pathname.startsWith('/api/auth')) return 'auth';
  if (pathname.startsWith('/api/admin')) return 'admin';
  return 'default';
}

/**
 * Builds a composite rate-limit key.
 * Combines as many dimensions as are available.
 */
export function buildRateLimitKey(opts: {
  userId?: string;
  sessionId?: string;
  deviceFingerprint?: string;
  ip: string;
  pathname: string;
  operation: string;
}): string {
  const routeGroup = classifyRoute(opts.pathname);
  const parts = [
    routeGroup,
    opts.operation,
    opts.ip,
    opts.userId ?? 'anon',
    opts.sessionId ?? '-',
    opts.deviceFingerprint ?? '-',
  ];
  return parts.join('|');
}

/**
 * Middleware-compatible rate limit check (no DB — for edge middleware).
 * Uses a simple in-memory map as FIRST layer only; the authoritative
 * check happens in the route handler via checkAndIncrementRateLimit.
 */
const edgeMap = new Map<string, { count: number; windowStart: number }>();

export function edgeRateLimitCheck(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const slot = edgeMap.get(key);
  if (!slot || now - slot.windowStart > windowMs) {
    edgeMap.set(key, { count: 1, windowStart: now });
    if (edgeMap.size > 10_000) {
      const cutoff = now - windowMs * 2;
      for (const [k, v] of edgeMap) { if (v.windowStart < cutoff) edgeMap.delete(k); }
    }
    return true;
  }
  slot.count += 1;
  return slot.count <= max;
}
