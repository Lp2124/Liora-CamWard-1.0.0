/**
 * InspectionService — SERVER-SIDE ONLY
 *
 * Fase 4: Autoridad del servidor.
 * El cliente SOLO envía observaciones crudas.
 * El servidor calcula: clasificación, severidad, riesgo, confianza,
 * correlación, texto del hallazgo, evidenceId, timestamps, hashes.
 *
 * El cliente NUNCA puede enviar: riskLevel, severity, tipo final de hallazgo,
 * evidenceId, timestamps del servidor, texto descriptivo, datos firmados.
 */
import 'server-only';
import { randomUUID, createHash } from 'crypto';
import { db } from '@/db';
import { scanSessions, scanFindings, usageCounters } from '@/db/schemas';
import { eq, sql } from 'drizzle-orm';
import type { AppUser } from '@/db/schemas';
import { ValidationError } from './errors';
import type {
  SubmitOpticalObservationRequest,
  SubmitMagneticObservationRequest,
  SubmitBleObservationRequest,
  SubmitNetworkObservationRequest,
  ObservationAnalysisResponse,
} from '@liora/contracts';
import {
  classifyOpticalObservation,
  analyzeMagneticObservation as analyzeMagneticSamples,
  classifyBleDevice,
  calculateRisk,
  DEFAULT_DETECTION_CONFIG,
} from '@liora/detection-core';

// ── Límite mensual gratuito ────────────────────────────────────────────────────
const FREE_SCANS_PER_MONTH = 10;

/** Verifica y consume un scan del cupo gratuito (atómico) */
export async function consumeFreeScanSlot(user: AppUser): Promise<void> {
  if (user.isPremium) return; // premium ilimitado

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // UPSERT atómico: incrementa o inicializa
  const result = await db.execute(sql`
    INSERT INTO usage_counters (user_openid, scans_this_month, period_start)
    VALUES (${user.openid}, 1, ${periodStart.toISOString()})
    ON CONFLICT (user_openid) DO UPDATE
      SET scans_this_month = CASE
            WHEN usage_counters.period_start < ${periodStart.toISOString()}::timestamptz
            THEN 1
            ELSE usage_counters.scans_this_month + 1
          END,
          period_start = CASE
            WHEN usage_counters.period_start < ${periodStart.toISOString()}::timestamptz
            THEN ${periodStart.toISOString()}::timestamptz
            ELSE usage_counters.period_start
          END
    RETURNING scans_this_month
  `);

  const rows = (result as unknown as { rows: { scans_this_month: number }[] }).rows;
  if (rows[0]?.scans_this_month > FREE_SCANS_PER_MONTH) {
    throw new ValidationError(`QUOTA_EXCEEDED: ${FREE_SCANS_PER_MONTH} scans mensuales gratuitos agotados. Activa Premium para continuar.`);
  }
}

// ── Análisis de observación óptica ─────────────────────────────────────────────

export async function analyzeOpticalObservation(
  user: AppUser,
  req: SubmitOpticalObservationRequest,
): Promise<ObservationAnalysisResponse> {
  await validateInspectionOwnership(req.inspectionId, user);

  // Servidor calcula clasificación — el cliente no puede manipular el resultado
  const classification = classifyOpticalObservation(
    {
      clusters: req.clusterData,
      captureMode: req.captureMode,
      brightnessEstimate: req.brightnessEstimate,
      torchActive: req.torchActive,
      frameCount: req.frameCount,
      hasSecondCapture: false, // primera captura — requiere segunda para suspected_device
    },
    DEFAULT_DETECTION_CONFIG,
  );

  // Derivar severidad del verdict — el cliente NUNCA envía severity
  const severity = verdictToSeverity(classification.verdict);

  const observationId = randomUUID();
  const serverTimestamp = new Date().toISOString();

  // Persistir hallazgo SOLO para verdicts confirmatorios (no review_required ni clear)
  const reportable = isReportableVerdict(classification.verdict);
  if (reportable) {
    await db.insert(scanFindings).values({
      id: observationId,
      sessionId: req.inspectionId,
      module: 'optical',
      severity,
      title: buildOpticalTitle(classification.verdict, classification.category),
      detail: classification.explanation,
      evidence: {
        observationId,
        captureNonce: req.captureNonce,
        serverTimestamp,
        verdict: classification.verdict,
        confidence: classification.confidence.value,
        category: classification.category,
        boundingBoxes: classification.boundingBoxes,
        captureMode: req.captureMode,
        torchActive: req.torchActive,
        frameCount: req.frameCount,
        algorithmVersion: classification.algorithmVersion,
        clientDataHash: hashClientData(req),
        source: 'optical-classifier-server-v1',
      },
      createdAt: new Date(),
    });
  }

  const riskResult = calculateRisk({
    findings: reportable
      ? [{
          id: observationId,
          module: 'optical',
          severity,
          title: buildOpticalTitle(classification.verdict, classification.category),
          detail: classification.explanation,
          evidence: { source: 'optical', captureTimestamp: req.clientTimestamp },
        }]
      : [],
    correlated: [],
    inspectionId: req.inspectionId,
  });

  return {
    observationId,
    inspectionId: req.inspectionId,
    verdict: classification.verdict,
    riskContribution: riskResult,
    findings: reportable
      ? [{
          id: observationId,
          module: 'optical',
          severity,
          title: buildOpticalTitle(classification.verdict, classification.category),
          detail: classification.explanation,
          evidence: { source: 'optical', captureTimestamp: serverTimestamp },
        }]
      : [],
    processedAt: serverTimestamp,
    algorithmVersion: classification.algorithmVersion,
  };
}

// ── Análisis de observación magnética ──────────────────────────────────────────

export async function analyzeMagneticObservation(
  user: AppUser,
  req: SubmitMagneticObservationRequest,
): Promise<ObservationAnalysisResponse> {
  await validateInspectionOwnership(req.inspectionId, user);

  const analysis = analyzeMagneticSamples(req.samples, {
    baselineSampleMs: DEFAULT_DETECTION_CONFIG.magnetic.baselineSampleMs,
    anomalyDeltaUt: DEFAULT_DETECTION_CONFIG.magnetic.anomalyDeltaUt,
    anomalyConfirmCount: DEFAULT_DETECTION_CONFIG.magnetic.anomalyConfirmCount,
    madMultiplier: DEFAULT_DETECTION_CONFIG.magnetic.madMultiplier,
    saturationThreshold: DEFAULT_DETECTION_CONFIG.magnetic.saturationThreshold,
    minCalibrationSamples: DEFAULT_DETECTION_CONFIG.magnetic.minCalibrationSamples,
  });

  // Magnetómetro NUNCA produce severity 'high' por sí solo — solo secundario
  const severity = magneticStateToSeverity(analysis.state);
  const observationId = randomUUID();
  const serverTimestamp = new Date().toISOString();

  if (severity !== 'info' || analysis.state === 'magnetic_source_nearby') {
    await db.insert(scanFindings).values({
      id: observationId,
      sessionId: req.inspectionId,
      module: 'magnetic',
      severity,
      title: buildMagneticTitle(analysis.state, analysis.signedDeltaMicroTesla),
      detail: analysis.explanation,
      evidence: {
        observationId,
        captureNonce: req.captureNonce,
        serverTimestamp,
        state: analysis.state,
        baselineMicroTesla: analysis.baselineMicroTesla,
        currentMicroTesla: analysis.currentMicroTesla,
        signedDeltaMicroTesla: analysis.signedDeltaMicroTesla,
        mad: analysis.mad,
        signalQuality: analysis.signalQuality,
        sensorSaturated: analysis.sensorSaturated,
        calibrationValid: analysis.calibrationValid,
        confidence: analysis.confidence,
        algorithmVersion: analysis.algorithmVersion,
        clientDataHash: hashClientData(req),
        source: 'magnetic-analyzer-server-v1',
      },
      createdAt: new Date(),
    });
  }

  const riskResult = calculateRisk({
    findings: severity !== 'info'
      ? [{
          id: observationId,
          module: 'magnetic',
          severity,
          title: buildMagneticTitle(analysis.state, analysis.signedDeltaMicroTesla),
          detail: analysis.explanation,
          evidence: { source: 'magnetic', captureTimestamp: req.clientTimestamp },
        }]
      : [],
    correlated: [],
    inspectionId: req.inspectionId,
  });

  return {
    observationId,
    inspectionId: req.inspectionId,
    verdict: 'clear', // magnetómetro no produce VisualVerdict
    riskContribution: riskResult,
    findings: severity !== 'info'
      ? [{
          id: observationId,
          module: 'magnetic',
          severity,
          title: buildMagneticTitle(analysis.state, analysis.signedDeltaMicroTesla),
          detail: analysis.explanation,
          evidence: { source: 'magnetic', captureTimestamp: serverTimestamp },
        }]
      : [],
    processedAt: serverTimestamp,
    algorithmVersion: analysis.algorithmVersion,
  };
}

// ── Análisis BLE ───────────────────────────────────────────────────────────────

export async function analyzeBleObservation(
  user: AppUser,
  req: SubmitBleObservationRequest,
): Promise<ObservationAnalysisResponse> {
  await validateInspectionOwnership(req.inspectionId, user);

  const observationId = randomUUID();
  const serverTimestamp = new Date().toISOString();
  const findings = [];

  for (const device of req.devices) {
    const classification = classifyBleDevice(device, {
      minRssiForProximity: DEFAULT_DETECTION_CONFIG.ble.minRssiForProximity,
      persistenceMinOccurrences: DEFAULT_DETECTION_CONFIG.ble.persistenceMinOccurrences,
    });

    // Solo reportar si requiere inspección o señal persistente — no reportar benignos
    if (
      classification.deviceClass === 'requires_inspection' ||
      classification.deviceClass === 'persistent_close_signal'
    ) {
      const findingId = randomUUID();
      const severity = classification.deviceClass === 'requires_inspection' ? 'suspicious' : 'info';

      await db.insert(scanFindings).values({
        id: findingId,
        sessionId: req.inspectionId,
        module: 'bluetooth',
        severity,
        title: `BLE: ${device.name ?? 'sin nombre'} — ${classification.deviceClass}`,
        detail: classification.explanation,
        evidence: {
          findingId,
          captureNonce: req.captureNonce,
          serverTimestamp,
          deviceClass: classification.deviceClass,
          confidence: classification.confidence,
          matchedSignature: classification.matchedSignature,
          anonymizedId: device.anonymizedId,
          rssi: device.rssi,
          occurrenceCount: device.occurrenceCount,
          signatureDbVersion: classification.signatureDbVersion,
          algorithmVersion: '1.0.0',
          source: 'ble-classifier-server-v1',
        },
        createdAt: new Date(),
      });

      findings.push({
        id: findingId,
        module: 'bluetooth' as const,
        severity: severity as 'suspicious' | 'info',
        title: `BLE: ${device.name ?? 'sin nombre'} — ${classification.deviceClass}`,
        detail: classification.explanation,
        evidence: { source: 'ble', captureTimestamp: serverTimestamp },
      });
    }
  }

  const riskResult = calculateRisk({
    findings,
    correlated: [],
    inspectionId: req.inspectionId,
  });

  return {
    observationId,
    inspectionId: req.inspectionId,
    verdict: 'clear',
    riskContribution: riskResult,
    findings,
    processedAt: serverTimestamp,
    algorithmVersion: '1.0.0',
  };
}

// ── Análisis de red ────────────────────────────────────────────────────────────

export async function analyzeNetworkObservation(
  user: AppUser,
  req: SubmitNetworkObservationRequest,
): Promise<ObservationAnalysisResponse> {
  await validateInspectionOwnership(req.inspectionId, user);

  const observationId = randomUUID();
  const serverTimestamp = new Date().toISOString();
  const findings = [];

  // Solo reportar servicios compatibles con cámaras — NO televisores, routers, etc.
  if (req.discoveredServices) {
    for (const svc of req.discoveredServices) {
      const isCameraCompatible = isCameraCompatibleService(svc);
      if (isCameraCompatible) {
        const findingId = randomUUID();
        await db.insert(scanFindings).values({
          id: findingId,
          sessionId: req.inspectionId,
          module: 'network',
          severity: 'suspicious',
          title: `Red: Interfaz compatible con cámara — ${svc.protocol.toUpperCase()} en ${svc.address}`,
          detail: `Servicio ${svc.protocol.toUpperCase()} en ${svc.address}${svc.port ? `:${svc.port}` : ''} compatible con cámara IP. Fabricante OUI: ${svc.ouiVendor ?? 'desconocido'}. Verifica físicamente el dispositivo.`,
          evidence: {
            findingId,
            captureNonce: req.captureNonce,
            serverTimestamp,
            protocol: svc.protocol,
            address: svc.address,
            port: svc.port,
            serviceType: svc.serviceType,
            ouiVendor: svc.ouiVendor,
            algorithmVersion: '1.0.0',
            source: 'network-analyzer-server-v1',
          },
          createdAt: new Date(),
        });

        findings.push({
          id: findingId,
          module: 'network' as const,
          severity: 'suspicious' as const,
          title: `Red: Interfaz compatible con cámara — ${svc.protocol.toUpperCase()}`,
          detail: `Servicio en ${svc.address} compatible con cámara IP.`,
          evidence: { source: 'network', captureTimestamp: serverTimestamp },
        });
      }
    }
  }

  const riskResult = calculateRisk({
    findings,
    correlated: [],
    inspectionId: req.inspectionId,
  });

  return {
    observationId,
    inspectionId: req.inspectionId,
    verdict: 'clear',
    riskContribution: riskResult,
    findings,
    processedAt: serverTimestamp,
    algorithmVersion: '1.0.0',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verifica en BD que la sesión exista y pertenezca al usuario autenticado.
 * Lanza UnauthorizedError si no existe o pertenece a otro usuario (IDOR guard).
 */
async function validateInspectionOwnership(
  inspectionId: string,
  user: AppUser,
): Promise<void> {
  if (!inspectionId || typeof inspectionId !== 'string') {
    throw new ValidationError('inspectionId inválido.');
  }
  const [session] = await db
    .select({ id: scanSessions.id, userOpenid: scanSessions.userOpenid })
    .from(scanSessions)
    .where(eq(scanSessions.id, inspectionId))
    .limit(1);

  if (!session) {
    // Return same error as unauthorized to avoid oracle attack
    throw new ValidationError('Sesión de inspección no encontrada.');
  }
  if (session.userOpenid !== user.openid) {
    throw new ValidationError('Sesión de inspección no encontrada.');
  }
}

function verdictToSeverity(verdict: string): 'info' | 'suspicious' | 'high' {
  switch (verdict) {
    case 'confirmed_device': return 'high';
    case 'suspected_device': return 'suspicious';
    // 'review_required' = ambiguous signal, NOT a detection — show as info only
    case 'review_required': return 'info';
    default: return 'info';
  }
}

/** Returns true only for verdicts that generate a reportable finding */
function isReportableVerdict(verdict: string): boolean {
  return verdict === 'confirmed_device' || verdict === 'suspected_device';
}

function magneticStateToSeverity(state: string): 'info' | 'suspicious' | 'high' {
  switch (state) {
    case 'magnetic_source_nearby':
    case 'repeatable_localized_source': return 'suspicious';
    case 'requires_verification': return 'info';
    default: return 'info';
  }
}

function buildOpticalTitle(verdict: string, category: string): string {
  const catMap: Record<string, string> = {
    lens: 'Posible lente',
    exposed_sensor: 'Posible sensor expuesto',
    led: 'LED detectado',
    glass: 'Vidrio/reflejo',
    unknown_reflective: 'Reflejo óptico',
  };
  const catLabel = catMap[category] ?? 'Objeto reflectivo';
  switch (verdict) {
    case 'confirmed_device': return `${catLabel} confirmado`;
    case 'suspected_device': return `${catLabel} — requiere corroboración`;
    case 'review_required': return `${catLabel} — revisión recomendada`;
    case 'insufficient_evidence': return 'Evidencia insuficiente — nueva captura requerida';
    default: return `Análisis óptico: ${catLabel}`;
  }
}

function buildMagneticTitle(state: string, delta: number): string {
  switch (state) {
    case 'magnetic_source_nearby':
      return `Fuente magnética cercana: +${delta.toFixed(1)} µT sobre baseline`;
    case 'repeatable_localized_source':
      return `Fuente magnética localizada repetible: +${delta.toFixed(1)} µT`;
    case 'ambient_variation':
      return `Variación ambiental del campo magnético: ${delta.toFixed(1)} µT`;
    case 'unstable_measurement':
      return 'Medición magnética inestable — sensor no confiable en este entorno';
    case 'calibration_invalid':
      return 'Calibración magnética inválida — insuficientes muestras';
    default:
      return 'Campo magnético normal';
  }
}

function isCameraCompatibleService(svc: { protocol: string; serviceType?: string; port?: number }): boolean {
  // Protocolos directamente compatibles con cámaras
  if (['onvif', 'rtsp'].includes(svc.protocol)) return true;
  // Puertos típicos de cámaras IP
  if (svc.port && [554, 8554, 10554, 34567, 8080].includes(svc.port)) return true;
  // ServiceType que indique cámara
  if (svc.serviceType?.toLowerCase().includes('camera')) return true;
  if (svc.serviceType?.toLowerCase().includes('nvr')) return true;
  if (svc.serviceType?.toLowerCase().includes('dvr')) return true;
  return false;
}

function hashClientData(data: object): string {
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 16);
}


