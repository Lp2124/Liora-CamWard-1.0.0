import {
  aggregateOpticalPhase,
  compareTorchPhases,
} from './cluster-analysis';

function frame(phase, index, x, y, brightness) {
  return {
    captureNonce: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    uri: `file:///tmp/frame-${phase}-${index}.jpg`,
    width: 1920,
    height: 1080,
    captureMode: phase,
    torchActive: phase === 'torch_on',
    capturedAt: new Date(1_700_000_000_000 + index).toISOString(),
    analysis: {
      sourceWidth: 1920,
      sourceHeight: 1080,
      analyzedWidth: 640,
      analyzedHeight: 360,
      brightnessEstimate: phase === 'torch_on' ? 120 : 90,
      overexposedRatio: 0.01,
      sharpnessVariance: 50,
      sha256: 'a'.repeat(64),
      sizeBytes: 100_000,
      clusters: [{
        relativeX: x,
        relativeY: y,
        clusterSizePx: 20,
        compactness: 0.8,
        maxBrightness: brightness,
        saturation: 0.05,
      }],
    },
  };
}

describe('optical cluster persistence', () => {
  test('counts persistence only across distinct captured frames', () => {
    const frames = Array.from({ length: 8 }, (_, index) =>
      frame('torch_on', index, 50 + index * 0.05, 50 - index * 0.05, 245 + index),
    );

    const aggregated = aggregateOpticalPhase('torch_on', frames);
    expect(aggregated.frameCount).toBe(8);
    expect(aggregated.clusters).toHaveLength(1);
    expect(aggregated.clusters[0].persistedFrames).toBe(8);
  });

  test('does not merge spatially unrelated reflections into one persistent candidate', () => {
    const frames = [
      frame('torch_on', 1, 10, 10, 250),
      frame('torch_on', 2, 40, 40, 250),
      frame('torch_on', 3, 70, 70, 250),
      frame('torch_on', 4, 90, 20, 250),
    ];

    const aggregated = aggregateOpticalPhase('torch_on', frames);
    expect(aggregated.clusters).toHaveLength(4);
    expect(aggregated.clusters.every((cluster) => cluster.persistedFrames === 1)).toBe(true);
  });
});

describe('torch OFF/ON differential comparison', () => {
  test('returns measured brightness delta only for a spatially matched pair', () => {
    const off = aggregateOpticalPhase(
      'torch_off',
      Array.from({ length: 8 }, (_, index) => frame('torch_off', index, 50, 50, 190)),
    );
    const on = aggregateOpticalPhase(
      'torch_on',
      Array.from({ length: 8 }, (_, index) => frame('torch_on', index + 10, 50.4, 50.2, 245)),
    );

    const comparison = compareTorchPhases(off, on);
    expect(comparison.matchedClusterCount).toBe(1);
    expect(comparison.differentialDelta).toBe(55);
  });

  test('returns null differential when OFF and ON clusters are not spatially paired', () => {
    const off = aggregateOpticalPhase(
      'torch_off',
      Array.from({ length: 8 }, (_, index) => frame('torch_off', index, 15, 15, 190)),
    );
    const on = aggregateOpticalPhase(
      'torch_on',
      Array.from({ length: 8 }, (_, index) => frame('torch_on', index + 10, 80, 80, 245)),
    );

    const comparison = compareTorchPhases(off, on);
    expect(comparison.matchedClusterCount).toBe(0);
    expect(comparison.differentialDelta).toBeNull();
  });
});
