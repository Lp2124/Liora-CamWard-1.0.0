import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { analyzeMagneticObservation } from '@/lib/inspection-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { readBodyJson } from '@/lib/body-parser';
import type { SubmitMagneticObservationRequest } from '@liora/contracts';

const MAX_BODY_BYTES = 64 * 1024;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');

    const body = await readBodyJson<Record<string, unknown>>(request, MAX_BODY_BYTES);
    validateMagneticRequest(body);

    const result = await analyzeMagneticObservation(user, body as unknown as SubmitMagneticObservationRequest);
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

function validateMagneticRequest(body: unknown): void {
  if (typeof body !== 'object' || body === null) throw new ValidationError('Cuerpo inválido.');
  const b = body as Record<string, unknown>;
  if (typeof b.inspectionId !== 'string' || !b.inspectionId) throw new ValidationError('inspectionId requerido.');
  if (typeof b.captureNonce !== 'string' || !b.captureNonce) throw new ValidationError('captureNonce requerido.');
  if (!Array.isArray(b.samples) || b.samples.length === 0) throw new ValidationError('samples debe ser un array no vacío.');

  for (const f of ['riskLevel', 'severity', 'anomalyDetected', 'magneticSource', 'state', 'confidence']) {
    if (f in b) throw new ValidationError(`Campo '${f}' no está permitido.`);
  }
}
