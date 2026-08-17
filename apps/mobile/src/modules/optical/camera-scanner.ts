/**
 * Liora CamWard — optical capture module.
 *
 * This module only reports what it can actually obtain from the device:
 * photographs captured by expo-camera and deterministic observation payloads
 * built from real analysis results. It does not fabricate clusters, verdicts,
 * confidence, IR compatibility, or risk.
 */
import type { CameraCapturedPicture, CameraView } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import type {
  OpticalClusterData,
  SubmitOpticalObservationRequest,
} from '@liora/contracts';

export type CapturePhase = 'normal' | 'torch_off' | 'torch_on';

export interface CapturedOpticalFrame {
  uri: string;
  width: number;
  height: number;
  base64: string;
  captureMode: CapturePhase;
  torchActive: boolean;
  capturedAt: string;
}

export interface FrameAnalysisResult {
  clusters: OpticalClusterData[];
  frameCount: number;
  brightnessEstimate: number;
  torchActive: boolean;
  captureMode: CapturePhase;
}

/**
 * Captures an actual camera frame. No synthetic fallback is allowed.
 * If expo-camera cannot return image bytes, the operation fails explicitly.
 */
export async function captureOpticalFrame(
  cameraRef: React.RefObject<CameraView | null>,
  phase: CapturePhase,
): Promise<CapturedOpticalFrame> {
  const camera = cameraRef.current;
  if (!camera) {
    throw new Error('OPTICAL_CAMERA_UNAVAILABLE');
  }

  const picture: CameraCapturedPicture = await camera.takePictureAsync({
    quality: 1,
    base64: true,
    skipProcessing: false,
  });

  if (!picture.base64 || picture.width <= 0 || picture.height <= 0) {
    throw new Error('OPTICAL_CAPTURE_BYTES_UNAVAILABLE');
  }

  return {
    uri: picture.uri,
    width: picture.width,
    height: picture.height,
    base64: picture.base64,
    captureMode: phase,
    torchActive: phase === 'torch_on',
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Builds the server request only after a real analyzer has produced measurable
 * optical clusters. This function does not infer or invent them.
 */
export function buildOpticalObservationRequest(
  result: FrameAnalysisResult,
  inspectionId: string,
  orientation: { alpha: number; beta: number; gamma: number },
  deviceFingerprint: string,
): SubmitOpticalObservationRequest {
  if (!inspectionId) throw new Error('OPTICAL_INSPECTION_ID_REQUIRED');
  if (!Number.isFinite(result.brightnessEstimate)) {
    throw new Error('OPTICAL_BRIGHTNESS_INVALID');
  }
  if (!Number.isInteger(result.frameCount) || result.frameCount <= 0) {
    throw new Error('OPTICAL_FRAME_COUNT_INVALID');
  }

  return {
    inspectionId,
    captureNonce: randomUUID(),
    clientTimestamp: new Date().toISOString(),
    captureMode: result.captureMode,
    brightnessEstimate: result.brightnessEstimate,
    torchActive: result.torchActive,
    orientation,
    clusterData: result.clusters,
    frameCount: result.frameCount,
    deviceFingerprint,
  };
}

export const OPTICAL_ANALYSIS_CONSTANTS = {
  BRIGHTNESS_THRESHOLD: 240,
  MIN_CLUSTER_PX: 3,
  MAX_CLUSTER_PX: 500,
  PERSIST_FRAMES_REQUIRED: 6,
  COMPACTNESS_MIN: 0.3,
  MAX_SATURATION: 0.3,
  EDGE_MARGIN_PX: 10,
  MAX_CLUSTER_PX_EXPANDED: 1000,
} as const;
