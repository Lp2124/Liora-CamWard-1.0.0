import { NextResponse } from 'next/server';
import { db } from '@/db';
import { appUsers, stripeWebhookEvents } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getStripeClient } from '@/lib/stripe/client';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook ingress: HTTP parsing + signature verification only.
 * Business effects live below in a small dedicated handler per event type.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: 'STRIPE_WEBHOOK_NOT_CONFIGURED' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ success: false, error: 'MISSING_SIGNATURE' }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    console.error('[stripe] webhook.signature_invalid', error);
    return NextResponse.json({ success: false, error: 'INVALID_SIGNATURE' }, { status: 400 });
  }

  const [already] = await db.select().from(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id)).limit(1);
  if (already) {
    return NextResponse.json({ success: true, data: { deduped: true } });
  }

  try {
    await handleEvent(event);
    await db.insert(stripeWebhookEvents).values({ eventId: event.id, type: event.type });
    return NextResponse.json({ success: true, data: { received: true } });
  } catch (error) {
    console.error('[stripe] webhook.handler_failed', { eventId: event.id, type: event.type, error });
    return NextResponse.json({ success: false, error: 'HANDLER_FAILED' }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const openid = session.client_reference_id ?? (session.metadata?.openid as string | undefined);
      if (!openid) return;
      await db
        .update(appUsers)
        .set({ isPremium: true, premiumSince: new Date(), stripeCustomerId: (session.customer as string) ?? null })
        .where(eq(appUsers.openid, openid));
      return;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const [user] = await db.select().from(appUsers).where(eq(appUsers.stripeCustomerId, customerId)).limit(1);
      if (user && !user.premiumLifetime) {
        await db.update(appUsers).set({ isPremium: false }).where(eq(appUsers.stripeCustomerId, customerId));
      }
      return;
    }
    default:
      return;
  }
}
