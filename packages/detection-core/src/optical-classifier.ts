/**
 * @liora/detection-core — OpticalClassifier (SERVER-SIDE)
 *
 * Clasificador visual con estados explícitos VisualVerdict.
 * NUNCA convierte ambigüedad en "ANOMALÍA DETECTADA".
 *
 * Pipeline:
 *  1. Validar calidad de imagen (blur, exposición)
 *  2. Evaluar clusters por umbrales configurables
 *  3. Verificar segunda captura
 *  4. Asignar VisualVerdict
 *  5. Calcular confidence score calibrado
 *
 * Versión: 1.0.0
 */

import type { VisualVerdict, BoundingBox, LensCategory, ConfidenceScore } from '@liora/contracts';
import type { OpticalClusterData } from '@liora/contracts';
import type { DetectionConfig } from './detection-config';
import { DEFAULT_DETECTION_CONFIG } from './detection-config';

export interface OpticalClassificationInput {
  clusters: OpticalClusterData[];
  captureMode: 'normal' | 'torch_off' | 'torch_on';
  brightnessEstimate: number;
  torchActive: boolean;
  frameCount: number;
  hasSecondCapture: boolean;
  differentialDelta?: number;   // diferencia con captura anterior del mismo punto
}

export interface OpticalClassificationResult {
  verdict: VisualVerdict;
  confidence: ConfidenceScore;
  category: LensCategory;
  boundingBoxes: BoundingBox[];
  explanation: string;
  imageQualityOk: boolean;
  blurDetected: boolean;
  overexposed: boolean;
  algorithmVersion: string;
}

export function classifyOpticalObservation(
  input: OpticalClassificationInput,
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): OpticalClassificationResult {
  const cfg = config.optical;

  // ── Calidad de imagen ─────────────────────────────────────────────────────
  const overexposed = input.brightnessEstimate > cfg.overexposureThreshold;
  const blurDetected = input.frameCount < cfg.minFramesForQuality;
  const imageQualityOk = !overexposed && !blurDetected;

  if (!imageQualityOk) {
    return {
      verdict: 'insufficient_evidence',
      confidence: { value: 0, threshold: cfg.confidenceThreshold, meetsThreshold: false, algorithmVersion: '1.0.0' },
      category: 'unknown_reflective',
      boundingBoxes: [],
      explanation: overexposed
        ? 'Imagen sobreexpuesta — imposible analizar. Reduce la exposición o apaga la linterna.'
        : `Solo ${input.frameCount} frames disponibles — mínimo ${cfg.minFramesForQuality} requerido para análisis confiable.`,
      imageQualityOk: false,
      blurDetected,
      overexposed,
      algorithmVersion: '1.0.0',
    };
  }

  // ── Clusters válidos según umbrales configurables ─────────────────────────
  const validClusters = input.clusters.filter((c) => {
    // Solo contar clusters que persisten los frames mínimos requeridos
    if (c.persistedFrames < cfg.persistFramesRequired) return false;
    // Tamaño mínimo y máximo
    if (c.clusterSizePx < cfg.minClusterPx) return false;
    if (c.clusterSizePx > cfg.maxClusterPx) return false;
    // Compacidad (circularidad)
    if (c.compactness < cfg.compactnessMin) return false;
    // Saturación (blanco = lente, coloreado = LED)
    if (c.saturation > cfg.maxSaturation) return false;
    // Brillo mínimo
    if (c.maxBrightness < cfg.brightnessThreshold) return false;
    return true;
  });

  if (validClusters.length === 0) {
    return {
      verdict: 'clear',
      confidence: { value: 0.95, threshold: cfg.confidenceThreshold, meetsThreshold: true, algorithmVersion: '1.0.0' },
      category: 'unknown_reflective',
      boundingBoxes: [],
      explanation: 'No se encontraron clusters que cumplan todos los criterios ópticos. Área analizada sin hallazgos.',
      imageQualityOk: true,
      blurDetected: false,
      overexposed: false,
      algorithmVersion: '1.0.0',
    };
  }

  // ── Clasificar tipo más probable ──────────────────────────────────────────
  const primaryCluster = validClusters.sort((a, b) => b.persistedFrames - a.persistedFrames)[0];
  const category = classifyCategory(primaryCluster, input.torchActive);

  // ── Confidence score calibrado ────────────────────────────────────────────
  const rawConfidence = computeConfidence(primaryCluster, input, cfg);

  // ── Verificar análisis diferencial ───────────────────────────────────────
  let differentialPassed = false;
  if (input.differentialDelta !== undefined) {
    // Un reflejo de lente varía significativamente entre torch_off y torch_on
    differentialPassed = Math.abs(input.differentialDelta) >= cfg.differentialMinDelta;
  }

  // ── Asignar VisualVerdict ─────────────────────────────────────────────────
  const verdict = assignVerdict(
    rawConfidence,
    cfg.confidenceThreshold,
    input.hasSecondCapture,
    differentialPassed,
    category,
  );

  const bboxes: BoundingBox[] = validClusters.map((c) => ({
    x: Math.max(0, c.relativeX / 100 - 0.05),
    y: Math.max(0, c.relativeY / 100 - 0.05),
    width: Math.min(0.1, (c.clusterSizePx / 160) * 2),
    height: Math.min(0.1, (c.clusterSizePx / 120) * 2),
  }));

  return {
    verdict,
    confidence: {
      value: rawConfidence,
      threshold: cfg.confidenceThreshold,
      meetsThreshold: rawConfidence >= cfg.confidenceThreshold,
      algorithmVersion: '1.0.0',
    },
    category,
    boundingBoxes: bboxes,
    explanation: buildVerdictExplanation(verdict, category, rawConfidence, primaryCluster, differentialPassed),
    imageQualityOk: true,
    blurDetected: false,
    overexposed: false,
    algorithmVersion: '1.0.0',
  };
}

function computeConfidence(
  cluster: OpticalClusterData,
  input: OpticalClassificationInput,
  cfg: DetectionConfig['optical'],
): number {
  let conf = 0.3; // base

  // Persistencia: más frames = más confianza
  const persistRatio = Math.min(1, cluster.persistedFrames / (cfg.persistFramesRequired * 2));
  conf += 0.25 * persistRatio;

  // Compacidad: más redondo = más parecido a lente
  conf += 0.20 * Math.min(1, cluster.compactness / 0.9);

  // Brillo con torch activo
  if (input.torchActive && cluster.maxBrightness > 240) conf += 0.15;

  // Baja saturación (blanco puro)
  conf += 0.10 * (1 - cluster.saturation / cfg.maxSaturation);

  // Análisis diferencial
  if (input.differentialDelta !== undefined &&
      Math.abs(input.differentialDelta) >= cfg.differentialMinDelta) {
    conf += 0.10;
  }

  return Math.min(1.0, conf);
}

function classifyCategory(
  cluster: OpticalClusterData,
  torchActive: boolean,
): LensCategory {
  // Alta saturación = LED de color
  if (cluster.saturation > 0.5) return 'led';
  // Muy grande = vidrio o espejo
  if (cluster.clusterSizePx > 200) return 'glass';
  // Muy compacto + blanco + torch = posible lente
  if (cluster.compactness > 0.7 && cluster.saturation < 0.15 && torchActive) return 'lens';
  // Compacto moderado
  if (cluster.compactness > 0.5) return 'chrome_metal';
  return 'unknown_reflective';
}

function assignVerdict(
  confidence: number,
  threshold: number,
  hasSecondCapture: boolean,
  differentialPassed: boolean,
  category: LensCategory,
): VisualVerdict {
  // Solo 'lens' y 'exposed_sensor' pueden elevar a suspected/confirmed
  const isCameraCompatible = category === 'lens' || category === 'exposed_sensor';

  if (!isCameraCompatible) {
    return confidence > 0.6 ? 'review_required' : 'clear';
  }

  if (confidence < threshold * 0.5) {
    return 'insufficient_evidence';
  }

  if (confidence < threshold) {
    return 'review_required';
  }

  // confidence >= threshold
  if (!hasSecondCapture) {
    // Sin segunda captura, no podemos confirmar
    return 'review_required';
  }

  if (!differentialPassed) {
    return 'suspected_device';
  }

  // Segunda captura + análisis diferencial positivo = suspected_device
  // confirmed_device requiere corroboración de red o BLE (se hace en el motor de correlación)
  return 'suspected_device';
}

function buildVerdictExplanation(
  verdict: VisualVerdict,
  category: LensCategory,
  confidence: number,
  cluster: OpticalClusterData,
  differential: boolean,
): string {
  const confPct = Math.round(confidence * 100);
  const base = `Cluster óptico: ${cluster.clusterSizePx}px, compacidad ${cluster.compactness.toFixed(2)}, brillo ${cluster.maxBrightness}/255, sat ${cluster.saturation.toFixed(2)}. Categoría inferida: ${category}. Confianza: ${confPct}%.`;

  switch (verdict) {
    case 'clear': return `${base} Sin señales compatibles con cámara oculta.`;
    case 'insufficient_evidence': return `${base} Evidencia insuficiente — realiza nueva captura con mejor iluminación.`;
    case 'review_required': return `${base} Requiere revisión — el patrón es observable pero no cumple todos los criterios de sospecha.`;
    case 'suspected_device': return `${base} Patrón compatible con posible dispositivo óptico. ${differential ? 'Análisis diferencial confirma reflejo variable con ángulo.' : ''} Corrobora con escaneo BLE y red.`;
    case 'confirmed_device': return `${base} Múltiples evidencias coherentes confirman dispositivo óptico. Inspección física recomendada.`;
  }
}
