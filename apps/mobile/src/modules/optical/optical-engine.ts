import type { CameraView } from 'expo-camera';
import type {
  ObservationAnalysisResponse,
  OpticalClusterData,
  OpticalFrameEvidenceReference,
  SubmitOpticalObservationRequest,
} from '@liora/contracts';
import { randomUUID } from 'expo-crypto';
import LioraOpticalNative from '../../../modules/liora-optical-native';
import { captureOpticalFrame, OPTICAL_ANALYSIS_CONSTANTS } from './camera-scanner';
import {
  aggregateOpticalPhase,
  analyzeCapturedOpticalFrame,
  compareTorchPhases,
  type AggregatedOpticalPhase,
  type AnalyzedOpticalFrame,
  type OpticalPairComparison,
} from './pixel-analyzer';
import { submitOpticalObservation, uploadOpticalEvidence } from '../../api/client';

export type OpticalInspectionStage =
  | 'preparing'
  | 'capturing_torch_off'
  | 'capturing_torch_on'
  | 'analyzing'
  | 'syncing_evidence'
  | 'syncing_observation'
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
  evidenceUploaded: number;
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

  const offFrames = await captureAndAnalyzePhase(options.cameraRef, 'torch_off', () => {
    completedFrames += 1;
    report('capturing_torch_off');
  });

  options.setTorchActive(true);
  await delay(700);
  let onFrames: AnalyzedOpticalFrame[];
  try {
    onFrames = await captureAndAnalyzePhase(options.cameraRef, 'torch_on', () => {
      completedFrames += 1;
      report('capturing_torch_on');
    });
  } finally {
    options.setTorchActive(false);
  }

  report('analyzing');
  const torchOff = aggregateOpticalPhase('torch_off', offFrames);
  const torchOn = aggregateOpticalPhase('torch_on', onFrames);
  const comparison = compareTorchPhases(torchOff, torchOn);
  const persistentCandidates = torchOn.clusters
    .filter((cluster) => cluster.persistedFrames >= OPTICAL_ANALYSIS_CONSTANTS.PERSIST_FRAMES_REQUIRED)
    .sort((a, b) => b.persistedFrames - a.persistedFrames || b.compactness - a.compactness);

  let evidenceRefs: OpticalFrameEvidenceReference[] = [];
  let serverAnalysis: ObservationAnalysisResponse | null = null;
  let syncError: string | null = null;

  if (options.inspectionId) {
    try {
      if (persistentCandidates[0]) {
        report('syncing_evidence');
        evidenceRefs = await uploadFocusedEvidence(
          options.inspectionId,
          persistentCandidates[0],
          torchOff.frames,
          torchOn.frames,
        );
      }

      report('syncing_observation');
      serverAnalysis = await submitOpticalObservation(
        buildServerObservation(
          options.inspectionId,
          options.deviceFingerprint,
          torchOff,
          torchOn,
          comparison,
          evidenceRefs,
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
    persistentCandidateCount: persistentCandidates.length,
    evidenceUploaded: evidenceRefs.length,
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
    frames.push(await analyzeCapturedOpticalFrame(captured));
    onFrameComplete();
    if (index + 1 < OPTICAL_ANALYSIS_CONSTANTS.CAPTURE_FRAMES_PER_PHASE) await delay(100);
  }
  return frames;
}

async function uploadFocusedEvidence(
  inspectionId: string,
  candidate: OpticalClusterData,
  torchOffFrames: readonly AnalyzedOpticalFrame[],
  torchOnFrames: readonly AnalyzedOpticalFrame[],
): Promise<OpticalFrameEvidenceReference[]> {
  const requiredPerPhase = 4;
  const selectedOff = selectEvidenceFrames(torchOffFrames, candidate, requiredPerPhase, false);
  const selectedOn = selectEvidenceFrames(torchOnFrames, candidate, requiredPerPhase, true);
  if (selectedOff.length < requiredPerPhase || selectedOn.length < requiredPerPhase) {
    throw new Error('OPTICAL_EVIDENCE_PERSISTENCE_NOT_REPRODUCIBLE');
  }

  const references: OpticalFrameEvidenceReference[] = [];
  for (const frame of [...selectedOff, ...selectedOn]) {
    const crop = await LioraOpticalNative.cropEvidence(
      frame.uri,
      candidate.relativeX,
      candidate.relativeY,
      20,
    );
    const uploaded = await uploadOpticalEvidence({
      inspectionId,
      captureNonce: frame.captureNonce,
      phase: frame.captureMode,
      uri: crop.uri,
      expectedSha256: crop.sha256,
      expectedSizeBytes: crop.sizeBytes,
    });
    references.push({
      phase: frame.captureMode,
      sha256: uploaded.sha256,
      sizeBytes: uploaded.sizeBytes,
      evidenceId: uploaded.evidenceId,
    });
  }
  return references;
}

function selectEvidenceFrames(
  frames: readonly AnalyzedOpticalFrame[],
  candidate: OpticalClusterData,
  count: number,
  requireCandidate: boolean,
): AnalyzedOpticalFrame[] {
  const scored = frames.map((frame) => {
    const nearest = frame.analysis.clusters
      .map((cluster) => ({
        cluster,
        distance: Math.hypot(cluster.relativeX - candidate.relativeX, cluster.relativeY - candidate.relativeY),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    return {
      frame,
      distance: nearest?.distance ?? Number.POSITIVE_INFINITY,
      brightness: nearest?.cluster.maxBrightness ?? 0,
    };
  });

  const usable = requireCandidate
    ? scored.filter((item) => item.distance <= 3)
    : scored;
  return usable
    .sort((a, b) => a.distance - b.distance || b.brightness - a.brightness)
    .slice(0, count)
    .map((item) => item.frame);
}

function buildServerObservation(
  inspectionId: string,
  deviceFingerprint: string,
  torchOff: AggregatedOpticalPhase,
  torchOn: AggregatedOpticalPhase,
  comparison: OpticalPairComparison,
  frameEvidence: OpticalFrameEvidenceReference[],
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
    frameEvidence,
    deviceFingerprint,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error de sincronización óptica.';
}
