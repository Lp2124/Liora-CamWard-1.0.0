import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { analyzeNetworkObservation } from '@/lib/inspection-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { readBodyJson } from '@/lib/body-parser';
import type { SubmitNetworkObservationRequest } from '@liora/contracts';

const MAX_BODY_BYTES = 32 * 1024;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');

    const body = await readBodyJson<Record<string, unknown>>(request, MAX_BODY_BYTES);
    validateNetworkRequest(body);

    const result = await analyzeNetworkObservation(user, body as unknown as SubmitNetworkObservationRequest);
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

function validateNetworkRequest(body: unknown): void {
  if (typeof body !== 'object' || body === null) throw new ValidationError('Cuerpo inválido.');
  const b = body as Record<string, unknown>;
  if (typeof b.inspectionId !== 'string' || !b.inspectionId) throw new ValidationError('inspectionId requerido.');
  if (typeof b.captureNonce !== 'string' || !b.captureNonce) throw new ValidationError('captureNonce requerido.');

  for (const f of ['riskLevel', 'severity', 'cameraFound', 'deviceType', 'verdict', 'classification']) {
    if (f in b) throw new ValidationError(`Campo '${f}' no está permitido.`);
  }
}
