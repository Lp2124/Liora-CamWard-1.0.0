/**
 * middleware.ts — Liora CamWard security middleware
 *
 * Covers:
 * - HTTPS enforcement (308 for API/POST, 301 for GET pages)
 * - CORS allowlist with full normalization (scheme + host + port + punycode +
 *   case-insensitive + null-origin + Vary: Origin + credentials)
 * - Edge-layer rate limiting (first-line flood prevention; authoritative
 *   distributed check runs in each route via lib/rate-limit.ts)
 * - Strict CSP with per-request nonce (injected via header, used by layout)
 * - Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
 *   Permissions-Policy; X-XSS-Protection intentionally omitted (deprecated)
 * - Cache-Control: no-store on all API routes
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';

// ── CORS allowlist ─────────────────────────────────────────────────────────────
// Fully-qualified origins. Add lioracamward.com once DNS propagates.
// Normalization: lowercase, no trailing slash, explicit scheme.
const CORS_ALLOWED_ORIGINS = new Set([
  'https://app-4f0a274d3e.happyseeds.space',
  'https://lioracamward.com',
  'https://www.lioracamward.com',
]);

/**
 * Normalize an origin string for comparison.
 * Handles: case, trailing slash, Punycode (already decoded by browser),
 * and rejects origins that parse as non-http(s).
 */
function normalizeOrigin(raw: string | null): string | null {
  if (!raw || raw === 'null') return null; // null-origin → blocked
  try {
    const u = new URL(raw.toLowerCase().trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // Reconstruct without path/query, with explicit port only if non-standard
    const defaultPort = u.protocol === 'https:' ? '443' : '80';
    const port = u.port && u.port !== defaultPort ? `:${u.port}` : '';
    return `${u.protocol}//${u.hostname}${port}`;
  } catch {
    return null;
  }
}

function isAllowedOrigin(origin: string | null): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return CORS_ALLOWED_ORIGINS.has(normalized);
}

// ── Edge rate limiter (first-line flood prevention only) ──────────────────────
// Authoritative distributed check is in lib/rate-limit.ts (PostgreSQL).
const edgeMap = new Map<string, { count: number; windowStart: number }>();
const EDGE_WINDOW_MS  = 60_000;
const EDGE_MAX_DEFAULT = 120;  // generous — real limit enforced in route handler
const EDGE_MAX_OBS     = 40;   // tighter for observation routes

function edgeCheck(key: string, max: number): boolean {
  const now = Date.now();
  const slot = edgeMap.get(key);
  if (!slot || now - slot.windowStart > EDGE_WINDOW_MS) {
    edgeMap.set(key, { count: 1, windowStart: now });
    if (edgeMap.size > 20_000) {
      const cutoff = now - EDGE_WINDOW_MS * 2;
      for (const [k, v] of edgeMap) { if (v.windowStart < cutoff) edgeMap.delete(k); }
    }
    return true;
  }
  slot.count += 1;
  return slot.count <= max;
}

function clientIp(req: NextRequest): string {
  // Only trust x-real-ip / x-forwarded-for from a known trusted proxy header.
  // The HappySeeds platform sets x-real-ip reliably; fall back to forwarded-for.
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp && /^[\d.a-fA-F:]+$/.test(realIp)) return realIp;
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded && /^[\d.a-fA-F:]+$/.test(forwarded)) return forwarded;
  return 'unknown';
}

// ── CSP nonce ─────────────────────────────────────────────────────────────────
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

function buildCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ];
  return directives.join('; ');
}

// ── Main middleware ───────────────────────────────────────────────────────────
export function middleware(request: NextRequest) {
  const { pathname, protocol } = request.nextUrl;
  const isApi    = pathname.startsWith('/api/');
  const method   = request.method.toUpperCase();
  const origin   = request.headers.get('origin');
  const ip       = clientIp(request);

  // ── 1. HTTPS enforcement ───────────────────────────────────────────────────
  // Only trust x-forwarded-proto / x-client-proto from platform proxy.
  // Use 308 for mutation methods (preserves body), 301 for GET/HEAD/OPTIONS.
  const proto = request.headers.get('x-forwarded-proto')
             ?? request.headers.get('x-client-proto');
  if (proto === 'http') {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    const redirectStatus = (['GET', 'HEAD', 'OPTIONS'].includes(method)) ? 301 : 308;
    return NextResponse.redirect(url, { status: redirectStatus });
  }

  // ── 2. CORS ────────────────────────────────────────────────────────────────
  if (isApi) {
    const originAllowed = !origin || isAllowedOrigin(origin); // no-origin = same-origin fetch

    if (method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-csrf-token, x-device-fingerprint',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      };
      if (origin && originAllowed) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
      } else {
        headers['Access-Control-Allow-Origin'] = 'null';
      }
      return new NextResponse(null, { status: 204, headers });
    }

    if (origin && !originAllowed) {
      return NextResponse.json(
        { success: false, error: 'CORS_REJECTED' },
        { status: 403, headers: { 'Vary': 'Origin' } },
      );
    }
  }

  // ── 3. Edge rate limiting (flood prevention — first layer only) ────────────
  if (isApi && method !== 'GET' && method !== 'OPTIONS') {
    const isObs = pathname.startsWith('/api/inspect/observations/');
    const max   = isObs ? EDGE_MAX_OBS : EDGE_MAX_DEFAULT;
    const edgeKey = `${ip}|${isObs ? 'obs' : 'api'}`;
    if (!edgeCheck(edgeKey, max)) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': '60', 'Vary': 'Origin' } },
      );
    }
  }

  // ── 4. Build response with security headers ────────────────────────────────
  const nonce    = generateNonce();
  const response = NextResponse.next({
    request: { headers: new Headers({ ...Object.fromEntries(request.headers), 'x-nonce': nonce }) },
  });

  // CSP (strict, nonce-based)
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  // Pass nonce to layout via response header
  response.headers.set('x-nonce', nonce);

  // Standard security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(self), magnetometer=(self)',
  );

  // CORS headers on allowed responses
  if (isApi && origin && isAllowedOrigin(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
  } else if (isApi) {
    response.headers.set('Vary', 'Origin');
  }

  // No caching for API
  if (isApi) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }

  return response;
}

export const config = {
  matcher: '/(.*)',
};
