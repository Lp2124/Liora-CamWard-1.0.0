import type { CameraView } from 'expo-camera';
import type { ObservationAnalysisResponse, SubmitOpticalObservationRequest } from '@liora/contracts';
import { randomUUID } from 'expo-crypto';
import { captureOpticalFrame, OPTICAL_ANALYSIS_CONSTANTS } from './camera-scanner';
import {
  aggregateOpticalPhase,
  analyzeCapturedOpticalFrame,
  compareTorchPhases,
  type AggregatedOpticalPhase,
  type AnalyzedOpticalFrame,
  type OpticalPairComparison,
} from './pixel-analyzer';
import { submitOpticalObservation } from '../../api/client';

export type OpticalInspectionStage =
  | 'preparing'
  | 'capturing_torch_off'
  | 'capturing_torch_on'
  | 'analyzing'
  | 'syncing'
  | 'completed';

export interface OpticalInspectionProgress {
  stage: OpticalInspectionStage;
  completedFrames: number;
  totalFrames: number;
}

export interface OpticalInspectionResult {
  torchOff: AggregatedOpticalPhase;
  torchOn: AggregatedOpticalPhase;
  comparison: OpticalPairComparison;
  persistentCandidateCount: number;
  serverAnalysis: ObservationAnalysisResponse | null;
  syncError: string | null;
}

export interface RunOpticalInspectionOptions {
  cameraRef: React.RefObject<CameraView | null>;
  inspectionId: string | null;
  deviceFingerprint: string;
  setTorchActive: (active: boolean) => void;
  onProgress?: (progress: OpticalInspectionProgress) => void;
}

export async function runOpticalInspection(
  options: RunOpticalInspectionOptions,
): Promise<OpticalInspectionResult> {
  const totalFrames = OPTICAL_ANALYSIS_CONSTANTS.CAPTURE_FRAMES_PER_PHASE * 2;
  let completedFrames = 0;

  const report = (stage: OpticalInspectionStage) => {
    options.onProgress?.({ stage, completedFrames, totalFrames });
  };

  options.setTorchActive(false);
  report('preparing');
  await delay(500);

  const offFrames = await captureAndAnalyzePhase(
    options.cameraRef,
    'torch_off',
    () => {
      completedFrames += 1;
      report('capturing_torch_off');
    },
  );

  options.setTorchActive(true);
  await delay(700);

  let onFrames: AnalyzedOpticalFrame[];
  try {
    onFrames = await captureAndAnalyzePhase(
      options.cameraRef,
      'torch_on',
      () => {
        completedFrames += 1;
        report('capturing_torch_on');
      },
    );
  } finally {
    options.setTorchActive(false);
  }

  report('analyzing');
  const torchOff = aggregateOpticalPhase('torch_off', offFrames);
  const torchOn = aggregateOpticalPhase('torch_on', onFrames);
  const comparison = compareTorchPhases(torchOff, torchOn);
  const persistentCandidateCount = torchOn.clusters.filter(
    (cluster) => cluster.persistedFrames >= OPTICAL_ANALYSIS_CONSTANTS.PERSIST_FRAMES_REQUIRED,
  ).length;

  let serverAnalysis: ObservationAnalysisResponse | null = null;
  let syncError: string | null = null;

  if (options.inspectionId) {
    report('syncing');
    try {
      serverAnalysis = await submitOpticalObservation(
        buildServerObservation(
          options.inspectionId,
          options.deviceFingerprint,
          torchOff,
          torchOn,
          comparison,
        ),
      );
    } catch (error) {
      syncError = errorMessage(error);
    }
  } else {
    syncError = 'Sin sesión de backend; análisis local completado sin sincronización.';
  }

  report('completed');
  return {
    torchOff,
    torchOn,
    comparison,
    persistentCandidateCount,
    serverAnalysis,
    syncError,
  };
}

async function captureAndAnalyzePhase(
  cameraRef: React.RefObject<CameraView | null>,
  phase: 'torch_off' | 'torch_on',
  onFrameComplete: () => void,
): Promise<AnalyzedOpticalFrame[]> {
  const frames: AnalyzedOpticalFrame[] = [];
  for (let index = 0; index < OPTICAL_ANALYSIS_CONSTANTS.CAPTURE_FRAMES_PER_PHASE; index += 1) {
    const captured = await captureOpticalFrame(cameraRef, phase);
    const analyzed = await analyzeCapturedOpticalFrame(captured);
    frames.push(analyzed);
    onFrameComplete();
    if (index + 1 < OPTICAL_ANALYSIS_CONSTANTS.CAPTURE_FRAMES_PER_PHASE) {
      await delay(100);
    }
  }
  return frames;
}

function buildServerObservation(
  inspectionId: string,
  deviceFingerprint: string,
  torchOff: AggregatedOpticalPhase,
  torchOn: AggregatedOpticalPhase,
  comparison: OpticalPairComparison,
): SubmitOpticalObservationRequest {
  return {
    inspectionId,
    captureNonce: randomUUID(),
    clientTimestamp: new Date().toISOString(),
    captureMode: 'torch_on',
    brightnessEstimate: torchOn.brightnessEstimate,
    torchActive: true,
    clusterData: torchOn.clusters,
    frameCount: torchOn.frameCount,
    quality: {
      overexposedRatio: torchOn.overexposedRatio,
      sharpnessVariance: torchOn.sharpnessVariance,
    },
    pairedCapture: {
      torchOffFrameCount: torchOff.frameCount,
      torchOnFrameCount: torchOn.frameCount,
      torchOffBrightnessEstimate: torchOff.brightnessEstimate,
      torchOnBrightnessEstimate: torchOn.brightnessEstimate,
      differentialDelta: comparison.differentialDelta,
      matchedClusterCount: comparison.matchedClusterCount,
    },
    frameEvidence: [...torchOff.frames, ...torchOn.frames].map((frame) => ({
      phase: frame.captureMode,
      sha256: frame.analysis.sha256,
      sizeBytes: frame.analysis.sizeBytes,
    })),
    deviceFingerprint,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error de sincronización óptica.';
}
