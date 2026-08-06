import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { handleApiError } from '@/lib/api-error-response';
import {
  getScanCalibration, setScanCalibration,
  getStripeConfig, setStripeConfig,
  DEFAULT_CALIBRATION,
} from '@/lib/settings-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user?.isAdmin) return NextResponse.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const [calibration, stripe] = await Promise.all([getScanCalibration(), getStripeConfig()]);

    // Never return the actual secret key — only whether it's configured
    const stripeStatus = {
      hasSecretKey:     !!stripe.secretKey,
      hasWebhookSecret: !!stripe.webhookSecret,
      hasPriceId:       !!stripe.priceId,
      mode:             stripe.mode ?? 'test',
      priceId:          stripe.priceId ?? '',
    };

    return NextResponse.json({ success: true, data: { calibration, stripe: stripeStatus, defaults: DEFAULT_CALIBRATION } });
  } catch (e) { return handleApiError(e); }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user?.isAdmin) return NextResponse.json({ success: false, error: 'FORBIDDEN' }, { status: 403 });

    const body = await request.json() as {
      section: 'stripe' | 'calibration';
      data: Record<string, unknown>;
    };

    if (body.section === 'stripe') {
      await setStripeConfig({
        secretKey:     typeof body.data.secretKey     === 'string' ? body.data.secretKey     : undefined,
        webhookSecret: typeof body.data.webhookSecret === 'string' ? body.data.webhookSecret : undefined,
        priceId:       typeof body.data.priceId       === 'string' ? body.data.priceId       : undefined,
        mode:          body.data.mode === 'live' ? 'live' : 'test',
      });
    } else if (body.section === 'calibration') {
      await setScanCalibration({
        brightnessThreshold:  typeof body.data.brightnessThreshold  === 'number' ? body.data.brightnessThreshold  : undefined,
        persistFrames:        typeof body.data.persistFrames        === 'number' ? body.data.persistFrames        : undefined,
        compactnessMin:       typeof body.data.compactnessMin       === 'number' ? body.data.compactnessMin       : undefined,
        magneticDeltaUt:      typeof body.data.magneticDeltaUt      === 'number' ? body.data.magneticDeltaUt      : undefined,
        magneticConfirmCount: typeof body.data.magneticConfirmCount === 'number' ? body.data.magneticConfirmCount : undefined,
      });
    } else {
      return NextResponse.json({ success: false, error: 'INVALID_SECTION' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e) { return handleApiError(e); }
}
