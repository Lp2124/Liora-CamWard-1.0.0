import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createPremiumCheckoutSession } from '@/lib/stripe/premium-checkout';
import { isStripeConfigured } from '@/lib/stripe/client';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');
    if (!isStripeConfigured()) throw new AppError('Los pagos todavía no están configurados por el administrador.', 503, 'STRIPE_NOT_CONFIGURED');

    const origin = new URL(request.url).origin;
    const { url } = await createPremiumCheckoutSession({
      user,
      successUrl: `${origin}/premium?checkout=success`,
      cancelUrl: `${origin}/premium?checkout=cancelled`,
    });
    return NextResponse.json({ success: true, data: { url } });
  } catch (error) {
    return handleApiError(error);
  }
}
