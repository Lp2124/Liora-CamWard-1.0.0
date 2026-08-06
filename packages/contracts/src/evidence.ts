/**
 * @liora/contracts — EvidenceSchema
 *
 * Toda evidencia usa campos emitidos/calculados por el servidor.
 * El cliente solo envía observaciones crudas.
 */
export interface Evidence {
  evidenceId: string;               // UUID emitido por servidor
  inspectionId: string;             // UUID de la inspección
  captureNonce: string;             // nonce de captura del cliente
  serverTimestamp: string;          // ISO timestamp del servidor
  sha256: string;                   // hash SHA-256 del archivo recibido
  sizeBytes: number;                // tamaño real recibido
  mimeType: string;                 // MIME detectado por contenido (no por cliente)
  processingStatus: ProcessingStatus;
  algorithmVersion: string;
  modelVersion?: string;
  analysisResult?: AnalysisResult;
  reviewStatus: ReviewStatus;
}

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected';

export type ReviewStatus =
  | 'unreviewed'
  | 'under_review'
  | 'validated'
  | 'dismissed'
  | 'escalated';

export interface AnalysisResult {
  verdict: import('./verdict').VisualVerdict;
  confidence: number;
  riskContribution: number;
  findings: string[];
  boundingBoxes?: import('./verdict').BoundingBox[];
  algorithmVersion: string;
  modelVersion?: string;
  processedAt: string;
}

/** Observación cruda que el cliente envía para análisis */
export interface RawCaptureSubmission {
  inspectionId: string;
  captureNonce: string;
  clientTimestamp: string;
  orientation: OrientationData;
  exposureInfo?: ExposureInfo;
  sessionId: string;
  deviceFingerprint: string;       // hash del dispositivo, no PII
  measurementQuality: number;
}

export interface OrientationData {
  alpha: number;
  beta: number;
  gamma: number;
  absolute?: boolean;
}

export interface ExposureInfo {
  brightnessEstimate: number;
  torchActive: boolean;
  captureMode: 'normal' | 'torch_off' | 'torch_on';
}
