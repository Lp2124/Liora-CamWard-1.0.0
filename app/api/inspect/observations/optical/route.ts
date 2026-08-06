/**
 * POST /api/inspect/observations/optical
 *
 * Autoridad del servidor: el cliente envía clusters crudos.
 * El servidor calcula verdict, severity, riskLevel, confidence.
 * Body leído con streaming real — no depende solo de Content-Length.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { analyzeOpticalObservation } from '@/lib/inspection-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { readBodyJson } from '@/lib/body-parser';
import type { SubmitOpticalObservationRequest } from '@liora/contracts';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');

    const body = await readBodyJson<Record<string, unknown>>(request, MAX_BODY_BYTES);
    validateOpticalRequest(body);

    const result = await analyzeOpticalObservation(user, body as unknown as SubmitOpticalObservationRequest);
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

function validateOpticalRequest(body: unknown): void {
  if (typeof body !== 'object' || body === null) throw new ValidationError('Cuerpo inválido.');
  const b = body as Record<string, unknown>;

  if (typeof b.inspectionId !== 'string' || !b.inspectionId) throw new ValidationError('inspectionId requerido.');
  if (typeof b.captureNonce !== 'string' || !b.captureNonce) throw new ValidationError('captureNonce requerido.');
  if (typeof b.clientTimestamp !== 'string') throw new ValidationError('clientTimestamp requerido.');
  if (!Array.isArray(b.clusterData)) throw new ValidationError('clusterData debe ser un array.');
  if (!['normal', 'torch_off', 'torch_on'].includes(b.captureMode as string)) throw new ValidationError('captureMode inválido.');

  // Client MUST NOT supply server-computed fields
  for (const f of ['riskLevel', 'severity', 'verdict', 'riskScore', 'confidence', 'findingText', 'category', 'algorithmVersion']) {
    if (f in b) throw new ValidationError(`Campo '${f}' no está permitido — el servidor lo calcula.`);
  }
}
