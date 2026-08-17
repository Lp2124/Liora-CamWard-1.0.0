/**
 * Liora CamWard — optical camera capture.
 *
 * Captures real JPEG files into the application cache through expo-camera.
 * Pixel analysis and SHA-256 calculation are performed against those files by
 * the native optical analyzer.
 */
import type { CameraCapturedPicture, CameraView } from 'expo-camera';
import { randomUUID } from 'expo-crypto';

export type CapturePhase = 'normal' | 'torch_off' | 'torch_on';

export interface CapturedOpticalFrame {
  captureNonce: string;
  uri: string;
  width: number;
  height: number;
  captureMode: CapturePhase;
  torchActive: boolean;
  capturedAt: string;
}

export async function captureOpticalFrame(
  cameraRef: React.RefObject<CameraView | null>,
  phase: CapturePhase,
): Promise<CapturedOpticalFrame> {
  const camera = cameraRef.current;
  if (!camera) throw new Error('OPTICAL_CAMERA_UNAVAILABLE');

  const picture: CameraCapturedPicture = await camera.takePictureAsync({
    quality: 0.8,
    base64: false,
    skipProcessing: false,
  });

  if (!picture.uri || picture.width <= 0 || picture.height <= 0) {
    throw new Error('OPTICAL_CAPTURE_FILE_UNAVAILABLE');
  }

  return {
    captureNonce: randomUUID(),
    uri: picture.uri,
    width: picture.width,
    height: picture.height,
    captureMode: phase,
    torchActive: phase === 'torch_on',
    capturedAt: new Date().toISOString(),
  };
}

export const OPTICAL_ANALYSIS_CONSTANTS = {
  BRIGHTNESS_THRESHOLD: 240,
  MIN_CLUSTER_PX: 3,
  MAX_CLUSTER_PX: 500,
  PERSIST_FRAMES_REQUIRED: 6,
  CAPTURE_FRAMES_PER_PHASE: 8,
  COMPACTNESS_MIN: 0.3,
  MAX_SATURATION: 0.3,
  EDGE_MARGIN_PX: 10,
  MAX_CLUSTER_PX_EXPANDED: 1000,
  ANALYSIS_MAX_DIMENSION: 640,
} as const;
