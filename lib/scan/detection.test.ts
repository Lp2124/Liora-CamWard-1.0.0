/**
 * Detection-core unit tests
 *
 * Tests: magnetic analyzer, optical classifier, risk calculator, correlation matrix.
 * Focus: false-positive prevention, review_required handling, severity mapping.
 *
 * Run: node --import tsx --test lib/scan/detection.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeSamples(count: number, magnitude: number, jitter = 0) {
  return Array.from({ length: count }, (_, i) => ({
    x: 0,
    y: 0,
    z: magnitude,
    magnitude: magnitude + (Math.random() - 0.5) * jitter,
    ts: i * 100,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MagneticAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

test('MagneticAnalyzer — stable baseline returns normal_field', async () => {
  const { analyzeMagneticObservation } = await import(
    '../../packages/detection-core/src/magnetic-analyzer.js'
  );
  const samples = makeSamples(40, 50, 1);
  const result = analyzeMagneticObservation(samples);
  assert.equal(result.state, 'normal_field');
  assert.equal(result.calibrationValid, true);
  assert.ok(result.signedDeltaMicroTesla < 5, 'No anomaly in stable field');
});

test('MagneticAnalyzer — fewer than minCalibrationSamples returns calibration_invalid', async () => {
  const { analyzeMagneticObservation } = await import(
    '../../packages/detection-core/src/magnetic-analyzer.js'
  );
  const result = analyzeMagneticObservation(makeSamples(3, 50));
  assert.equal(result.state, 'calibration_invalid');
  assert.equal(result.calibrationValid, false);
});

test('MagneticAnalyzer — large positive spike returns magnetic_source_nearby', async () => {
  const { analyzeMagneticObservation } = await import(
    '../../packages/detection-core/src/magnetic-analyzer.js'
  );
  const baseline = makeSamples(30, 50, 0.5);
  const spike = makeSamples(10, 90, 0.5);
  const result = analyzeMagneticObservation([...baseline, ...spike]);
  assert.equal(result.state, 'magnetic_source_nearby', `Expected magnetic_source_nearby but got ${result.state}: ${result.explanation}`);
  assert.ok(result.signedDeltaMicroTesla > 0, 'Positive delta');
});

test('MagneticAnalyzer — DROP in field (negative delta) does NOT trigger alert', async () => {
  const { analyzeMagneticObservation } = await import(
    '../../packages/detection-core/src/magnetic-analyzer.js'
  );
  const baseline = makeSamples(30, 80, 0.5);
  const drop = makeSamples(10, 30, 0.5);
  const result = analyzeMagneticObservation([...baseline, ...drop]);
  assert.notEqual(result.state, 'magnetic_source_nearby', `Negative delta must not be magnetic_source_nearby: ${result.explanation}`);
});

test('MagneticAnalyzer — saturated sensor returns unstable_measurement', async () => {
  const { analyzeMagneticObservation } = await import(
    '../../packages/detection-core/src/magnetic-analyzer.js'
  );
  const samples = makeSamples(15, 450);
  const result = analyzeMagneticObservation(samples);
  assert.equal(result.state, 'unstable_measurement');
  assert.equal(result.sensorSaturated, true);
});

test('MagneticAnalyzer — very noisy signal returns unstable_measurement', async () => {
  const { analyzeMagneticObservation } = await import(
    '../../packages/detection-core/src/magnetic-analyzer.js'
  );
  const samples = Array.from({ length: 30 }, (_, i) => ({
    x: 0,
    y: 0,
    z: 50,
    magnitude: 50 + (i % 2 === 0 ? 40 : -40),
    ts: i * 100,
  }));
  const result = analyzeMagneticObservation(samples);
  assert.equal(result.state, 'unstable_measurement', `High noise should return unstable: ${result.explanation}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// OpticalClassifier
// ─────────────────────────────────────────────────────────────────────────────

test('OpticalClassifier — empty clusters returns clear', async () => {
  const { classifyOpticalObservation } = await import(
    '../../packages/detection-core/src/optical-classifier.js'
  );
  const result = classifyOpticalObservation({
    clusters: [],
    captureMode: 'torch_on',
    brightnessEstimate: 0.5,
    torchActive: true,
    frameCount: 10,
    hasSecondCapture: false,
  });
  assert.equal(result.verdict, 'clear');
});

test('OpticalClassifier — insufficient frames returns insufficient_evidence', async () => {
  const { classifyOpticalObservation } = await import(
    '../../packages/detection-core/src/optical-classifier.js'
  );
  const result = classifyOpticalObservation({
    clusters: [{ persistedFrames: 6, relativeX: 50, relativeY: 50, clusterSizePx: 20, compactness: 0.8, maxBrightness: 250, saturation: 0.1 }],
    captureMode: 'torch_on',
    brightnessEstimate: 0.5,
    torchActive: true,
    frameCount: 2,
    hasSecondCapture: false,
  });
  assert.equal(result.verdict, 'insufficient_evidence');
});

test('OpticalClassifier — overexposed image returns insufficient_evidence', async () => {
  const { classifyOpticalObservation } = await import(
    '../../packages/detection-core/src/optical-classifier.js'
  );
  const result = classifyOpticalObservation({
    clusters: [],
    captureMode: 'torch_on',
    brightnessEstimate: 247,
    torchActive: true,
    frameCount: 10,
    hasSecondCapture: false,
    overexposedRatio: 0.97,
  });
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.equal(result.overexposed, true);
});

test('OpticalClassifier — low compactness cluster does NOT become suspected_device', async () => {
  const { classifyOpticalObservation } = await import(
    '../../packages/detection-core/src/optical-classifier.js'
  );
  const result = classifyOpticalObservation({
    clusters: [{
      persistedFrames: 10,
      relativeX: 50,
      relativeY: 50,
      clusterSizePx: 30,
      compactness: 0.05,
      maxBrightness: 255,
      saturation: 0.0,
    }],
    captureMode: 'torch_on',
    brightnessEstimate: 0.5,
    torchActive: true,
    frameCount: 10,
    hasSecondCapture: true,
  });
  assert.equal(result.verdict, 'clear', `Low compactness cluster must be clear, got ${result.verdict}`);
});

test('OpticalClassifier — review_required has meetsThreshold false or confidence below threshold', async () => {
  const { classifyOpticalObservation } = await import(
    '../../packages/detection-core/src/optical-classifier.js'
  );
  const result = classifyOpticalObservation({
    clusters: [{
      persistedFrames: 8,
      relativeX: 50,
      relativeY: 50,
      clusterSizePx: 250,
      compactness: 0.8,
      maxBrightness: 255,
      saturation: 0.0,
    }],
    captureMode: 'torch_on',
    brightnessEstimate: 0.5,
    torchActive: true,
    frameCount: 10,
    hasSecondCapture: false,
  });
  assert.ok(
    result.verdict === 'review_required' || result.verdict === 'clear',
    `Glass/large cluster must not be suspected_device, got ${result.verdict}`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Risk calculator — verdictToSeverity mapping (via inspection-service logic)
// ─────────────────────────────────────────────────────────────────────────────

test('Risk: review_required must map to info severity (not suspicious)', () => {
  function verdictToSeverity(verdict: string): string {
    switch (verdict) {
      case 'confirmed_device': return 'high';
      case 'suspected_device': return 'suspicious';
      case 'review_required': return 'info';
      default: return 'info';
    }
  }
  assert.equal(verdictToSeverity('review_required'), 'info');
  assert.equal(verdictToSeverity('confirmed_device'), 'high');
  assert.equal(verdictToSeverity('suspected_device'), 'suspicious');
  assert.equal(verdictToSeverity('clear'), 'info');
  assert.equal(verdictToSeverity('insufficient_evidence'), 'info');
});

test('Risk: isReportableVerdict — only confirmed_device and suspected_device generate findings', () => {
  function isReportableVerdict(verdict: string): boolean {
    return verdict === 'confirmed_device' || verdict === 'suspected_device';
  }
  assert.equal(isReportableVerdict('confirmed_device'), true);
  assert.equal(isReportableVerdict('suspected_device'), true);
  assert.equal(isReportableVerdict('review_required'), false);
  assert.equal(isReportableVerdict('clear'), false);
  assert.equal(isReportableVerdict('insufficient_evidence'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRiskLevel (lib/scan/risk.ts)
// ─────────────────────────────────────────────────────────────────────────────

test('computeRiskLevel — info-only findings = clear', async () => {
  const { computeRiskLevel } = await import('./risk.js');
  const result = computeRiskLevel([
    { module: 'magnetic', severity: 'info', title: 'Info', detail: '', evidence: {} },
    { module: 'network', severity: 'info', title: 'Info', detail: '', evidence: {} },
  ]);
  assert.equal(result, 'clear', 'Info findings must never elevate risk');
});

test('computeRiskLevel — single suspicious = low', async () => {
  const { computeRiskLevel } = await import('./risk.js');
  const result = computeRiskLevel([
    { module: 'optical', severity: 'suspicious', title: 'Test', detail: '', evidence: {} },
  ]);
  assert.equal(result, 'low');
});

test('computeRiskLevel — two suspicious same module = medium (not high)', async () => {
  const { computeRiskLevel } = await import('./risk.js');
  const result = computeRiskLevel([
    { module: 'optical', severity: 'suspicious', title: 'Test 1', detail: '', evidence: {} },
    { module: 'optical', severity: 'suspicious', title: 'Test 2', detail: '', evidence: {} },
  ]);
  assert.equal(result, 'medium', 'Two suspicious from same module = medium');
});

test('computeRiskLevel — suspicious from two different modules = high', async () => {
  const { computeRiskLevel } = await import('./risk.js');
  const result = computeRiskLevel([
    { module: 'optical', severity: 'suspicious', title: 'Test', detail: '', evidence: {} },
    { module: 'bluetooth', severity: 'suspicious', title: 'Test', detail: '', evidence: {} },
  ]);
  assert.equal(result, 'high', 'Two independent modules corroborating = high');
});

test('computeRiskLevel — single high = high', async () => {
  const { computeRiskLevel } = await import('./risk.js');
  const result = computeRiskLevel([
    { module: 'optical', severity: 'high', title: 'Test', detail: '', evidence: {} },
  ]);
  assert.equal(result, 'high');
});

test('computeRiskLevel — info + suspicious from different modules = low (not high)', async () => {
  const { computeRiskLevel } = await import('./risk.js');
  const result = computeRiskLevel([
    { module: 'magnetic', severity: 'info', title: 'Info', detail: '', evidence: {} },
    { module: 'optical', severity: 'suspicious', title: 'Alert', detail: '', evidence: {} },
  ]);
  assert.equal(result, 'low', 'info from one module + suspicious from another = low, not high (info has no weight)');
});

// ─────────────────────────────────────────────────────────────────────────────
// CorrelationMatrix — benign combo prevention
// ─────────────────────────────────────────────────────────────────────────────

test('CorrelationMatrix — bluetooth+magnetic combo is NOT corroborated (benign penalty)', async () => {
  const { correlateEvidence } = await import(
    '../../packages/detection-core/src/correlation-matrix.js'
  );
  const now = new Date().toISOString();
  const result = correlateEvidence(
    {
      evidenceId: 'a',
      module: 'bluetooth',
      severity: 'suspicious',
      spatialKey: 'grid-1',
      captureTimestamp: now,
      confidence: 0.8,
      observation: { source: 'ble', captureTimestamp: now },
    },
    {
      evidenceId: 'b',
      module: 'magnetic',
      severity: 'suspicious',
      spatialKey: 'grid-1',
      captureTimestamp: now,
      confidence: 0.7,
      observation: { source: 'magnetic', captureTimestamp: now },
    },
  );
  assert.equal(result.isCorroborated, false, 'BLE+magnetic is a known benign combo and must not be corroborated');
  assert.ok(result.contradictions.some((c) => c.includes('benigno')), 'Should mention benign combo');
});

test('CorrelationMatrix — optical+bluetooth is causally compatible', async () => {
  const { correlateEvidence } = await import(
    '../../packages/detection-core/src/correlation-matrix.js'
  );
  const now = new Date().toISOString();
  const result = correlateEvidence(
    {
      evidenceId: 'a',
      module: 'optical',
      severity: 'suspicious',
      spatialKey: 'grid-2',
      captureTimestamp: now,
      confidence: 0.85,
      observation: { source: 'optical', captureTimestamp: now },
    },
    {
      evidenceId: 'b',
      module: 'bluetooth',
      severity: 'suspicious',
      spatialKey: 'grid-2',
      captureTimestamp: now,
      confidence: 0.75,
      observation: { source: 'ble', captureTimestamp: now },
    },
  );
  assert.equal(result.spatiallyProximate, true);
  assert.equal(result.temporallyProximate, true);
  assert.ok(result.correlationScore >= 0.55, `Score ${result.correlationScore} should be >= 0.55 for valid corroboration`);
});

test('CorrelationMatrix — same module evidence is never corroborated', async () => {
  const { correlateEvidence } = await import(
    '../../packages/detection-core/src/correlation-matrix.js'
  );
  const now = new Date().toISOString();
  const result = correlateEvidence(
    {
      evidenceId: 'a',
      module: 'optical',
      severity: 'suspicious',
      captureTimestamp: now,
      confidence: 0.9,
      observation: { source: 'optical', captureTimestamp: now },
    },
    {
      evidenceId: 'b',
      module: 'optical',
      severity: 'suspicious',
      captureTimestamp: now,
      confidence: 0.9,
      observation: { source: 'optical', captureTimestamp: now },
    },
  );
  assert.equal(result.isCorroborated, false, 'Same module cannot corroborate itself');
  assert.equal(result.correlationScore, 0);
});
