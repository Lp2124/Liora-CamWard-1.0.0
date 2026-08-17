/**
 * @liora/detection-core — OpticalClassifier (SERVER-SIDE)
 *
 * The client provides measured optical observations. The server owns verdict,
 * severity, confidence and risk decisions.
 */
import type {
  VisualVerdict,
  BoundingBox,
  LensCategory,
  ConfidenceScore,
  OpticalClusterData,
} from '@liora/contracts';
import type { DetectionConfig } from './detection-config';
import { DEFAULT_DETECTION_CONFIG } from './detection-config';

export interface OpticalClassificationInput {
  clusters: OpticalClusterData[];
  captureMode: 'normal' | 'torch_off' | 'torch_on';
  brightnessEstimate: number;
  torchActive: boolean;
  frameCount: number;
  hasSecondCapture: boolean;
  differentialDelta?: number;
  overexposedRatio?: number;
  sharpnessVariance?: number;
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
  const overexposedRatio = input.overexposedRatio ?? input.brightnessEstimate / 255;
  const overexposed = overexposedRatio >= cfg.overexposureThreshold;
  const insufficientFrames = input.frameCount < cfg.minFramesForQuality;
  const blurDetected =
    input.sharpnessVariance !== undefined &&
    input.sharpnessVariance < cfg.minSharpnessVariance;
  const imageQualityOk = !overexposed && !insufficientFrames && !blurDetected;

  if (!imageQualityOk) {
    const explanation = overexposed
      ? `Proporción sobreexpuesta ${(overexposedRatio * 100).toFixed(1)}%; repite la captura con menos luz directa.`
      : insufficientFrames
        ? `Se recibieron ${input.frameCount} frames; se requieren al menos ${cfg.minFramesForQuality} para evaluar persistencia.`
        : `Nitidez insuficiente para este análisis (varianza ${input.sharpnessVariance?.toFixed(2) ?? 'N/D'}).`;
    return {
      verdict: 'insufficient_evidence',
      confidence: score(0, cfg.confidenceThreshold),
      category: 'unknown_reflective',
      boundingBoxes: [],
      explanation,
      imageQualityOk: false,
      blurDetected,
      overexposed,
      algorithmVersion: '1.1.1',
    };
  }

  const validClusters = input.clusters.filter((cluster) =>
    cluster.persistedFrames >= cfg.persistFramesRequired &&
    cluster.clusterSizePx >= cfg.minClusterPx &&
    cluster.clusterSizePx <= cfg.maxClusterPx &&
    cluster.compactness >= cfg.compactnessMin &&
    cluster.saturation <= cfg.maxSaturation &&
    cluster.maxBrightness >= cfg.brightnessThreshold,
  );

  if (validClusters.length === 0) {
    return {
      verdict: 'clear',
      confidence: score(0, cfg.confidenceThreshold),
      category: 'unknown_reflective',
      boundingBoxes: [],
      explanation:
        'En las capturas procesadas no hubo un cluster que cumpliera simultáneamente persistencia, tamaño, compacidad, brillo y saturación. Este resultado no descarta dispositivos fuera del campo, sensibilidad o condiciones evaluadas.',
      imageQualityOk: true,
      blurDetected: false,
      overexposed: false,
      algorithmVersion: '1.1.1',
    };
  }

  const primaryCluster = [...validClusters].sort(
    (a, b) => b.persistedFrames - a.persistedFrames,
  )[0];
  const category = classifyCategory(primaryCluster, input.torchActive);
  const rawConfidence = computeConfidence(primaryCluster, input, cfg);
  const differentialPassed =
    input.differentialDelta !== undefined &&
    input.differentialDelta >= cfg.differentialMinDelta;
  const verdict = assignVerdict(
    rawConfidence,
    cfg.confidenceThreshold,
    input.hasSecondCapture,
    differentialPassed,
    category,
  );

  return {
    verdict,
    confidence: score(rawConfidence, cfg.confidenceThreshold),
    category,
    boundingBoxes: [],
    explanation: buildVerdictExplanation(
      verdict,
      category,
      rawConfidence,
      primaryCluster,
      differentialPassed,
    ),
    imageQualityOk: true,
    blurDetected: false,
    overexposed: false,
    algorithmVersion: '1.1.1',
  };
}

function score(value: number, threshold: number): ConfidenceScore {
  return {
    value,
    threshold,
    meetsThreshold: value >= threshold,
    algorithmVersion: '1.1.1',
  };
}

function computeConfidence(
  cluster: OpticalClusterData,
  input: OpticalClassificationInput,
  cfg: DetectionConfig['optical'],
): number {
  let confidence = 0.3;
  const persistRatio = Math.min(1, cluster.persistedFrames / (cfg.persistFramesRequired * 2));
  confidence += 0.25 * persistRatio;
  confidence += 0.20 * Math.min(1, cluster.compactness / 0.9);
  if (input.torchActive && cluster.maxBrightness > cfg.brightnessThreshold) confidence += 0.15;
  confidence += 0.10 * Math.max(0, 1 - cluster.saturation / cfg.maxSaturation);
  if (
    input.differentialDelta !== undefined &&
    input.differentialDelta >= cfg.differentialMinDelta
  ) {
    confidence += 0.10;
  }
  return Math.min(1, confidence);
}

function classifyCategory(
  cluster: OpticalClusterData,
  torchActive: boolean,
): LensCategory {
  if (cluster.saturation > 0.5) return 'led';
  if (cluster.clusterSizePx > 200) return 'glass';
  if (cluster.compactness > 0.7 && cluster.saturation < 0.15 && torchActive) return 'lens';
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
  const cameraCompatible = category === 'lens' || category === 'exposed_sensor';
  if (!cameraCompatible) return confidence > 0.6 ? 'review_required' : 'clear';
  if (confidence < threshold * 0.5) return 'insufficient_evidence';
  if (confidence < threshold) return 'review_required';
  if (!hasSecondCapture || !differentialPassed) return 'review_required';
  return 'suspected_device';
}

function buildVerdictExplanation(
  verdict: VisualVerdict,
  category: LensCategory,
  confidence: number,
  cluster: OpticalClusterData,
  differentialPassed: boolean,
): string {
  const confidencePercent = Math.round(confidence * 100);
  const base =
    `Cluster observado: ${cluster.clusterSizePx}px, compacidad ${cluster.compactness.toFixed(2)}, ` +
    `brillo ${cluster.maxBrightness.toFixed(1)}/255, saturación ${cluster.saturation.toFixed(2)}, ` +
    `persistencia ${cluster.persistedFrames} frames. Categoría inferida: ${category}. ` +
    `Score de compatibilidad: ${confidencePercent}%.`;

  switch (verdict) {
    case 'clear':
      return `${base} El patrón medido no alcanzó los criterios de revisión óptica; esto no descarta otros dispositivos o ubicaciones.`;
    case 'insufficient_evidence':
      return `${base} La evidencia medida no es suficiente para elevar el patrón.`;
    case 'review_required':
      return `${base} El patrón requiere revisión y una inspección física o corroboración independiente.`;
    case 'suspected_device':
      return `${base} El patrón es compatible con un reflector óptico pequeño y persistente. ${
        differentialPassed
          ? 'Se observó un aumento de brillo OFF→ON por encima del umbral configurado.'
          : ''
      } Corrobora con otra modalidad y verifica físicamente.`;
    case 'confirmed_device':
      return `${base} Este clasificador óptico no confirma por sí solo un dispositivo; la confirmación requiere correlación independiente.`;
  }
}
