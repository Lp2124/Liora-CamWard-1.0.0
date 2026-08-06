import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── In-memory rate limiter (edge-compatible, resets per isolate) ──────────────
// Each slot: { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX       = 60;     // 60 requests/minute per IP on API routes
const RATE_LIMIT_OBSERVATION_MAX = 20; // tighter for observation submission

// Clean up stale entries periodically (keeps memory bounded)
function pruneRateLimitMap(): void {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [key, slot] of rateLimitMap.entries()) {
    if (slot.windowStart < cutoff) rateLimitMap.delete(key);
  }
}

function checkRateLimit(ip: string, max: number): boolean {
  const now = Date.now();
  const slot = rateLimitMap.get(ip);
  if (!slot || now - slot.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  slot.count += 1;
  if (slot.count > max) return false;
  return true;
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

// Security headers applied to every response.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // ── HTTPS enforcement (redirect plain HTTP, except localhost dev) ──────────
  const proto = request.headers.get('x-forwarded-proto') ?? request.headers.get('x-client-proto');
  if (proto === 'http') {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url, { status: 301 });
  }

  // ── CORS: API routes only accept same-origin or configured origins ─────────
  if (isApi) {
    const origin = request.headers.get('origin');
    const host   = request.headers.get('x-original-host') ??
                   request.headers.get('x-client-host') ??
                   request.headers.get('host') ?? '';

    if (request.method === 'OPTIONS') {
      // Handle preflight
      const res = new NextResponse(null, { status: 204 });
      res.headers.set('Access-Control-Allow-Origin', origin === `https://${host}` ? origin : 'null');
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
      res.headers.set('Access-Control-Max-Age', '86400');
      return res;
    }

    if (origin && origin !== `https://${host}`) {
      // Cross-origin API request — reject unless from same effective host
      return NextResponse.json({ success: false, error: 'CORS_REJECTED' }, { status: 403 });
    }
  }

  // ── Rate limiting on API routes ────────────────────────────────────────────
  if (isApi && request.method !== 'GET' && request.method !== 'OPTIONS') {
    const ip = clientIp(request);
    const isObservation = pathname.startsWith('/api/inspect/observations/');
    const max = isObservation ? RATE_LIMIT_OBSERVATION_MAX : RATE_LIMIT_MAX;

    pruneRateLimitMap();
    if (!checkRateLimit(ip, max)) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }
  }

  const response = NextResponse.next();

  // ── Security headers ──────────────────────────────────────────────────────
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), magnetometer=(self)');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('X-XSS-Protection', '1; mode=block');

  if (isApi) {
    response.headers.set('Cache-Control', 'no-store');
  }

  return response;
}

export const config = {
  matcher: '/(.*)',
};
