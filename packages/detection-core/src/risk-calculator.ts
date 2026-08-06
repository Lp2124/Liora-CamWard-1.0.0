/**
 * @liora/detection-core — RiskCalculator (SERVER-SIDE ONLY)
 *
 * El score final se calcula EXCLUSIVAMENTE en el servidor.
 * El cliente NUNCA puede enviar riskLevel, severity ni resultado final.
 *
 * Niveles: none | informational | low | medium | high | critical
 * Versión: 1.0.0
 */

import type { RiskLevel, RiskResult, Finding, ModuleId } from '@liora/contracts';
import type { CorrelatedEvidence } from './correlation-matrix';
import { correlateEvidence, DEFAULT_CORRELATION_CONFIG } from './correlation-matrix';

export interface RiskCalculationInput {
  findings: Finding[];
  correlated: CorrelatedEvidence[];
  inspectionId: string;
}

/**
 * Pesos base por módulo y severidad.
 * Solo `suspicious` y `high` contribuyen al score de riesgo.
 * `info` es contexto, nunca riesgo.
 */
const SEVERITY_WEIGHTS: Record<Finding['severity'], number> = {
  info: 0,
  suspicious: 15,
  high: 35,
};

/**
 * Bonus por corroboración multi-módulo.
 * Un reflejo óptico + BLE compatible = +20 puntos extra.
 * Un cargador + magnetómetro = 0 bonus (combo benigno ya descontado).
 */
const CORROBORATION_BONUS = 20;

export function calculateRisk(input: RiskCalculationInput): RiskResult {
  const alertFindings = input.findings.filter(
    (f) => f.severity === 'suspicious' || f.severity === 'high',
  );

  const discardedIds: string[] = [];
  const contributingIds: string[] = [];
  const contradictions: string[] = [];

  let score = 0;

  // ── Paso 1: score base por hallazgos individuales ─────────────────────────
  for (const f of alertFindings) {
    const contribution = SEVERITY_WEIGHTS[f.severity];
    if (f.id) contributingIds.push(f.id);
    score += contribution;
  }

  // ── Paso 2: corroboración multi-módulo ────────────────────────────────────
  const modulesWithAlert = new Set<ModuleId>(alertFindings.map((f) => f.module));
  let corroborationApplied = false;

  if (modulesWithAlert.size >= 2 && input.correlated.length >= 2) {
    // Evaluar el par de mayor confianza
    const sorted = [...input.correlated].sort((a, b) => b.confidence - a.confidence);
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const result = correlateEvidence(sorted[i], sorted[j], DEFAULT_CORRELATION_CONFIG);
        if (result.isCorroborated) {
          score += CORROBORATION_BONUS;
          corroborationApplied = true;
          break;
        } else {
          result.contradictions.forEach((c) => contradictions.push(c));
        }
      }
      if (corroborationApplied) break;
    }

    if (!corroborationApplied) {
      contradictions.push(
        'Múltiples módulos dispararon pero las evidencias no se corroboran espacial/temporalmente.',
      );
      // Descartar aumento automático por múltiples módulos sin correlación
      const infoFindings = input.findings.filter((f) => f.severity === 'info');
      infoFindings.forEach((f) => { if (f.id) discardedIds.push(f.id); });
    }
  }

  // ── Paso 3: limitar score a 100 ───────────────────────────────────────────
  score = Math.min(100, Math.max(0, score));

  // ── Paso 4: mapear a nivel ────────────────────────────────────────────────
  const level = scoreToLevel(score);

  // ── Paso 5: calcular confianza global ─────────────────────────────────────
  const confidence = calculateGlobalConfidence(alertFindings, corroborationApplied);

  const recommendation = buildRecommendation(level, modulesWithAlert, corroborationApplied);

  return {
    score: Number(score.toFixed(1)),
    level,
    confidence: Number(confidence.toFixed(3)),
    contributingEvidenceIds: contributingIds,
    discardedEvidenceIds: discardedIds,
    contradictions,
    nextRecommendation: recommendation,
    algorithmVersion: '1.0.0',
    calculatedAt: new Date().toISOString(),
  };
}

function scoreToLevel(score: number): RiskLevel {
  if (score === 0) return 'none';
  if (score < 15) return 'informational';
  if (score < 30) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'critical';
}

function calculateGlobalConfidence(
  alertFindings: Finding[],
  corroborated: boolean,
): number {
  if (alertFindings.length === 0) return 1.0; // confianza alta en "limpio"

  // Base: promedio de confianza de evidencias individuales
  const avgConf = alertFindings.reduce((sum, f) => {
    const w = f.severity === 'high' ? 0.9 : 0.6;
    return sum + w;
  }, 0) / alertFindings.length;

  // Bonus por corroboración independiente
  return Math.min(1.0, corroborated ? avgConf + 0.15 : avgConf);
}

function buildRecommendation(
  level: RiskLevel,
  modules: Set<ModuleId>,
  corroborated: boolean,
): string {
  switch (level) {
    case 'none':
      return 'No se encontraron señales anómalas. Escaneo completado.';
    case 'informational':
      return 'Señales de baja relevancia detectadas. Realiza un segundo escaneo para confirmar.';
    case 'low':
      return modules.has('optical')
        ? 'Mueve el teléfono unos centímetros del punto detectado: un reflejo de lente real varía con el ángulo.'
        : 'Inspección visual directa recomendada en la zona señalada.';
    case 'medium':
      return corroborated
        ? 'Dos módulos independientes señalan la misma zona. Realiza una inspección física cercana de los objetos en esa área.'
        : 'Evidencia moderada en un módulo. Ejecuta el escáner BLE y óptico para corroborar.';
    case 'high':
      return 'Evidencias múltiples y coherentes. Inspección física detallada recomendada. Notifica a la administración si el lugar es público.';
    case 'critical':
      return 'Múltiples módulos independientes confirman anomalías consistentes. Documenta visualmente la zona y consulta a un profesional.';
    default:
      return 'Continúa el escaneo.';
  }
}
