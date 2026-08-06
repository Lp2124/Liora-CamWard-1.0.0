import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isPremiumActive } from '@/lib/user-service';
import { handleApiError } from '@/lib/api-error-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: true, data: null });
    }
    return NextResponse.json({
      success: true,
      data: {
        openid: user.openid,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        isPremium: isPremiumActive(user),
        premiumLifetime: user.premiumLifetime,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
