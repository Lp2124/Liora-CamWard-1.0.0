import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { redeemCode } from '@/lib/premium-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');
    const body = await request.json().catch(() => ({}));
    if (typeof body?.code !== 'string') throw new ValidationError('Introduce un código.');
    await redeemCode(user, body.code);
    return NextResponse.json({ success: true, data: { redeemed: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
