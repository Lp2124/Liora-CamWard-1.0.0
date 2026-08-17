import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { analyzeOpticalObservationV2 } from '@/lib/optical-inspection-service';
import { handleApiError } from '@/lib/api-error-response';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { readBodyJson } from '@/lib/body-parser';
import {
  buildRateLimitKey,
  checkAndIncrementRateLimit,
  RATE_LIMIT_CONFIGS,
} from '@/lib/rate-limit';
import type { SubmitOpticalObservationRequest } from '@liora/contracts';

const MAX_BODY_BYTES = 128 * 1024;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) throw new UnauthorizedError('Debes iniciar sesión.');

    const body = await readBodyJson<Record<string, unknown>>(request, MAX_BODY_BYTES);
    validateOpticalRequest(body);

    const limit = await checkAndIncrementRateLimit(
      buildRateLimitKey({
        userId: user.openid,
        sessionId: body.inspectionId,
        deviceFingerprint: typeof body.deviceFingerprint === 'string' ? body.deviceFingerprint : undefined,
        ip: requestIp(request),
        pathname: '/api/inspect/observations/optical',
        operation: 'submit-optical-observation',
      }),
      RATE_LIMIT_CONFIGS.observation,
    );
    if (!limit.allowed) throw new ValidationError('Límite de observaciones ópticas excedido.');

    const result = await analyzeOpticalObservationV2(
      user,
      body as unknown as SubmitOpticalObservationRequest,
    );
    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

function validateOpticalRequest(body: Record<string, unknown>): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (typeof body.inspectionId !== 'string' || !uuid.test(body.inspectionId)) {
    throw new ValidationError('inspectionId inválido.');
  }
  if (typeof body.captureNonce !== 'string' || !uuid.test(body.captureNonce)) {
    throw new ValidationError('captureNonce inválido.');
  }
  if (typeof body.clientTimestamp !== 'string' || !Number.isFinite(Date.parse(body.clientTimestamp))) {
    throw new ValidationError('clientTimestamp inválido.');
  }
  if (body.captureMode !== 'normal' && body.captureMode !== 'torch_off' && body.captureMode !== 'torch_on') {
    throw new ValidationError('captureMode inválido.');
  }
  if (typeof body.brightnessEstimate !== 'number' || !Number.isFinite(body.brightnessEstimate) || body.brightnessEstimate < 0 || body.brightnessEstimate > 255) {
    throw new ValidationError('brightnessEstimate inválido.');
  }
  if (typeof body.torchActive !== 'boolean') throw new ValidationError('torchActive requerido.');
  if (typeof body.frameCount !== 'number' || !Number.isInteger(body.frameCount) || body.frameCount < 1 || body.frameCount > 60) {
    throw new ValidationError('frameCount inválido.');
  }
  if (!Array.isArray(body.clusterData) || body.clusterData.length > 500) {
    throw new ValidationError('clusterData inválido.');
  }
  for (const value of body.clusterData) validateCluster(value);

  if (body.quality !== undefined) validateQuality(body.quality);
  if (body.pairedCapture !== undefined) validatePair(body.pairedCapture);
  if (body.frameEvidence !== undefined) validateEvidenceReferences(body.frameEvidence);

  for (const field of ['riskLevel', 'severity', 'verdict', 'riskScore', 'confidence', 'findingText', 'category', 'algorithmVersion']) {
    if (field in body) throw new ValidationError(`Campo '${field}' no está permitido; lo calcula el servidor.`);
  }
}

function validateCluster(value: unknown): void {
  if (!isRecord(value)) throw new ValidationError('Cluster óptico inválido.');
  boundedNumber(value.persistedFrames, 0, 60, 'persistedFrames');
  boundedNumber(value.relativeX, 0, 100, 'relativeX');
  boundedNumber(value.relativeY, 0, 100, 'relativeY');
  boundedNumber(value.clusterSizePx, 1, 100000, 'clusterSizePx');
  boundedNumber(value.compactness, 0, 1, 'compactness');
  boundedNumber(value.maxBrightness, 0, 255, 'maxBrightness');
  boundedNumber(value.saturation, 0, 1, 'saturation');
}

function validateQuality(value: unknown): void {
  if (!isRecord(value)) throw new ValidationError('quality inválido.');
  boundedNumber(value.overexposedRatio, 0, 1, 'overexposedRatio');
  boundedNumber(value.sharpnessVariance, 0, Number.MAX_SAFE_INTEGER, 'sharpnessVariance');
}

function validatePair(value: unknown): void {
  if (!isRecord(value)) throw new ValidationError('pairedCapture inválido.');
  boundedNumber(value.torchOffFrameCount, 1, 60, 'torchOffFrameCount');
  boundedNumber(value.torchOnFrameCount, 1, 60, 'torchOnFrameCount');
  boundedNumber(value.torchOffBrightnessEstimate, 0, 255, 'torchOffBrightnessEstimate');
  boundedNumber(value.torchOnBrightnessEstimate, 0, 255, 'torchOnBrightnessEstimate');
  boundedNumber(value.matchedClusterCount, 0, 500, 'matchedClusterCount');
  if (value.differentialDelta !== null && value.differentialDelta !== undefined) {
    boundedNumber(value.differentialDelta, -255, 255, 'differentialDelta');
  }
}

function validateEvidenceReferences(value: unknown): void {
  if (!Array.isArray(value) || value.length > 60) throw new ValidationError('frameEvidence inválido.');
  for (const reference of value) {
    if (!isRecord(reference)) throw new ValidationError('Referencia de evidencia inválida.');
    if (reference.phase !== 'torch_off' && reference.phase !== 'torch_on') {
      throw new ValidationError('Fase de evidencia inválida.');
    }
    if (typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.sha256)) {
      throw new ValidationError('SHA-256 de evidencia inválido.');
    }
    boundedNumber(reference.sizeBytes, 1, 5 * 1024 * 1024, 'sizeBytes');
    if (reference.evidenceId !== undefined && (typeof reference.evidenceId !== 'string' || reference.evidenceId.length > 80)) {
      throw new ValidationError('evidenceId inválido.');
    }
  }
}

function boundedNumber(value: unknown, min: number, max: number, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${field} inválido.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ||
    'unknown';
}
