import 'server-only';
import { getUserByOpenid } from './user-service';
import { handleHappySeedsMe } from './happyseeds-platform-auth';
import type { AppUser } from '@/db/schemas';

const SESSION_COOKIE = '__Host-happyseeds_session';

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Resolves the authenticated HappySeeds user for the current request.
 * Calls the platform auth handler directly (no internal HTTP fetch) so it
 * works correctly in both Cloudflare Workers and local dev without any
 * host-resolution issues.
 */
export async function getCurrentUser(request: Request): Promise<AppUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  // Call the platform verifier directly — avoids an internal HTTP round-trip
  // that breaks on Cloudflare Workers when the host header is internal.
  const meResponse = await handleHappySeedsMe(request);
  if (!meResponse.ok) return null;

  let payload: { user?: { openid?: string } };
  try {
    payload = (await meResponse.json()) as { user?: { openid?: string } };
  } catch {
    return null;
  }

  const openid = payload.user?.openid;
  if (!openid) return null;

  return (await getUserByOpenid(openid)) ?? null;
}
