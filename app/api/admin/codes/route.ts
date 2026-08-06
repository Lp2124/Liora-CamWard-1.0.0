import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { ensureFiftyCreatorCodes, listCodesForAdmin } from '@/lib/premium-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user?.isAdmin) throw new UnauthorizedError('Acceso restringido al creador de la app.');
    await ensureFiftyCreatorCodes();
    const codes = await listCodesForAdmin();
    return NextResponse.json({ success: true, data: codes });
  } catch (error) {
    return handleApiError(error);
  }
}
