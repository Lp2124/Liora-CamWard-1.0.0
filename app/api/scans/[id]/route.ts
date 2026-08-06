import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { finishScanSession, getScanSessionWithFindings } from '@/lib/scan-service';
import { handleApiError } from '@/lib/api-error-response';
import { NotFoundError, UnauthorizedError, ValidationError, PayloadTooLargeError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const ALLOWED_MODULES = new Set(['network', 'bluetooth', 'optical', 'magnetic']);
const MAX_BODY_BYTES = 16 * 1024; // 16 KB — just modulesRun list, no findings payload

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');
    const { id } = await params;
    const result = await getScanSessionWithFindings(user, id);
    if (!result) throw new NotFoundError('Reporte no encontrado.');
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/scans/:id — finalizes a scan session.
 *
 * The client supplies ONLY the list of modules that ran.
 * The server recomputes riskLevel from the findings already persisted in the DB
 * via /api/inspect/observations/* — the client CANNOT dictate risk or findings.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');
    const { id } = await params;

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) throw new PayloadTooLargeError('Cuerpo demasiado grande.');

    const raw = await request.text().catch(() => null);
    if (!raw) throw new ValidationError('Cuerpo de solicitud inválido.');
    if (raw.length > MAX_BODY_BYTES) throw new PayloadTooLargeError('Cuerpo demasiado grande.');

    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ValidationError('Cuerpo de solicitud inválido.'); }
    if (typeof body !== 'object' || body === null) throw new ValidationError('Cuerpo de solicitud inválido.');

    // Only accept modulesRun — reject any attempt to supply riskLevel or findings
    const b = body as Record<string, unknown>;
    const forbidden = ['riskLevel', 'findings', 'severity', 'riskScore'];
    for (const f of forbidden) {
      if (f in b) throw new ValidationError(`Campo '${f}' no está permitido — el servidor lo calcula a partir de las observaciones persistidas.`);
    }

    const modulesRun = Array.isArray(b.modulesRun)
      ? b.modulesRun.filter((m: unknown) => typeof m === 'string' && ALLOWED_MODULES.has(m))
      : [];

    // Server recomputes risk from DB findings — no client-supplied findings accepted
    await finishScanSession(user, id, modulesRun);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}
