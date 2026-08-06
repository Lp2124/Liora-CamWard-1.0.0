/**
 * @liora/contracts — VisualVerdict
 *
 * Estados explícitos del sistema de clasificación visual.
 * NUNCA convertir una respuesta ambigua en "ANOMALÍA DETECTADA".
 *
 * Reglas de transición:
 *  clear               → no crear hallazgo
 *  insufficient_evidence → solicitar nueva captura
 *  review_required     → observación informativa, NO alerta de riesgo
 *  suspected_device    → hallazgo pendiente de corroboración (requiere 2ª captura)
 *  confirmed_device    → solo cuando hay evidencias múltiples e independientes consistentes
 */
export type VisualVerdict =
  | 'clear'
  | 'insufficient_evidence'
  | 'review_required'
  | 'suspected_device'
  | 'confirmed_device';

/** Requisitos mínimos para elevar a suspected_device */
export interface SuspectedDeviceEvidence {
  confidenceScore: number;       // ≥ threshold configurable
  regionBoundingBox: BoundingBox;
  category: LensCategory;
  featureExplanation: string;    // rasgos observables específicos
  imageQualityOk: boolean;       // sin blur severo ni sobreexposición
  hasSecondCapture: boolean;     // captura desde otro ángulo
  capturesConsistent: boolean;   // ambas capturas coherentes
}

/** Requisitos adicionales para elevar a confirmed_device */
export interface ConfirmedDeviceEvidence extends SuspectedDeviceEvidence {
  repeatedVisualMatch: boolean;
  hasNetworkCorroboration: boolean;    // dispositivo compatible en red
  hasBleCorroboration: boolean;        // señal BLE compatible
  hasManualValidation: boolean;        // inspección manual positiva
  hasCloseUpCapture: boolean;          // muestra componentes físicos
}

export interface BoundingBox {
  x: number;      // relativo 0-1
  y: number;
  width: number;
  height: number;
}

/** Categorías de objetos que el sistema puede distinguir */
export type LensCategory =
  | 'screw'
  | 'led'
  | 'glass'
  | 'bright_plastic'
  | 'water_drop'
  | 'chrome_metal'
  | 'ceramic'
  | 'mirror'
  | 'lens'
  | 'exposed_sensor'
  | 'unknown_reflective';

/** Nivel de confianza del score visual */
export interface ConfidenceScore {
  value: number;        // 0.0 – 1.0
  threshold: number;    // umbral configurable usado
  meetsThreshold: boolean;
  algorithmVersion: string;
}
