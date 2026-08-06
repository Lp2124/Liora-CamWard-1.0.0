/**
 * @liora/detection-core — CorrelationMatrix
 *
 * Motor de correlación espacial y temporal entre módulos independientes.
 * El nivel de riesgo NO sube únicamente porque dos módulos disparen.
 * Requiere compatibilidad causal, proximidad y repetibilidad.
 *
 * Versión: 1.0.0
 */

import type { ModuleId, FindingSeverity, RawObservation } from '@liora/contracts';

export interface CorrelatedEvidence {
  evidenceId: string;
  module: ModuleId;
  severity: FindingSeverity;
  spatialKey?: string;            // grid cell normalizada
  captureTimestamp: string;
  confidence: number;
  observation: RawObservation;
}

export interface CorrelationResult {
  isCorroborated: boolean;
  correlationScore: number;       // 0-1
  spatiallyProximate: boolean;
  temporallyProximate: boolean;
  modulesCorroborated: ModuleId[];
  contradictions: string[];
  explanation: string;
  algorithmVersion: string;
}

/** Ventana temporal para considerar dos evidencias como simultáneas */
const TEMPORAL_WINDOW_MS = 30_000; // 30 segundos

/** Umbral de score de correlación para considerar corroboración */
const CORROBORATION_THRESHOLD = 0.55;

/**
 * Dispositivos que NO deben elevar riesgo aunque aparezcan en múltiples módulos.
 * Un TV con BLE + magnetómetro (por su PSU) NO es evidencia de cámara.
 */
const KNOWN_BENIGN_COMBOS: BenignCombo[] = [
  { modules: ['bluetooth', 'magnetic'], reason: 'TV/altavoz con PSU magnético — falso positivo conocido' },
  { modules: ['network', 'magnetic'], reason: 'Router/switch con PSU magnético — falso positivo conocido' },
];

interface BenignCombo {
  modules: ModuleId[];
  reason: string;
}

/**
 * Evalúa si dos evidencias de módulos distintos se corroboran mutuamente.
 *
 * Criterios positivos (suman):
 *  + Proximidad temporal (< 30 s)
 *  + Misma región espacial
 *  + Compatibilidad causal (p.ej. optical glint + BLE cerca del mismo punto)
 *  + Repetibilidad (ambas evidencias tienen confidence alto)
 *
 * Criterios negativos (restan):
 *  - Combo benigno conocido
 *  - Módulos en zonas opuestas de la habitación
 *  - Confianza baja en alguno de los módulos
 */
export function correlateEvidence(
  a: CorrelatedEvidence,
  b: CorrelatedEvidence,
  config: CorrelationConfig = DEFAULT_CORRELATION_CONFIG,
): CorrelationResult {
  if (a.module === b.module) {
    return {
      isCorroborated: false,
      correlationScore: 0,
      spatiallyProximate: false,
      temporallyProximate: false,
      modulesCorroborated: [],
      contradictions: ['Misma fuente — no constituye evidencia independiente'],
      explanation: 'Las dos evidencias provienen del mismo módulo y no pueden corroborarse mutuamente.',
      algorithmVersion: '1.0.0',
    };
  }

  const contradictions: string[] = [];
  let score = 0;

  // ── Proximidad temporal ────────────────────────────────────────────────────
  const tsA = new Date(a.captureTimestamp).getTime();
  const tsB = new Date(b.captureTimestamp).getTime();
  const deltaTMs = Math.abs(tsA - tsB);
  const temporallyProximate = deltaTMs <= TEMPORAL_WINDOW_MS;

  if (temporallyProximate) {
    // Score proporcional: 0 delta → 0.25, 30 s → 0
    score += config.temporalWeight * (1 - deltaTMs / TEMPORAL_WINDOW_MS);
  } else {
    contradictions.push(`Las evidencias están separadas ${Math.round(deltaTMs / 1000)} s — fuera de la ventana temporal.`);
  }

  // ── Proximidad espacial ───────────────────────────────────────────────────
  const spatiallyProximate =
    !!a.spatialKey && !!b.spatialKey && a.spatialKey === b.spatialKey;

  if (spatiallyProximate) {
    score += config.spatialWeight;
  } else if (a.spatialKey && b.spatialKey) {
    contradictions.push('Las evidencias no coinciden espacialmente — posiblemente fuentes distintas.');
    score -= 0.1; // Penalizar si tenemos ubicación y no coinciden
  }

  // ── Compatibilidad causal ─────────────────────────────────────────────────
  const causallCompatible = isCausallyCompatible(a.module, b.module);
  if (causallCompatible) {
    score += config.causalWeight;
  }

  // ── Combo benigno conocido ─────────────────────────────────────────────────
  const benignCombo = KNOWN_BENIGN_COMBOS.find(
    (c) => c.modules.includes(a.module) && c.modules.includes(b.module),
  );
  if (benignCombo) {
    score -= config.benignPenalty;
    contradictions.push(`Combo benigno: ${benignCombo.reason}`);
  }

  // ── Confianza de los módulos ───────────────────────────────────────────────
  const avgConfidence = (a.confidence + b.confidence) / 2;
  score += config.confidenceWeight * avgConfidence;

  // Penalizar si algún módulo tiene confianza muy baja
  if (a.confidence < 0.3 || b.confidence < 0.3) {
    score -= 0.15;
    contradictions.push('Al menos uno de los módulos tiene confianza baja (< 0.3).');
  }

  score = Math.max(0, Math.min(1, score));

  const isCorroborated = score >= CORROBORATION_THRESHOLD && contradictions.length < 2;

  const explanation = buildExplanation(a, b, score, spatiallyProximate, temporallyProximate, causallCompatible, contradictions);

  return {
    isCorroborated,
    correlationScore: Number(score.toFixed(3)),
    spatiallyProximate,
    temporallyProximate,
    modulesCorroborated: isCorroborated ? [a.module, b.module] : [],
    contradictions,
    explanation,
    algorithmVersion: '1.0.0',
  };
}

/**
 * Determina si dos módulos pueden explicar causalmente el mismo dispositivo.
 *
 * Compatible:
 *  - optical + bluetooth: lente visible + nombre BLE de cámara en el mismo punto
 *  - optical + network: lente visible + dispositivo ONVIF/RTSP cercano
 *  - magnetic + optical: anomalía magnética en el mismo punto que el reflejo
 *
 * NO compatible (por sí solos):
 *  - magnetic + bluetooth: cargador ≠ cámara
 *  - magnetic + network: router ≠ cámara
 */
function isCausallyCompatible(modA: ModuleId, modB: ModuleId): boolean {
  const compatiblePairs: [ModuleId, ModuleId][] = [
    ['optical', 'bluetooth'],
    ['optical', 'network'],
    ['optical', 'magnetic'],
  ];
  return compatiblePairs.some(
    ([x, y]) => (modA === x && modB === y) || (modA === y && modB === x),
  );
}

function buildExplanation(
  a: CorrelatedEvidence,
  b: CorrelatedEvidence,
  score: number,
  spatial: boolean,
  temporal: boolean,
  causal: boolean,
  contradictions: string[],
): string {
  const parts: string[] = [
    `Correlación entre módulo ${a.module} y ${b.module}: score ${(score * 100).toFixed(0)}%.`,
  ];
  if (temporal) parts.push('Evidencias dentro de la ventana temporal (30 s).');
  if (spatial) parts.push('Coincidencia espacial en la misma región.');
  if (causal) parts.push('Compatibilidad causal confirmada.');
  if (contradictions.length) {
    parts.push('Contradicciones: ' + contradictions.join(' / '));
  }
  return parts.join(' ');
}

export interface CorrelationConfig {
  temporalWeight: number;
  spatialWeight: number;
  causalWeight: number;
  confidenceWeight: number;
  benignPenalty: number;
  version: string;
}

export const DEFAULT_CORRELATION_CONFIG: CorrelationConfig = {
  temporalWeight: 0.25,
  spatialWeight: 0.30,
  causalWeight: 0.25,
  confidenceWeight: 0.20,
  benignPenalty: 0.50,
  version: '1.0.0',
};
