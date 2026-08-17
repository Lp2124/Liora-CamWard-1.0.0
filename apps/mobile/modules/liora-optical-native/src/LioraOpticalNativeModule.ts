import { requireNativeModule } from 'expo';

export interface NativeOpticalCluster {
  relativeX: number;
  relativeY: number;
  clusterSizePx: number;
  compactness: number;
  maxBrightness: number;
  saturation: number;
}

export interface NativeOpticalAnalysis {
  sourceWidth: number;
  sourceHeight: number;
  analyzedWidth: number;
  analyzedHeight: number;
  brightnessEstimate: number;
  overexposedRatio: number;
  sharpnessVariance: number;
  sha256: string;
  sizeBytes: number;
  clusters: NativeOpticalCluster[];
}

interface LioraOpticalNativeModuleApi {
  analyzeImage(
    uri: string,
    brightnessThreshold: number,
    maxSaturation: number,
    minClusterPixels: number,
    maxClusterPixels: number,
    maxDimension: number,
    edgeMarginPixels: number,
  ): Promise<NativeOpticalAnalysis>;
}

export default requireNativeModule<LioraOpticalNativeModuleApi>('LioraOpticalNative');
