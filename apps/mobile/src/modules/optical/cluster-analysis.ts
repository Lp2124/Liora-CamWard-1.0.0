import type { OpticalClusterData } from '@liora/contracts';
import type { NativeOpticalAnalysis, NativeOpticalCluster } from '../../../modules/liora-optical-native';
import type { CapturedOpticalFrame, CapturePhase } from './camera-scanner';

const TRACK_RADIUS_PERCENT = 3;
const MAX_SIZE_RATIO = 4;

export interface AnalyzedOpticalFrame extends CapturedOpticalFrame {
  analysis: NativeOpticalAnalysis;
}

export interface AggregatedOpticalPhase {
  phase: CapturePhase;
  frameCount: number;
  brightnessEstimate: number;
  overexposedRatio: number;
  sharpnessVariance: number;
  clusters: OpticalClusterData[];
  frames: AnalyzedOpticalFrame[];
}

export interface OpticalPairComparison {
  differentialDelta: number | null;
  matchedClusterCount: number;
}

interface ClusterTrack {
  frameIndexes: Set<number>;
  samples: NativeOpticalCluster[];
}

export function aggregateOpticalPhase(
  phase: CapturePhase,
  frames: readonly AnalyzedOpticalFrame[],
): AggregatedOpticalPhase {
  if (frames.length === 0) throw new Error('OPTICAL_FRAMES_REQUIRED');
  if (frames.some((frame) => frame.captureMode !== phase)) {
    throw new Error('OPTICAL_PHASE_MISMATCH');
  }

  const tracks: ClusterTrack[] = [];

  frames.forEach((frame, frameIndex) => {
    const claimedTracks = new Set<number>();
    for (const cluster of frame.analysis.clusters) {
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
        if (claimedTracks.has(trackIndex)) continue;
        const representative = representativeCluster(tracks[trackIndex].samples);
        const distance = clusterDistance(cluster, representative);
        if (
          distance <= TRACK_RADIUS_PERCENT &&
          sizeRatio(cluster.clusterSizePx, representative.clusterSizePx) <= MAX_SIZE_RATIO &&
          distance < bestDistance
        ) {
          bestIndex = trackIndex;
          bestDistance = distance;
        }
      }

      if (bestIndex >= 0) {
        tracks[bestIndex].samples.push(cluster);
        tracks[bestIndex].frameIndexes.add(frameIndex);
        claimedTracks.add(bestIndex);
      } else {
        tracks.push({ frameIndexes: new Set([frameIndex]), samples: [cluster] });
        claimedTracks.add(tracks.length - 1);
      }
    }
  });

  return {
    phase,
    frameCount: frames.length,
    brightnessEstimate: median(frames.map((frame) => frame.analysis.brightnessEstimate)),
    overexposedRatio: median(frames.map((frame) => frame.analysis.overexposedRatio)),
    sharpnessVariance: median(frames.map((frame) => frame.analysis.sharpnessVariance)),
    clusters: tracks.map((track) => {
      const representative = representativeCluster(track.samples);
      return {
        persistedFrames: track.frameIndexes.size,
        relativeX: representative.relativeX,
        relativeY: representative.relativeY,
        clusterSizePx: Math.round(representative.clusterSizePx),
        compactness: representative.compactness,
        maxBrightness: representative.maxBrightness,
        saturation: representative.saturation,
      } satisfies OpticalClusterData;
    }),
    frames: [...frames],
  };
}

export function compareTorchPhases(
  torchOff: AggregatedOpticalPhase,
  torchOn: AggregatedOpticalPhase,
): OpticalPairComparison {
  if (torchOff.phase !== 'torch_off' || torchOn.phase !== 'torch_on') {
    throw new Error('OPTICAL_TORCH_PHASES_REQUIRED');
  }

  const deltas: number[] = [];
  const usedOff = new Set<number>();
  for (const onCluster of torchOn.clusters) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < torchOff.clusters.length; index += 1) {
      if (usedOff.has(index)) continue;
      const offCluster = torchOff.clusters[index];
      const distance = clusterDistance(onCluster, offCluster);
      if (
        distance <= TRACK_RADIUS_PERCENT &&
        sizeRatio(onCluster.clusterSizePx, offCluster.clusterSizePx) <= MAX_SIZE_RATIO &&
        distance < bestDistance
      ) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0) {
      usedOff.add(bestIndex);
      deltas.push(onCluster.maxBrightness - torchOff.clusters[bestIndex].maxBrightness);
    }
  }

  return {
    differentialDelta: deltas.length > 0 ? median(deltas) : null,
    matchedClusterCount: deltas.length,
  };
}

function representativeCluster(samples: readonly NativeOpticalCluster[]): NativeOpticalCluster {
  return {
    relativeX: median(samples.map((sample) => sample.relativeX)),
    relativeY: median(samples.map((sample) => sample.relativeY)),
    clusterSizePx: median(samples.map((sample) => sample.clusterSizePx)),
    compactness: median(samples.map((sample) => sample.compactness)),
    maxBrightness: median(samples.map((sample) => sample.maxBrightness)),
    saturation: median(samples.map((sample) => sample.saturation)),
  };
}

function clusterDistance(
  a: Pick<NativeOpticalCluster, 'relativeX' | 'relativeY'>,
  b: Pick<NativeOpticalCluster, 'relativeX' | 'relativeY'>,
): number {
  return Math.hypot(a.relativeX - b.relativeX, a.relativeY - b.relativeY);
}

function sizeRatio(a: number, b: number): number {
  const smaller = Math.max(1, Math.min(a, b));
  return Math.max(a, b) / smaller;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('OPTICAL_MEDIAN_EMPTY');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
