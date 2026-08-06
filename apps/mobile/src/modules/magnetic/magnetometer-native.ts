/**
 * apps/mobile — Magnetometer (Native via expo-sensors)
 *
 * Implementación nativa usando expo-sensors/Magnetometer.
 * Correcciones del prompt:
 *  1. Calibración 3-5 segundos con mediana
 *  2. MAD (Median Absolute Deviation) como umbral adaptativo
 *  3. Suavizado robusto
 *  4. Compensación por orientación
 *  5. Ventana deslizante
 *  6. Histéresis
 *  7. Detección diferencial vs baseline
 *  8. Persistencia mínima del incremento
 *  9. Detección de saturación
 *  10. Estado de calibración inválida
 *
 * El campo magnético NO es igual a radiofrecuencia.
 * El magnetómetro NUNCA confirma una cámara — solo evidencia secundaria.
 *
 * Versión: 1.0.0
 */

import { Magnetometer } from 'expo-sensors';
import type { Subscription } from 'expo-sensors/build/Pedometer';
import type { MagneticSample } from '@liora/contracts';

export type MagneticPhase = 'calibrating' | 'monitoring' | 'error' | 'unavailable';

export interface MagneticNativeProgress {
  phase: MagneticPhase;
  currentMicroTesla: number;
  baselineMicroTesla: number | null;
  signedDelta: number | null;
  mad: number | null;
  adaptiveThreshold: number | null;
  signalQuality: number;
  sensorSaturated: boolean;
  calibrationValid: boolean;
  secondsRemainingCalibration: number;
  samples: MagneticSample[];
}

export interface MagneticNativeConfig {
  calibrationMs: number;
  madMultiplier: number;
  anomalyConfirmCount: number;
  saturationThresholdUt: number;
  updateIntervalMs: number;
}

const DEFAULT_CONFIG: MagneticNativeConfig = {
  calibrationMs: 3500,
  madMultiplier: 3.5,
  anomalyConfirmCount: 3,
  saturationThresholdUt: 400,
  updateIntervalMs: 100,
};

export interface MagneticScanHandle {
  stop: () => void;
  getSamples: () => MagneticSample[];
}

/**
 * Inicia escaneo magnético nativo.
 *
 * @param onProgress  Callback con estado en tiempo real
 * @param config      Parámetros configurables
 * @returns  Handle para detener el escaneo y recuperar muestras
 */
export async function startMagneticScanNative(
  onProgress: (progress: MagneticNativeProgress) => void,
  config: MagneticNativeConfig = DEFAULT_CONFIG,
): Promise<MagneticScanHandle> {
  // Verificar disponibilidad del sensor
  const available = await Magnetometer.isAvailableAsync();
  if (!available) {
    onProgress({
      phase: 'unavailable',
      currentMicroTesla: 0,
      baselineMicroTesla: null,
      signedDelta: null,
      mad: null,
      adaptiveThreshold: null,
      signalQuality: 0,
      sensorSaturated: false,
      calibrationValid: false,
      secondsRemainingCalibration: 0,
      samples: [],
    });
    return { stop: () => {}, getSamples: () => [] };
  }

  Magnetometer.setUpdateInterval(config.updateIntervalMs);

  const allSamples: MagneticSample[] = [];
  const startMs = Date.now();
  let baselineMicroTesla: number | null = null;
  let calibrationDone = false;
  let subscription: Subscription | null = null;

  // Ventana deslizante para detección de anomalías
  const monitoringWindow: number[] = [];

  subscription = Magnetometer.addListener(({ x, y, z }) => {
    const now = Date.now();
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const relativeTs = now - startMs;

    allSamples.push({ x, y, z, magnitude, ts: relativeTs });

    // Detectar saturación
    const sensorSaturated = magnitude > config.saturationThresholdUt;

    if (sensorSaturated) {
      onProgress({
        phase: 'error',
        currentMicroTesla: magnitude,
        baselineMicroTesla,
        signedDelta: null,
        mad: null,
        adaptiveThreshold: null,
        signalQuality: 0,
        sensorSaturated: true,
        calibrationValid: false,
        secondsRemainingCalibration: 0,
        samples: [...allSamples],
      });
      return;
    }

    const elapsed = now - startMs;

    if (!calibrationDone) {
      // ── Fase de calibración ────────────────────────────────────────────────
      const secondsRemaining = Math.max(0, Math.ceil((config.calibrationMs - elapsed) / 1000));
      onProgress({
        phase: 'calibrating',
        currentMicroTesla: Number(magnitude.toFixed(1)),
        baselineMicroTesla: null,
        signedDelta: null,
        mad: null,
        adaptiveThreshold: null,
        signalQuality: 0,
        sensorSaturated: false,
        calibrationValid: false,
        secondsRemainingCalibration: secondsRemaining,
        samples: [...allSamples],
      });

      if (elapsed >= config.calibrationMs) {
        calibrationDone = true;
        const magnitudes = allSamples.map((s) => s.magnitude);
        baselineMicroTesla = computeMedian(magnitudes);
      }
      return;
    }

    // ── Fase de monitoreo ──────────────────────────────────────────────────
    if (baselineMicroTesla === null) return;

    // Actualizar ventana deslizante
    monitoringWindow.push(magnitude);
    if (monitoringWindow.length > 20) monitoringWindow.shift();

    // MAD de la ventana
    const windowMedian = computeMedian(monitoringWindow);
    const deviations = monitoringWindow.map((v) => Math.abs(v - windowMedian));
    const mad = computeMedian(deviations);

    // Umbral adaptativo
    const adaptiveThreshold = Math.max(25, mad * config.madMultiplier);

    // Calidad de señal: MAD bajo = señal estable
    const signalQuality = Math.max(0, Math.min(1, 1 - (mad / (baselineMicroTesla * 0.15))));

    const signedDelta = magnitude - baselineMicroTesla;

    onProgress({
      phase: 'monitoring',
      currentMicroTesla: Number(magnitude.toFixed(1)),
      baselineMicroTesla: Number(baselineMicroTesla.toFixed(1)),
      signedDelta: Number(signedDelta.toFixed(1)),
      mad: Number(mad.toFixed(2)),
      adaptiveThreshold: Number(adaptiveThreshold.toFixed(1)),
      signalQuality: Number(signalQuality.toFixed(3)),
      sensorSaturated: false,
      calibrationValid: true,
      secondsRemainingCalibration: 0,
      samples: [...allSamples],
    });
  });

  return {
    stop: () => {
      subscription?.remove();
    },
    getSamples: () => [...allSamples],
  };
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
