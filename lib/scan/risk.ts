import type { Finding, ScanModule } from './types';

export type RiskLevel = 'clear' | 'low' | 'medium' | 'high';

/**
 * Deterministic, evidence-based risk scoring. Never random: the same set of
 * findings always yields the same risk level.
 *
 * Only 'suspicious' and 'high' severity findings contribute to the risk level.
 * 'info' findings (network type, magnetic baseline, unsupported sensors, etc.)
 * are context notes — they carry zero evidentiary weight and must not inflate
 * the risk indicator. This is the primary guard against false positives.
 *
 * Multi-module escalation (Mejora 4):
 *   If two or more INDEPENDENT modules each emit at least one suspicious/high
 *   finding, we escalate directly to 'high' — because multiple independent
 *   detection methods corroborating each other is strong evidence of a real
 *   hidden device. Example: optical glint + bluetooth match = two independent
 *   physical detection methods → 'high', even though each alone = 'low'.
 */
export function computeRiskLevel(findings: Finding[]): RiskLevel {
  const alertFindings = findings.filter(
    (f) => f.severity === 'suspicious' || f.severity === 'high',
  );

  const highCount       = alertFindings.filter((f) => f.severity === 'high').length;
  const suspiciousCount = alertFindings.length;

  // ── Multi-module corroboration check ──────────────────────────────────────
  // Count how many distinct modules have at least 1 suspicious/high finding.
  const modulesWithAlert = new Set<ScanModule>(alertFindings.map((f) => f.module));

  if (modulesWithAlert.size >= 2) {
    // Two independent detection methods both flagged something → high confidence
    return 'high';
  }

  // ── Single-module thresholds ───────────────────────────────────────────────
  if (highCount >= 1)       return 'high';
  if (suspiciousCount >= 3) return 'high';
  if (suspiciousCount >= 2) return 'medium';
  if (suspiciousCount >= 1) return 'low';

  // 'info'-only findings → risk stays 'clear'
  return 'clear';
}
