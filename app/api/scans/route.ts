import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createScanSession, listScanSessions } from '@/lib/scan-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');
    const sessions = await listScanSessions(user);
    return NextResponse.json({ success: true, data: sessions });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');
    const body = await request.json().catch(() => ({}));
    const label = typeof body?.label === 'string' ? body.label.slice(0, 120) : null;
    const result = await createScanSession(user, label);
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
