/**
 * @liora/testing — Security Test Cases
 *
 * Fase 15: Pruebas de seguridad.
 * Casos de prueba para ataques conocidos según el prompt.
 *
 * Versión: 1.0.0
 */

export interface SecurityTestCase {
  name: string;
  description: string;
  attackVector: string;
  expectedStatus: number;
  expectedErrorCode: string;
  requestBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}

// ── Evidencia fabricada por cliente ───────────────────────────────────────────

export const CLIENT_AUTHORITY_TESTS: SecurityTestCase[] = [
  {
    name: 'client_sends_riskLevel',
    description: 'Cliente intenta enviar riskLevel en observación óptica',
    attackVector: 'IDOR / autoridad de cliente',
    expectedStatus: 400,
    expectedErrorCode: 'VALIDATION_ERROR',
    requestBody: {
      inspectionId: 'test-inspection-id',
      captureNonce: 'test-nonce',
      clientTimestamp: new Date().toISOString(),
      captureMode: 'torch_on',
      brightnessEstimate: 0.5,
      torchActive: true,
      orientation: { alpha: 0, beta: 0, gamma: 0 },
      clusterData: [],
      frameCount: 10,
      deviceFingerprint: 'test-device',
      riskLevel: 'critical', // PROHIBIDO — debe rechazarse
    },
  },
  {
    name: 'client_sends_severity',
    description: 'Cliente intenta enviar severity en observación',
    attackVector: 'Manipulación de severidad',
    expectedStatus: 400,
    expectedErrorCode: 'VALIDATION_ERROR',
    requestBody: {
      inspectionId: 'test',
      captureNonce: 'test',
      clientTimestamp: new Date().toISOString(),
      captureMode: 'normal',
      brightnessEstimate: 0.5,
      torchActive: false,
      orientation: { alpha: 0, beta: 0, gamma: 0 },
      clusterData: [],
      frameCount: 5,
      deviceFingerprint: 'test',
      severity: 'high', // PROHIBIDO
    },
  },
  {
    name: 'client_sends_verdict',
    description: 'Cliente intenta enviar verdict directamente',
    attackVector: 'Manipulación de clasificación',
    expectedStatus: 400,
    expectedErrorCode: 'VALIDATION_ERROR',
    requestBody: {
      inspectionId: 'test',
      captureNonce: 'test',
      clientTimestamp: new Date().toISOString(),
      captureMode: 'torch_on',
      brightnessEstimate: 0.5,
      torchActive: true,
      orientation: { alpha: 0, beta: 0, gamma: 0 },
      clusterData: [],
      frameCount: 10,
      deviceFingerprint: 'test',
      verdict: 'confirmed_device', // PROHIBIDO
    },
  },
];

// ── Race condition en códigos premium ─────────────────────────────────────────

export const RACE_CONDITION_TESTS: SecurityTestCase[] = [
  {
    name: 'concurrent_code_redemption',
    description: 'Dos usuarios intentan canjear el mismo código simultáneamente',
    attackVector: 'Race condition en redención de código',
    expectedStatus: 400,
    expectedErrorCode: 'CODE_ALREADY_USED',
    // Solo uno de los dos debe tener éxito — el UPDATE atómico garantiza esto
    requestBody: { code: 'CAMWARD-TEST-CODE-RACE' },
  },
];

// ── Oversized body ─────────────────────────────────────────────────────────────

export const BODY_SIZE_TESTS: SecurityTestCase[] = [
  {
    name: 'oversized_magnetic_samples',
    description: 'Array de muestras magnéticas con 100k elementos',
    attackVector: 'DoS por cuerpo excesivo',
    expectedStatus: 413,
    expectedErrorCode: 'PAYLOAD_TOO_LARGE',
    requestBody: {
      inspectionId: 'test',
      captureNonce: 'test',
      clientTimestamp: new Date().toISOString(),
      phase: 'monitoring',
      samples: Array.from({ length: 100000 }, (_, i) => ({ x: i, y: i, z: i, magnitude: i, ts: i })),
      orientation: { alpha: 0, beta: 0, gamma: 0 },
      deviceFingerprint: 'test',
    },
  },
  {
    name: 'deeply_nested_json',
    description: 'JSON con 1000 niveles de anidación',
    attackVector: 'JSON bomb / stack overflow',
    expectedStatus: 400,
    expectedErrorCode: 'VALIDATION_ERROR',
    // El JSON se construye dinámicamente en el runner de pruebas
  },
];

// ── MIME spoofing ──────────────────────────────────────────────────────────────

export const MIME_TESTS: SecurityTestCase[] = [
  {
    name: 'mime_spoofing_exe_as_image',
    description: 'Archivo EXE con Content-Type: image/jpeg',
    attackVector: 'MIME spoofing',
    expectedStatus: 400,
    expectedErrorCode: 'INVALID_MIME_TYPE',
    headers: { 'Content-Type': 'image/jpeg' },
    // body = bytes de un EXE embebidos en campo de imagen
  },
];

// ── Unauthenticated access ─────────────────────────────────────────────────────

export const AUTH_TESTS: SecurityTestCase[] = [
  {
    name: 'no_session_cookie',
    description: 'Request sin cookie de sesión a endpoint protegido',
    attackVector: 'Acceso no autenticado',
    expectedStatus: 401,
    expectedErrorCode: 'UNAUTHORIZED',
    requestBody: { inspectionId: 'test', captureNonce: 'test', clientTimestamp: 'test' },
  },
  {
    name: 'invalid_session_token',
    description: 'Cookie de sesión con token inválido/expirado',
    attackVector: 'Token inválido',
    expectedStatus: 401,
    expectedErrorCode: 'UNAUTHORIZED',
    headers: { Cookie: '__Host-happyseeds_session=invalid.token.here' },
  },
];

/** Genera el cuerpo JSON anidado profundamente para prueba de JSON bomb */
export function generateDeeplyNestedJson(depth: number): Record<string, unknown> {
  let obj: Record<string, unknown> = { value: 'leaf' };
  for (let i = 0; i < depth; i++) {
    obj = { nested: obj };
  }
  return obj;
}

/** Exporta todos los casos de prueba para el runner */
export const ALL_SECURITY_TESTS = [
  ...CLIENT_AUTHORITY_TESTS,
  ...RACE_CONDITION_TESTS,
  ...BODY_SIZE_TESTS,
  ...MIME_TESTS,
  ...AUTH_TESTS,
];
