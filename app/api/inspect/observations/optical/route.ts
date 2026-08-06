/**
 * POST /api/inspect/observations/optical
 *
 * Fase 4: Autoridad del servidor.
 * El cliente envía observaciones crudas de clusters ópticos.
 * El servidor calcula: verdict, severity, riskLevel, confidence.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { analyzeOpticalObservation } from '@/lib/inspection-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError, PayloadTooLargeError } from '@/lib/errors';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB
import type { SubmitOpticalObservationRequest } from '@liora/contracts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) throw new PayloadTooLargeError('Observación demasiado grande (máx 64 KB).');

    const raw = await request.text().catch(() => null);
    if (!raw) throw new ValidationError('Cuerpo de solicitud inválido.');
    if (raw.length > MAX_BODY_BYTES) throw new PayloadTooLargeError('Observación demasiado grande (máx 64 KB).');

    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ValidationError('Cuerpo de solicitud inválido.'); }
    if (!body) throw new ValidationError('Cuerpo de solicitud inválido.');

    validateOpticalRequest(body);

    const result = await analyzeOpticalObservation(user, body as SubmitOpticalObservationRequest);
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

function validateOpticalRequest(body: unknown): void {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Cuerpo inválido.');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.inspectionId !== 'string' || !b.inspectionId) {
    throw new ValidationError('inspectionId requerido.');
  }
  if (typeof b.captureNonce !== 'string' || !b.captureNonce) {
    throw new ValidationError('captureNonce requerido.');
  }
  if (typeof b.clientTimestamp !== 'string') {
    throw new ValidationError('clientTimestamp requerido.');
  }
  if (!Array.isArray(b.clusterData)) {
    throw new ValidationError('clusterData debe ser un array.');
  }
  if (!['normal', 'torch_off', 'torch_on'].includes(b.captureMode as string)) {
    throw new ValidationError('captureMode inválido.');
  }
  // Campos que el cliente NO puede enviar — los rechazamos explícitamente
  const forbidden = ['riskLevel', 'severity', 'verdict', 'riskScore', 'confidence', 'findingText'];
  for (const f of forbidden) {
    if (f in b) throw new ValidationError(`Campo '${f}' no está permitido — el servidor lo calcula.`);
  }
}
