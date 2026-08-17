import 'server-only';
import { createHash, randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  scanEvidenceFiles,
  scanFindings,
  scanObservationReceipts,
  scanSessions,
  type AppUser,
} from '@/db/schemas';
import type {
  Finding,
  FindingSeverity,
  ObservationAnalysisResponse,
  SubmitOpticalObservationRequest,
} from '@liora/contracts';
import {
  calculateRisk,
  classifyOpticalObservation,
  DEFAULT_DETECTION_CONFIG,
} from '@liora/detection-core';
import { ValidationError } from './errors';

export async function analyzeOpticalObservationV2(
  user: AppUser,
  request: SubmitOpticalObservationRequest,
): Promise<ObservationAnalysisResponse> {
  await assertOwnership(request.inspectionId, user.openid);

  const [cached] = await db
    .select({ response: scanObservationReceipts.response })
    .from(scanObservationReceipts)
    .where(and(
      eq(scanObservationReceipts.sessionId, request.inspectionId),
      eq(scanObservationReceipts.captureNonce, request.captureNonce),
    ))
    .limit(1);
  if (cached) return cached.response;

  const verifiedEvidence = await verifyEvidenceReferences(request);
  const hasSecondCapture =
    verifiedEvidence.torchOffCount >= DEFAULT_DETECTION_CONFIG.optical.minFramesForQuality &&
    verifiedEvidence.torchOnCount >= DEFAULT_DETECTION_CONFIG.optical.minFramesForQuality;
  const differentialDelta =
    hasSecondCapture &&
    request.pairedCapture?.differentialDelta !== null &&
    request.pairedCapture?.differentialDelta !== undefined &&
    (request.pairedCapture?.matchedClusterCount ?? 0) > 0
      ? request.pairedCapture.differentialDelta
      : undefined;

  const classification = classifyOpticalObservation({
    clusters: request.clusterData,
    captureMode: request.captureMode,
    brightnessEstimate: request.brightnessEstimate,
    torchActive: request.torchActive,
    frameCount: request.frameCount,
    hasSecondCapture,
    differentialDelta,
    overexposedRatio: request.quality?.overexposedRatio,
    sharpnessVariance: request.quality?.sharpnessVariance,
  });

  const observationId = randomUUID();
  const serverTimestamp = new Date().toISOString();
  const severity = verdictSeverity(classification.verdict);
  const reportable = classification.verdict === 'suspected_device';
  const finding: Finding | null = reportable
    ? {
        id: observationId,
        module: 'optical',
        severity,
        title: opticalTitle(classification.category),
        detail: classification.explanation,
        evidence: { source: 'optical', captureTimestamp: serverTimestamp },
      }
    : null;

  if (finding) {
    await db.insert(scanFindings).values({
      id: finding.id,
      sessionId: request.inspectionId,
      module: 'optical',
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      evidence: {
        observationId,
        captureNonce: request.captureNonce,
        serverTimestamp,
        verdict: classification.verdict,
        confidence: classification.confidence.value,
        category: classification.category,
        captureMode: request.captureMode,
        torchActive: request.torchActive,
        frameCount: request.frameCount,
        hasSecondCapture,
        differentialDelta: differentialDelta ?? null,
        evidenceIds: verifiedEvidence.evidenceIds,
        quality: request.quality ?? null,
        clientDataHash: hashClientData(request),
        algorithmVersion: classification.algorithmVersion,
        source: 'optical-classifier-server-v2',
      },
      createdAt: new Date(serverTimestamp),
    });
  }

  const findings = finding ? [finding] : [];
  const riskContribution = calculateRisk({
    findings,
    correlated: [],
    inspectionId: request.inspectionId,
  });
  const response: ObservationAnalysisResponse = {
    observationId,
    inspectionId: request.inspectionId,
    verdict: classification.verdict,
    riskContribution,
    findings,
    processedAt: serverTimestamp,
    algorithmVersion: classification.algorithmVersion,
  };

  const receiptId = randomUUID();
  await db
    .insert(scanObservationReceipts)
    .values({
      id: receiptId,
      sessionId: request.inspectionId,
      captureNonce: request.captureNonce,
      module: 'optical',
      response,
      createdAt: new Date(serverTimestamp),
    })
    .onConflictDoNothing({
      target: [scanObservationReceipts.sessionId, scanObservationReceipts.captureNonce],
    });

  const [canonical] = await db
    .select({ response: scanObservationReceipts.response })
    .from(scanObservationReceipts)
    .where(and(
      eq(scanObservationReceipts.sessionId, request.inspectionId),
      eq(scanObservationReceipts.captureNonce, request.captureNonce),
    ))
    .limit(1);
  return canonical?.response ?? response;
}

async function verifyEvidenceReferences(
  request: SubmitOpticalObservationRequest,
): Promise<{ evidenceIds: string[]; torchOffCount: number; torchOnCount: number }> {
  const references = request.frameEvidence ?? [];
  const withId = references.filter(
    (reference): reference is typeof reference & { evidenceId: string } => Boolean(reference.evidenceId),
  );
  if (withId.length === 0) return { evidenceIds: [], torchOffCount: 0, torchOnCount: 0 };

  const evidenceIds = [...new Set(withId.map((reference) => reference.evidenceId))];
  const rows = await db
    .select()
    .from(scanEvidenceFiles)
    .where(and(
      eq(scanEvidenceFiles.sessionId, request.inspectionId),
      inArray(scanEvidenceFiles.id, evidenceIds),
    ));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const reference of withId) {
    const row = byId.get(reference.evidenceId);
    if (
      !row ||
      row.sha256 !== reference.sha256 ||
      row.sizeBytes !== reference.sizeBytes ||
      row.phase !== reference.phase
    ) {
      throw new ValidationError('Referencia de evidencia óptica no verificable.');
    }
  }

  return {
    evidenceIds,
    torchOffCount: rows.filter((row) => row.phase === 'torch_off').length,
    torchOnCount: rows.filter((row) => row.phase === 'torch_on').length,
  };
}

async function assertOwnership(inspectionId: string, openid: string): Promise<void> {
  const [session] = await db
    .select({ userOpenid: scanSessions.userOpenid })
    .from(scanSessions)
    .where(eq(scanSessions.id, inspectionId))
    .limit(1);
  if (!session || session.userOpenid !== openid) {
    throw new ValidationError('Sesión de inspección no encontrada.');
  }
}

function verdictSeverity(verdict: string): FindingSeverity {
  return verdict === 'suspected_device' || verdict === 'confirmed_device' ? 'suspicious' : 'info';
}

function opticalTitle(category: string): string {
  if (category === 'lens') return 'Patrón óptico compatible con reflector pequeño';
  if (category === 'exposed_sensor') return 'Patrón óptico compatible con sensor expuesto';
  return 'Patrón óptico que requiere revisión';
}

function hashClientData(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
