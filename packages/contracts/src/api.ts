/**
 * @liora/contracts — API Contracts
 *
 * Esquemas compartidos entre cliente y servidor.
 * Versión 1.0.0
 */

// ── Inspection ────────────────────────────────────────────────────────────────

export interface CreateInspectionRequest {
  label?: string;
  locationDescription?: string;
}

export interface InspectionResponse {
  inspectionId: string;
  label: string | null;
  status: InspectionStatus;
  startedAt: string;
  finishedAt?: string;
  riskResult?: import('./risk').RiskResult;
  findingCount: number;
}

export type InspectionStatus =
  | 'in_progress'
  | 'completed'
  | 'aborted';

// ── Raw Sensor Observations (what client sends) ───────────────────────────────

export interface SubmitOpticalObservationRequest {
  inspectionId: string;
  captureNonce: string;
  clientTimestamp: string;
  captureMode: 'normal' | 'torch_off' | 'torch_on';
  brightnessEstimate: number;
  torchActive: boolean;
  orientation?: { alpha: number; beta: number; gamma: number };
  clusterData: OpticalClusterData[];
  frameCount: number;
  quality?: OpticalQualityMetrics;
  pairedCapture?: OpticalPairedCaptureMetrics;
  frameEvidence?: OpticalFrameEvidenceReference[];
  deviceFingerprint: string;
}

export interface OpticalClusterData {
  persistedFrames: number;
  relativeX: number;
  relativeY: number;
  clusterSizePx: number;
  compactness: number;
  maxBrightness: number;
  saturation: number;
}

export interface OpticalQualityMetrics {
  overexposedRatio: number;
  sharpnessVariance: number;
}

export interface OpticalPairedCaptureMetrics {
  torchOffFrameCount: number;
  torchOnFrameCount: number;
  torchOffBrightnessEstimate: number;
  torchOnBrightnessEstimate: number;
  differentialDelta: number | null;
  matchedClusterCount: number;
}

export interface OpticalFrameEvidenceReference {
  phase: 'torch_off' | 'torch_on';
  sha256: string;
  sizeBytes: number;
  evidenceId?: string;
}

export interface UploadOpticalEvidenceResponse {
  evidenceId: string;
  inspectionId: string;
  captureNonce: string;
  phase: 'torch_off' | 'torch_on';
  sha256: string;
  sizeBytes: number;
  mimeType: 'image/jpeg';
  storedAt: string;
}

export interface SubmitMagneticObservationRequest {
  inspectionId: string;
  captureNonce: string;
  clientTimestamp: string;
  phase: 'baseline' | 'monitoring';
  samples: MagneticSample[];
  baselineMicroTesla?: number;
  orientation?: { alpha: number; beta: number; gamma: number };
  deviceFingerprint: string;
}

export interface MagneticSample {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  ts: number;
}

export interface SubmitBleObservationRequest {
  inspectionId: string;
  captureNonce: string;
  clientTimestamp: string;
  devices: BleDeviceObservation[];
  deviceFingerprint: string;
}

export interface BleDeviceObservation {
  anonymizedId: string;
  name: string | null;
  rssi?: number;
  manufacturerDataHex?: string;
  serviceUuids?: string[];
  connectability?: boolean;
  firstSeenTs: number;
  lastSeenTs: number;
  occurrenceCount: number;
}

export interface SubmitNetworkObservationRequest {
  inspectionId: string;
  captureNonce: string;
  clientTimestamp: string;
  connectionType?: string;
  effectiveType?: string;
  bssid?: string;
  discoveredServices?: NetworkServiceObservation[];
  deviceFingerprint: string;
}

export interface NetworkServiceObservation {
  protocol: 'mdns' | 'ssdp' | 'onvif' | 'rtsp' | 'arp' | 'other';
  address: string;
  port?: number;
  serviceType?: string;
  hostnames?: string[];
  ouiVendor?: string;
}

// ── Server Responses (what server returns, never what client sends) ───────────

export interface ObservationAnalysisResponse {
  observationId: string;
  inspectionId: string;
  verdict: import('./verdict').VisualVerdict;
  riskContribution: import('./risk').RiskResult;
  findings: import('./risk').Finding[];
  processedAt: string;
  algorithmVersion: string;
}

// ── Premium ───────────────────────────────────────────────────────────────────

export interface RedeemCodeRequest {
  code: string;
}

export interface RedeemCodeResponse {
  redeemed: boolean;
  premiumActiveUntil?: string;
  isLifetime: boolean;
}
