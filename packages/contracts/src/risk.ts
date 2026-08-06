/**
 * @liora/contracts — RiskModel
 *
 * Modelo de riesgo con 6 niveles. El score final SOLO se calcula en el servidor.
 * El cliente NUNCA puede enviarlo.
 */
export type RiskLevel =
  | 'none'
  | 'informational'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export interface RiskResult {
  score: number;                    // 0-100 numérico
  level: RiskLevel;
  confidence: number;               // 0.0-1.0
  contributingEvidenceIds: string[];
  discardedEvidenceIds: string[];
  contradictions: string[];
  nextRecommendation: string;
  algorithmVersion: string;
  calculatedAt: string;             // ISO timestamp del servidor
}

export interface ScanModule {
  id: ModuleId;
  label: string;
  supported: boolean;
  permissionState: PermissionState;
  reason?: string;
}

export type ModuleId = 'network' | 'bluetooth' | 'optical' | 'magnetic';
export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';
export type FindingSeverity = 'info' | 'suspicious' | 'high';

export interface Finding {
  id?: string;                      // asignado por servidor
  module: ModuleId;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: RawObservation;
}

/**
 * Raw observations = lo que el cliente puede enviar.
 * El servidor calcula clasificación, severidad y riesgo.
 */
export interface RawObservation {
  source: string;
  captureTimestamp: string;         // ISO monotónico del cliente
  sessionNonce?: string;
  deviceId?: string;
  measurementQuality?: number;      // 0-1
  [key: string]: unknown;           // datos crudos del sensor
}
