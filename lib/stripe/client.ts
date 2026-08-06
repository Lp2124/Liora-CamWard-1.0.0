import 'server-only';
import Stripe from 'stripe';

let cached: Stripe | null = null;

/** Lazily constructed so builds without a configured key never crash. */
export function getStripeClient(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
  cached = new Stripe(key, {
    apiVersion: '2026-02-25.clover',
    maxNetworkRetries: 2,
    timeout: 20000,
  });
  return cached;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
