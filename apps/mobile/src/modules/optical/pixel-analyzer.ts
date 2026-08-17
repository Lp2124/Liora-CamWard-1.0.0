import LioraOpticalNative from '../../../modules/liora-optical-native';
import type { CapturedOpticalFrame } from './camera-scanner';
import type { AnalyzedOpticalFrame } from './cluster-analysis';

export async function analyzeCapturedOpticalFrame(
  frame: CapturedOpticalFrame,
): Promise<AnalyzedOpticalFrame> {
  const analysis = await LioraOpticalNative.analyzeImage(
    frame.uri,
    240,
    0.3,
    3,
    1000,
    640,
    10,
  );

  if (!/^[a-f0-9]{64}$/u.test(analysis.sha256)) {
    throw new Error('OPTICAL_SHA256_INVALID');
  }
  if (analysis.sizeBytes <= 0 || analysis.analyzedWidth <= 0 || analysis.analyzedHeight <= 0) {
    throw new Error('OPTICAL_NATIVE_ANALYSIS_INVALID');
  }

  return { ...frame, analysis };
}

export {
  aggregateOpticalPhase,
  compareTorchPhases,
} from './cluster-analysis';
export type {
  AggregatedOpticalPhase,
  AnalyzedOpticalFrame,
  OpticalPairComparison,
} from './cluster-analysis';
