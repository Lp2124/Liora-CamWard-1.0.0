import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOpticalObservation } from '../packages/detection-core/src/optical-classifier';

const lensCluster = {
  persistedFrames: 8,
  relativeX: 48,
  relativeY: 52,
  clusterSizePx: 24,
  compactness: 0.82,
  maxBrightness: 252,
  saturation: 0.04,
};

test('optical classifier does not compare 0-255 brightness directly to normalized overexposure threshold', () => {
  const result = classifyOpticalObservation({
    clusters: [],
    captureMode: 'torch_on',
    brightnessEstimate: 100,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: false,
    overexposedRatio: 0.01,
    sharpnessVariance: 80,
  });

  assert.equal(result.overexposed, false);
  assert.equal(result.blurDetected, false);
  assert.equal(result.verdict, 'clear');
  assert.match(result.explanation, /no descarta/u);
});

test('optical classifier rejects truly overexposed image using measured pixel ratio', () => {
  const result = classifyOpticalObservation({
    clusters: [lensCluster],
    captureMode: 'torch_on',
    brightnessEstimate: 220,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: true,
    differentialDelta: 45,
    overexposedRatio: 0.97,
    sharpnessVariance: 80,
  });

  assert.equal(result.overexposed, true);
  assert.equal(result.verdict, 'insufficient_evidence');
});

test('optical classifier derives blur only from measured sharpness, not from frame count', () => {
  const sharp = classifyOpticalObservation({
    clusters: [],
    captureMode: 'torch_on',
    brightnessEstimate: 120,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: false,
    overexposedRatio: 0.02,
    sharpnessVariance: 40,
  });
  const blurred = classifyOpticalObservation({
    clusters: [lensCluster],
    captureMode: 'torch_on',
    brightnessEstimate: 120,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: true,
    differentialDelta: 45,
    overexposedRatio: 0.02,
    sharpnessVariance: 2,
  });

  assert.equal(sharp.blurDetected, false);
  assert.equal(blurred.blurDetected, true);
  assert.equal(blurred.verdict, 'insufficient_evidence');
});

test('optical classifier cannot elevate a lens-like cluster without verified second capture', () => {
  const result = classifyOpticalObservation({
    clusters: [lensCluster],
    captureMode: 'torch_on',
    brightnessEstimate: 130,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: false,
    differentialDelta: 50,
    overexposedRatio: 0.01,
    sharpnessVariance: 90,
  });

  assert.equal(result.category, 'lens');
  assert.equal(result.verdict, 'review_required');
  assert.deepEqual(result.boundingBoxes, []);
});

test('optical classifier does not treat a darker torch-on response as corroboration', () => {
  const result = classifyOpticalObservation({
    clusters: [lensCluster],
    captureMode: 'torch_on',
    brightnessEstimate: 130,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: true,
    differentialDelta: -50,
    overexposedRatio: 0.01,
    sharpnessVariance: 90,
  });

  assert.equal(result.category, 'lens');
  assert.equal(result.verdict, 'review_required');
});

test('optical classifier elevates only when persistent lens-like signal has second capture and positive torch response', () => {
  const result = classifyOpticalObservation({
    clusters: [lensCluster],
    captureMode: 'torch_on',
    brightnessEstimate: 130,
    torchActive: true,
    frameCount: 8,
    hasSecondCapture: true,
    differentialDelta: 50,
    overexposedRatio: 0.01,
    sharpnessVariance: 90,
  });

  assert.equal(result.category, 'lens');
  assert.equal(result.verdict, 'suspected_device');
  assert.match(result.explanation, /aumento de brillo OFF→ON/u);
  assert.doesNotMatch(result.explanation, /confirmad[oa]/iu);
});
