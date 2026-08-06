/**
 * POST /api/inspect/observations/magnetic
 *
 * Fase 4: Autoridad del servidor.
 * El cliente envía muestras crudas del magnetómetro.
 * El servidor calcula: estado, severidad, confianza, texto.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { analyzeMagneticObservation } from '@/lib/inspection-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError, PayloadTooLargeError } from '@/lib/errors';

const MAX_BODY_BYTES = 64 * 1024;
import type { SubmitMagneticObservationRequest } from '@liora/contracts';

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

    validateMagneticRequest(body);

    const result = await analyzeMagneticObservation(user, body as SubmitMagneticObservationRequest);
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

  // Rechazar campos que el cliente no puede enviar
  const forbidden = ['riskLevel', 'severity', 'anomalyDetected', 'magneticSource'];
  for (const f of forbidden) {
    if (f in b) throw new ValidationError(`Campo '${f}' no está permitido.`);
  }
}
