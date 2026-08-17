import { randomUUID, createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { scanEvidenceFiles, scanSessions } from '@/db/schemas';
import { getCurrentUser } from '@/lib/session';
import { handleApiError } from '@/lib/api-error-response';
import {
  PayloadTooLargeError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import {
  buildRateLimitKey,
  checkAndIncrementRateLimit,
  RATE_LIMIT_CONFIGS,
} from '@/lib/rate-limit';
import { putPrivateEvidenceObject } from '@/lib/evidence-storage';
import type { UploadOpticalEvidenceResponse } from '@liora/contracts';

const MAX_JPEG_BYTES = 5 * 1024 * 1024;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');

    const url = new URL(request.url);
    const inspectionId = url.searchParams.get('inspectionId') ?? '';
    const captureNonce = url.searchParams.get('captureNonce') ?? '';
    const phase = url.searchParams.get('phase') ?? '';

    validateIdentifiers(inspectionId, captureNonce, phase);
    await assertInspectionOwnership(inspectionId, user.openid);

    const rateLimit = await checkAndIncrementRateLimit(
      buildRateLimitKey({
        userId: user.openid,
        sessionId: inspectionId,
        ip: requestIp(request),
        pathname: '/api/inspect/evidence/optical',
        operation: 'upload-optical-evidence',
      }),
      RATE_LIMIT_CONFIGS.observation,
    );
    if (!rateLimit.allowed) throw new RateLimitError('Límite de carga de evidencia excedido.');

    const contentType = (request.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'image/jpeg') throw new ValidationError('Se requiere Content-Type image/jpeg.');

    const bytes = await readLimitedBody(request, MAX_JPEG_BYTES);
    if (!isJpeg(bytes)) throw new ValidationError('El contenido recibido no es un JPEG válido.');

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const [existing] = await db
      .select()
      .from(scanEvidenceFiles)
      .where(and(
        eq(scanEvidenceFiles.sessionId, inspectionId),
        eq(scanEvidenceFiles.captureNonce, captureNonce),
      ))
      .limit(1);

    if (existing) {
      if (existing.sha256 !== sha256 || existing.phase !== phase || existing.sizeBytes !== bytes.byteLength) {
        throw new ValidationError('captureNonce reutilizado con evidencia diferente.');
      }
      return NextResponse.json({ success: true, data: toResponse(existing) }, { status: 200 });
    }

    const evidenceId = randomUUID();
    const storageKey = `optical/${inspectionId}/${evidenceId}-${sha256}.jpg`;
    await putPrivateEvidenceObject({
      key: storageKey,
      bytes,
      mimeType: 'image/jpeg',
      sha256,
    });

    const createdAt = new Date();
    await db.insert(scanEvidenceFiles).values({
      id: evidenceId,
      sessionId: inspectionId,
      captureNonce,
      phase,
      storageKey,
      sha256,
      sizeBytes: bytes.byteLength,
      mimeType: 'image/jpeg',
      createdAt,
    });

    const data: UploadOpticalEvidenceResponse = {
      evidenceId,
      inspectionId,
      captureNonce,
      phase: phase as 'torch_off' | 'torch_on',
      sha256,
      sizeBytes: bytes.byteLength,
      mimeType: 'image/jpeg',
      storedAt: createdAt.toISOString(),
    };
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

async function assertInspectionOwnership(inspectionId: string, openid: string): Promise<void> {
  const [session] = await db
    .select({ id: scanSessions.id, userOpenid: scanSessions.userOpenid })
    .from(scanSessions)
    .where(eq(scanSessions.id, inspectionId))
    .limit(1);
  if (!session || session.userOpenid !== openid) {
    throw new ValidationError('Sesión de inspección no encontrada.');
  }
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) throw new ValidationError('JPEG requerido.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new PayloadTooLargeError(`JPEG excede ${maxBytes} bytes.`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) throw new ValidationError('JPEG vacío.');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

function validateIdentifiers(inspectionId: string, captureNonce: string, phase: string): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (!uuid.test(inspectionId)) throw new ValidationError('inspectionId inválido.');
  if (!uuid.test(captureNonce)) throw new ValidationError('captureNonce inválido.');
  if (phase !== 'torch_off' && phase !== 'torch_on') throw new ValidationError('phase inválido.');
}

function requestIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ||
    'unknown';
}

function toResponse(row: typeof scanEvidenceFiles.$inferSelect): UploadOpticalEvidenceResponse {
  return {
    evidenceId: row.id,
    inspectionId: row.sessionId,
    captureNonce: row.captureNonce,
    phase: row.phase as 'torch_off' | 'torch_on',
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    mimeType: 'image/jpeg',
    storedAt: row.createdAt.toISOString(),
  };
}
