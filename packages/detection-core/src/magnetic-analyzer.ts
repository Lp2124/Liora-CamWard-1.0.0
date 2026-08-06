/**
 * @liora/detection-core — MagneticAnalyzer (SERVER-SIDE)
 *
 * Análisis diferencial de campo magnético con calibración robusta.
 * NUNCA alerta basado en una sola lectura absoluta.
 * El magnetómetro SOLO aporta evidencia secundaria.
 *
 * Estados de salida:
 *  normal_field | ambient_variation | magnetic_source_nearby |
 *  unstable_measurement | requires_verification | repeatable_localized_source
 *
 * Versión: 1.0.0
 */

import type { MagneticSample } from '@liora/contracts';

export type MagneticState =
  | 'normal_field'
  | 'ambient_variation'
  | 'magnetic_source_nearby'
  | 'unstable_measurement'
  | 'requires_verification'
  | 'repeatable_localized_source'
  | 'calibration_invalid';

export interface MagneticAnalysisResult {
  state: MagneticState;
  confidence: number;
  baselineMicroTesla: number;
  currentMicroTesla: number;
  signedDeltaMicroTesla: number;
  mad: number;                    // Median Absolute Deviation
  signalQuality: number;          // 0-1
  sensorSaturated: boolean;
  calibrationValid: boolean;
  explanation: string;
  algorithmVersion: string;
}

export interface MagneticAnalysisConfig {
  baselineSampleMs: number;
  anomalyDeltaUt: number;
  anomalyConfirmCount: number;
  madMultiplier: number;
  saturationThreshold: number;
  minCalibrationSamples: number;
}

const DEFAULT_CONFIG: MagneticAnalysisConfig = {
  baselineSampleMs: 3000,
  anomalyDeltaUt: 25,
  anomalyConfirmCount: 3,
  madMultiplier: 3.5,
  saturationThreshold: 400,
  minCalibrationSamples: 10,
};

export function analyzeMagneticObservation(
  samples: MagneticSample[],
  config: MagneticAnalysisConfig = DEFAULT_CONFIG,
): MagneticAnalysisResult {
  if (samples.length < config.minCalibrationSamples) {
    return {
      state: 'calibration_invalid',
      confidence: 0,
      baselineMicroTesla: 0,
      currentMicroTesla: 0,
      signedDeltaMicroTesla: 0,
      mad: 0,
      signalQuality: 0,
      sensorSaturated: false,
      calibrationValid: false,
      explanation: `Solo ${samples.length} muestras disponibles. Mínimo ${config.minCalibrationSamples} requeridas para calibración válida.`,
      algorithmVersion: '1.0.0',
    };
  }

  const magnitudes = samples.map((s) => s.magnitude);

  // ── Baseline mediante mediana ─────────────────────────────────────────────
  const sorted = [...magnitudes].sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length / 2)];

  // ── MAD (Median Absolute Deviation) ──────────────────────────────────────
  const deviations = sorted.map((v) => Math.abs(v - baseline));
  const madSorted = [...deviations].sort((a, b) => a - b);
  const mad = madSorted[Math.floor(madSorted.length / 2)];

  // ── Detección de saturación ───────────────────────────────────────────────
  const maxMagnitude = Math.max(...magnitudes);
  const sensorSaturated = maxMagnitude > config.saturationThreshold;

  if (sensorSaturated) {
    return {
      state: 'unstable_measurement',
      confidence: 0,
      baselineMicroTesla: baseline,
      currentMicroTesla: magnitudes[magnitudes.length - 1],
      signedDeltaMicroTesla: 0,
      mad,
      signalQuality: 0,
      sensorSaturated: true,
      calibrationValid: false,
      explanation: `Sensor saturado (${maxMagnitude.toFixed(0)} µT > ${config.saturationThreshold} µT). Las lecturas no son confiables.`,
      algorithmVersion: '1.0.0',
    };
  }

  // ── Señal de calidad ─────────────────────────────────────────────────────
  // MAD bajo = señal estable, MAD alto = señal ruidosa
  const signalQuality = Math.max(0, 1 - (mad / (baseline * 0.2)));

  // ── Umbral adaptativo: mediana + MAD * multiplier ─────────────────────────
  const adaptiveThreshold = Math.max(
    config.anomalyDeltaUt,
    mad * config.madMultiplier,
  );

  // ── Analizar últimas muestras (ventana deslizante) ────────────────────────
  const windowSize = Math.min(config.anomalyConfirmCount, samples.length);
  const recentSamples = samples.slice(-windowSize);
  const recentMagnitudes = recentSamples.map((s) => s.magnitude);
  const recentMean = recentMagnitudes.reduce((a, b) => a + b, 0) / recentMagnitudes.length;
  const signedDelta = recentMean - baseline;

  const currentMagnitude = magnitudes[magnitudes.length - 1];

  // ── Determinar estado ─────────────────────────────────────────────────────
  let state: MagneticState;
  let confidence: number;
  let explanation: string;

  if (signalQuality < 0.3) {
    state = 'unstable_measurement';
    confidence = 0.1;
    explanation = `Señal magnética inestable (MAD=${mad.toFixed(1)} µT, calidad=${(signalQuality * 100).toFixed(0)}%). Las lecturas pueden ser ruido ambiental.`;
  } else if (Math.abs(signedDelta) <= adaptiveThreshold * 0.3) {
    state = 'normal_field';
    confidence = 0.9;
    explanation = `Campo magnético normal. Baseline: ${baseline.toFixed(1)} µT. Delta reciente: ${signedDelta.toFixed(1)} µT (dentro del umbral adaptativo de ±${adaptiveThreshold.toFixed(1)} µT).`;
  } else if (Math.abs(signedDelta) <= adaptiveThreshold) {
    state = 'ambient_variation';
    confidence = 0.5;
    explanation = `Variación ambiental. Delta: ${signedDelta.toFixed(1)} µT. Puede ser mobiliario, estructura metálica o movimiento del teléfono.`;
  } else if (signedDelta > adaptiveThreshold) {
    state = 'magnetic_source_nearby';
    confidence = 0.65;
    explanation = `Fuente magnética detectada. Delta: +${signedDelta.toFixed(1)} µT sobre baseline (umbral: +${adaptiveThreshold.toFixed(1)} µT). Compatible con: transformador, bobina de carga, motor. NOTA: el magnetómetro solo aporta evidencia secundaria — corrobora visualmente.`;
  } else {
    state = 'requires_verification';
    confidence = 0.3;
    explanation = `Variación negativa inusual: ${signedDelta.toFixed(1)} µT. Requiere verificación.`;
  }

  return {
    state,
    confidence,
    baselineMicroTesla: Number(baseline.toFixed(1)),
    currentMicroTesla: Number(currentMagnitude.toFixed(1)),
    signedDeltaMicroTesla: Number(signedDelta.toFixed(1)),
    mad: Number(mad.toFixed(2)),
    signalQuality: Number(signalQuality.toFixed(3)),
    sensorSaturated: false,
    calibrationValid: true,
    explanation,
    algorithmVersion: '1.0.0',
  };
}
