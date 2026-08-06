const CALLBACK_PATH = '/api/auth/google/callback';
const SESSION_COOKIE = '__Host-happyseeds_session';
const TRANSACTION_COOKIE_PREFIX = '__Host-happyseeds_txn_';
const TRANSACTION_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface HappySeedsUser {
  openid: string;
  app_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  session_expires_at?: string | null;
}

interface LoginTransaction {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  next: string;
  createdAt: number;
}

interface SessionExchange {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: HappySeedsUser;
}

interface ApiEnvelope<T> {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
}

export type OnAuthenticatedUser = (user: HappySeedsUser) => Promise<void>;

class AuthRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(',', 1)[0]?.trim() || null;
}

function publicHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originFromTrustedHost(request: Request, rawHost: string | null): string | null {
  const host = firstHeaderValue(rawHost);
  if (!host || /[/\\?#@]/.test(host)) return null;

  const clientProto = firstHeaderValue(request.headers.get('x-client-proto'))?.toLowerCase();
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))?.toLowerCase();
  const protocol = clientProto ?? forwardedProto ?? 'https';
  if (protocol !== 'https') return null;
  return publicHttpsOrigin(`https://${host}`);
}

/**
 * Resolve the browser-visible origin behind HappySeeds preview and Cloudflare
 * proxies. Resolve each candidate independently: an internal HTTP request.url
 * must never invalidate a valid x-original-host + x-client-proto pair.
 */
export function getPublicOrigin(request: Request): string {
  const originalOrigin = originFromTrustedHost(request, request.headers.get('x-original-host'));
  if (originalOrigin) return originalOrigin;

  const clientOrigin = originFromTrustedHost(request, request.headers.get('x-client-host'));
  if (clientOrigin) return clientOrigin;

  const origin = publicHttpsOrigin(request.headers.get('origin') ?? '');
  if (origin) return origin;

  const refererOrigin = publicHttpsOrigin(request.headers.get('referer') ?? '');
  if (refererOrigin) return refererOrigin;

  const forwardedOrigin = originFromTrustedHost(request, request.headers.get('x-forwarded-host'));
  if (forwardedOrigin) return forwardedOrigin;

  const directOrigin = publicHttpsOrigin(request.url);
  if (directOrigin) return directOrigin;
  throw new AuthRouteError(400, 'invalid_public_origin');
}

export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const base = new URL('https://happyseeds.invalid');
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return '/';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function randomToken(size: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', asArrayBuffer(await sha256(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptTransaction(transaction: LoginTransaction, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(transaction));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), plaintext));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

async function decryptTransaction(value: string, secret: string): Promise<LoginTransaction> {
  const [version, ivValue, ciphertextValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !ciphertextValue) throw new AuthRouteError(400, 'invalid_login_transaction');

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(base64UrlDecode(ivValue)) },
      await encryptionKey(secret),
      asArrayBuffer(base64UrlDecode(ciphertextValue)),
    );
    const transaction = JSON.parse(decoder.decode(plaintext)) as LoginTransaction;
    if (
      typeof transaction.state !== 'string' ||
      typeof transaction.codeVerifier !== 'string' ||
      typeof transaction.redirectUri !== 'string' ||
      typeof transaction.next !== 'string' ||
      typeof transaction.createdAt !== 'number'
    ) {
      throw new Error('invalid transaction shape');
    }
    return transaction;
  } catch (error) {
    if (error instanceof AuthRouteError) throw error;
    throw new AuthRouteError(400, 'invalid_login_transaction');
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie');
  if (!cookies) return null;
  for (const entry of cookies.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) return decodeURIComponent(entry.slice(separator + 1).trim());
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None`;
}

async function transactionCookieName(state: string): Promise<string> {
  return `${TRANSACTION_COOKIE_PREFIX}${base64UrlEncode(await sha256(state)).slice(0, 24)}`;
}

function settings(): { appId: string; baseUrl: string; transactionSecret: string } {
  const appId = process.env.HAPPYSEEDS_PROJECT_ID?.trim();
  const rawBaseUrl = process.env.REACTUS_BASE_URL?.trim();
  const transactionSecret = process.env.AUTH_APP_TRANSACTION_SECRET?.trim();
  if (!appId || !rawBaseUrl || !transactionSecret || encoder.encode(transactionSecret).byteLength < 32) {
    throw new AuthRouteError(500, 'auth_configuration_error');
  }

  let base: URL;
  try {
    base = new URL(rawBaseUrl);
  } catch {
    throw new AuthRouteError(500, 'auth_configuration_error');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || (base.pathname !== '/' && base.pathname !== '')) {
    throw new AuthRouteError(500, 'auth_configuration_error');
  }
  return { appId, baseUrl: base.origin, transactionSecret };
}

function platformUrl(baseUrl: string, path: string): URL {
  return new URL(`/v1/auth_app${path}`, baseUrl);
}

async function readPlatformData<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new AuthRouteError(502, 'platform_auth_unavailable');
  }
  if (!response.ok || payload.success === false || payload.data === undefined) {
    throw new AuthRouteError(response.status === 401 ? 401 : 502, response.status === 401 ? 'unauthenticated' : 'platform_auth_unavailable');
  }
  return payload.data;
}

function jsonError(error: unknown): Response {
  const routeError = error instanceof AuthRouteError ? error : new AuthRouteError(500, 'authentication_failed');
  return Response.json({ error: routeError.code }, { status: routeError.status, headers: { 'Cache-Control': 'no-store' } });
}

function completionHtml(next: string): string {
  const encodedNext = JSON.stringify(safeNext(next)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in complete</title></head>
<body>
<p>Sign-in complete. You may close this window.</p>
<script>
const destination=${encodedNext};
if (window.opener) {
  window.opener.postMessage({type:"happyseeds:auth-complete"}, window.location.origin);
  window.close();
}
if (!window.opener || !window.closed) window.location.replace(destination);
</script>
</body>
</html>`;
}

export async function handleHappySeedsLogin(request: Request): Promise<Response> {
  try {
    const { appId, baseUrl, transactionSecret } = settings();
    const requestUrl = new URL(request.url);
    const state = randomToken(32);
    const codeVerifier = randomToken(48);
    const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
    const redirectUri = `${getPublicOrigin(request)}${CALLBACK_PATH}`;
    const transaction: LoginTransaction = {
      state,
      codeVerifier,
      redirectUri,
      next: safeNext(requestUrl.searchParams.get('next')),
      createdAt: Date.now(),
    };
    const transactionCookie = await encryptTransaction(transaction, transactionSecret);
    const authorizationUrl = platformUrl(baseUrl, '/google/authorize');
    authorizationUrl.search = new URLSearchParams({
      app_id: appId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();

    const headers = new Headers({ Location: authorizationUrl.toString(), 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie(await transactionCookieName(state), transactionCookie, TRANSACTION_TTL_SECONDS));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleHappySeedsCallback(request: Request, onAuthenticatedUser?: OnAuthenticatedUser): Promise<Response> {
  try {
    const { appId, baseUrl, transactionSecret } = settings();
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');
    if (!code || !state) throw new AuthRouteError(400, 'missing_code_or_state');

    const transactionName = await transactionCookieName(state);
    const transactionValue = readCookie(request, transactionName);
    if (!transactionValue) throw new AuthRouteError(400, 'missing_login_transaction');
    const transaction = await decryptTransaction(transactionValue, transactionSecret);
    const age = Date.now() - transaction.createdAt;
    if (age < 0 || age > TRANSACTION_TTL_SECONDS * 1000 || !constantTimeEqual(state, transaction.state)) {
      throw new AuthRouteError(400, 'invalid_login_transaction');
    }

    const exchangeResponse = await fetch(platformUrl(baseUrl, '/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        redirect_uri: transaction.redirectUri,
        code,
        code_verifier: transaction.codeVerifier,
      }),
      cache: 'no-store',
    });
    const session = await readPlatformData<SessionExchange>(exchangeResponse);
    if (!session?.access_token || !session.user?.openid || session.user.app_id !== appId || !Number.isFinite(session.expires_in)) {
      throw new AuthRouteError(502, 'invalid_platform_response');
    }

    // Apps with local user records can use this extension point to idempotently
    // upsert by OpenID and run first-registration hooks.
    if (onAuthenticatedUser) await onAuthenticatedUser(session.user);

    const maxAge = Math.max(1, Math.min(Math.floor(session.expires_in), SESSION_TTL_SECONDS));
    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
    });
    headers.append('Set-Cookie', cookie(SESSION_COOKIE, session.access_token, maxAge));
    headers.append('Set-Cookie', clearCookie(transactionName));
    return new Response(completionHtml(transaction.next), { status: 200, headers });
  } catch (error) {
    return jsonError(error);
  }
}

async function currentPlatformUser(token: string, appId: string, baseUrl: string): Promise<HappySeedsUser> {
  const url = platformUrl(baseUrl, '/user');
  url.searchParams.set('app_id', appId);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const user = await readPlatformData<HappySeedsUser>(response);
  if (!user?.openid) throw new AuthRouteError(502, 'invalid_platform_response');
  if (user.app_id !== appId) throw new AuthRouteError(401, 'unauthenticated');
  return user;
}

export async function handleHappySeedsMe(request: Request): Promise<Response> {
  try {
    const { appId, baseUrl, transactionSecret } = settings();
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) throw new AuthRouteError(401, 'unauthenticated');
    const user = await currentPlatformUser(token, appId, baseUrl);
    const csrfToken = await hmac(`logout:${token}`, transactionSecret);
    return Response.json(
      {
        user: {
          openid: user.openid,
          app_id: user.app_id,
          email: user.email ?? null,
          display_name: user.display_name ?? null,
          avatar_url: user.avatar_url ?? null,
          session_expires_at: user.session_expires_at ?? null,
        },
        csrf_token: csrfToken,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const response = jsonError(error);
    if (error instanceof AuthRouteError && error.status === 401) response.headers.append('Set-Cookie', clearCookie(SESSION_COOKIE));
    return response;
  }
}

export async function handleHappySeedsLogout(request: Request): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE));

  try {
    const { appId, baseUrl, transactionSecret } = settings();
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return new Response(null, { status: 204, headers });

    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin') throw new AuthRouteError(403, 'csrf_rejected');
    const suppliedCsrf = request.headers.get('x-csrf-token') ?? '';
    const expectedCsrf = await hmac(`logout:${token}`, transactionSecret);
    if (!constantTimeEqual(suppliedCsrf, expectedCsrf)) throw new AuthRouteError(403, 'csrf_rejected');

    try {
      await fetch(platformUrl(baseUrl, '/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ app_id: appId }),
        cache: 'no-store',
      });
    } catch {
      // Local logout must succeed even when remote revocation is unavailable.
    }
    return new Response(null, { status: 204, headers });
  } catch (error) {
    return jsonError(error);
  }
}
