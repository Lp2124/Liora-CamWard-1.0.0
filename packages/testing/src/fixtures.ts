/**
 * @liora/testing — Fixtures para evaluación de falsos positivos
 *
 * Fase 15: Framework de pruebas reproducible.
 * Los datos son NO sensibles — no incluyen fotos reales ni coordenadas.
 *
 * Métricas objetivo:
 *  - False Positive Rate (FPR)
 *  - False Negative Rate (FNR)
 *  - Precision, Recall, F1
 *  - Sensitivity, Specificity
 *
 * Versión: 1.0.0
 */

import type { OpticalClusterData, MagneticSample, BleDeviceObservation } from '@liora/contracts';

// ── ESCENARIOS NEGATIVOS (no son cámaras) ────────────────────────────────────

export const NEGATIVE_FIXTURES = {
  /** Tornillo cromado — alto brillo, alta compacidad, pero sin persistencia de lente */
  chrome_screw: {
    description: 'Tornillo cromado en pared',
    clusters: [{
      persistedFrames: 8,
      relativeX: 45,
      relativeY: 50,
      clusterSizePx: 12,
      compactness: 0.85,
      maxBrightness: 248,
      saturation: 0.08,  // neutro → podría confundirse con lente
    }] satisfies OpticalClusterData[],
    expectedVerdict: 'review_required' as const,
    // La segunda captura y análisis diferencial deben distinguirlo
    withDifferentialDelta: 5, // delta pequeño = no es lente
    expectedWithDifferential: 'clear' as const,
  },

  /** LED de cargador — alta saturación (rojo/verde) */
  charger_led: {
    description: 'LED de cargador USB',
    clusters: [{
      persistedFrames: 20,
      relativeX: 30,
      relativeY: 60,
      clusterSizePx: 6,
      compactness: 0.90,
      maxBrightness: 245,
      saturation: 0.72, // alto → es LED de color, NO lente
    }] satisfies OpticalClusterData[],
    expectedVerdict: 'clear' as const,
  },

  /** Gota de agua — forma irregular */
  water_drop: {
    description: 'Gota de agua en superficie',
    clusters: [{
      persistedFrames: 3,
      relativeX: 50,
      relativeY: 40,
      clusterSizePx: 45,
      compactness: 0.25, // baja compacidad → no es circular
      maxBrightness: 242,
      saturation: 0.10,
    }] satisfies OpticalClusterData[],
    expectedVerdict: 'clear' as const,
  },

  /** Espejo en pared — cluster muy grande */
  wall_mirror: {
    description: 'Reflejo en espejo de pared',
    clusters: [{
      persistedFrames: 30,
      relativeX: 50,
      relativeY: 50,
      clusterSizePx: 520, // demasiado grande → ventana/espejo
      compactness: 0.65,
      maxBrightness: 250,
      saturation: 0.05,
    }] satisfies OpticalClusterData[],
    expectedVerdict: 'clear' as const,
  },

  /** Magnetómetro: cargador en pared */
  charger_magnetic: {
    description: 'Cargador de laptop en pared',
    samples: generateMagneticSamples({
      baseline: 48,
      delta: 35,     // eleva el campo
      noiseMad: 3,
      count: 30,
    }),
    // El magnetómetro SOLO es evidencia secundaria — sin corroboración óptica
    // no debe producir hallazgo high
    expectedState: 'magnetic_source_nearby' as const,
    expectedSeverity: 'suspicious' as const, // no 'high'
    expectedShouldNotCorroborate: true,
  },

  /** BLE: televisor Samsung */
  samsung_tv_ble: {
    description: 'Smart TV Samsung en la habitación',
    device: {
      anonymizedId: 'ble_samsung_test',
      name: 'Samsung TV 65"',
      rssi: -55,
      occurrenceCount: 8,
      firstSeenTs: Date.now() - 10000,
      lastSeenTs: Date.now(),
    } satisfies BleDeviceObservation,
    expectedClass: 'known_benign' as const,
  },

  /** BLE: auriculares AirPods */
  airpods_ble: {
    description: 'AirPods Pro',
    device: {
      anonymizedId: 'ble_airpods_test',
      name: 'AirPods Pro',
      rssi: -42,
      occurrenceCount: 15,
      firstSeenTs: Date.now() - 20000,
      lastSeenTs: Date.now(),
    } satisfies BleDeviceObservation,
    expectedClass: 'known_benign' as const,
  },

  /** BLE: 'escam' en nombre de una cafetería — falso positivo de palabra */
  escam_false: {
    description: '"Escambia Coffee" — nombre con "escam" pero NO es cámara',
    device: {
      anonymizedId: 'ble_escam_test',
      name: 'Escambia Coffee WiFi',
      rssi: -80,
      occurrenceCount: 1,
      firstSeenTs: Date.now(),
      lastSeenTs: Date.now(),
    } satisfies BleDeviceObservation,
    // Esto prueba que la coincidencia de keyword NO es suficiente sin RSSI/persistencia
    note: 'keyword match pero RSSI -80 y 1 sola aparición → multimedia_compatible, no requires_inspection',
  },
} as const;

// ── ESCENARIOS POSITIVOS (sí son cámaras) ────────────────────────────────────

export const POSITIVE_FIXTURES = {
  /** Cámara WiFi oculta en objeto decorativo */
  wifi_camera_optical: {
    description: 'Cámara WiFi con lente expuesta iluminada por torch',
    clusters: [{
      persistedFrames: 12,
      relativeX: 42,
      relativeY: 38,
      clusterSizePx: 8,
      compactness: 0.82,
      maxBrightness: 252,
      saturation: 0.06,
    }] satisfies OpticalClusterData[],
    withDifferentialDelta: 65, // alto delta = lente real
    expectedVerdict: 'suspected_device' as const,
  },

  /** Cámara BLE — nombre de firmware v380 */
  ble_camera_v380: {
    description: 'Cámara con firmware V380 Pro',
    device: {
      anonymizedId: 'ble_v380_test',
      name: 'V380 Pro',
      rssi: -48,
      occurrenceCount: 6,
      firstSeenTs: Date.now() - 8000,
      lastSeenTs: Date.now(),
    } satisfies BleDeviceObservation,
    expectedClass: 'requires_inspection' as const,
  },

  /** Cámara con motor — anomalía magnética persistente */
  camera_with_motor: {
    description: 'Cámara PTZ con motor — genera campo magnético',
    samples: generateMagneticSamples({
      baseline: 50,
      delta: 42,
      noiseMad: 2,
      count: 40,
    }),
    expectedState: 'magnetic_source_nearby' as const,
  },
} as const;

// ── Métricas de evaluación (pendiente de campaña física) ─────────────────────

export interface EvaluationMetrics {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;          // TP / (TP + FP)
  recall: number;             // TP / (TP + FN) = sensitivity
  f1: number;                 // 2 * P * R / (P + R)
  specificity: number;        // TN / (TN + FP)
  fpr: number;                // FP / (FP + TN) = 1 - specificity
  fnr: number;                // FN / (FN + TP) = 1 - recall
  confidence95Lower: number;  // IC 95% inferior
  confidence95Upper: number;  // IC 95% superior
  status: 'pending_physical_campaign' | 'completed';
  note: string;
}

export function computeMetrics(
  tp: number,
  fp: number,
  tn: number,
  fn: number,
): EvaluationMetrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const n = tp + fp + tn + fn;

  // Wilson interval para IC 95%
  const p = n > 0 ? (tp + tn) / n : 0;
  const z = 1.96;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const halfWidth = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;

  return {
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    specificity: Number(specificity.toFixed(4)),
    fpr: Number((1 - specificity).toFixed(4)),
    fnr: Number((1 - recall).toFixed(4)),
    confidence95Lower: Number(Math.max(0, center - halfWidth).toFixed(4)),
    confidence95Upper: Number(Math.min(1, center + halfWidth).toFixed(4)),
    status: 'pending_physical_campaign',
    note: 'Métricas no disponibles hasta ejecutar campaña física con dispositivos reales. ' +
      'Usa las herramientas de evaluación en packages/testing para ejecutar la campaña.',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateMagneticSamples(opts: {
  baseline: number;
  delta: number;
  noiseMad: number;
  count: number;
}): MagneticSample[] {
  const samples: MagneticSample[] = [];
  for (let i = 0; i < opts.count; i++) {
    const noise = (Math.random() - 0.5) * opts.noiseMad * 2;
    const magnitude = i < opts.count * 0.4
      ? opts.baseline + noise              // fase de baseline
      : opts.baseline + opts.delta + noise; // fase con fuente

    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.5) * Math.PI;
    samples.push({
      x: magnitude * Math.cos(angle) * Math.cos(elevation),
      y: magnitude * Math.sin(angle) * Math.cos(elevation),
      z: magnitude * Math.sin(elevation),
      magnitude,
      ts: i * 100,
    });
  }
  return samples;
}
