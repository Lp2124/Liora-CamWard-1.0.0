import 'server-only';
import { getStripeClient } from './client';
import type { AppUser } from '@/db/schemas';
import { AppError } from '../errors';

const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID;

export interface CreateCheckoutInput {
  user: AppUser;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Business action: start a Premium subscription checkout for one user.
 * Idempotency: Stripe Checkout Sessions are inherently one-shot; we pass the
 * user openid as client_reference_id so the webhook can map back safely even
 * if this endpoint is called twice in a row (Stripe dedupes by session).
 */
export async function createPremiumCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string }> {
  if (!PREMIUM_PRICE_ID) {
    throw new AppError('STRIPE_PRICE_NOT_CONFIGURED', 500, 'STRIPE_PRICE_NOT_CONFIGURED');
  }

  const stripe = getStripeClient();
  console.info('[stripe] checkout.start', { openid: input.user.openid });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PREMIUM_PRICE_ID, quantity: 1 }],
      customer_email: input.user.email ?? undefined,
      client_reference_id: input.user.openid,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { openid: input.user.openid },
    });

    if (!session.url) throw new AppError('STRIPE_SESSION_NO_URL', 502, 'STRIPE_SESSION_NO_URL');
    console.info('[stripe] checkout.success', { openid: input.user.openid, sessionId: session.id });
    return { url: session.url };
  } catch (error) {
    console.error('[stripe] checkout.failed', { openid: input.user.openid, error });
    if (error instanceof AppError) throw error;
    throw new AppError('STRIPE_CHECKOUT_FAILED', 502, 'STRIPE_CHECKOUT_FAILED');
  }
}
