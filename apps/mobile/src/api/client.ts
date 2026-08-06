/**
 * apps/mobile — API Client
 *
 * Cliente HTTP que envía observaciones crudas al servidor.
 * El servidor calcula riesgo, severidad, clasificación.
 *
 * Versión: 1.0.0
 */

import type {
  SubmitOpticalObservationRequest,
  SubmitMagneticObservationRequest,
  SubmitBleObservationRequest,
  SubmitNetworkObservationRequest,
  ObservationAnalysisResponse,
  CreateInspectionRequest,
  InspectionResponse,
} from '@liora/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://your-api.com';
const SESSION_KEY = '__liora_session';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getSessionToken(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_KEY);
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (token) headers['Cookie'] = `__Host-happyseeds_session=${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch { /* ignore */ }
    throw new ApiError(response.status, code, message);
  }

  const data = await response.json() as { success: boolean; data: T };
  return data.data;
}

// ── Inspecciones ───────────────────────────────────────────────────────────────

export async function createInspection(req: CreateInspectionRequest): Promise<InspectionResponse> {
  return apiFetch<InspectionResponse>('/api/scans', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function listInspections(): Promise<InspectionResponse[]> {
  return apiFetch<InspectionResponse[]>('/api/scans');
}

// ── Observaciones crudas → servidor calcula todo ───────────────────────────────

export async function submitOpticalObservation(
  req: SubmitOpticalObservationRequest,
): Promise<ObservationAnalysisResponse> {
  // Validar que no se envíen campos prohibidos
  assertNoForbiddenFields(req, ['riskLevel', 'severity', 'verdict', 'riskScore', 'confidence']);
  return apiFetch<ObservationAnalysisResponse>('/api/inspect/observations/optical', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function submitMagneticObservation(
  req: SubmitMagneticObservationRequest,
): Promise<ObservationAnalysisResponse> {
  assertNoForbiddenFields(req, ['riskLevel', 'severity', 'anomalyDetected']);
  return apiFetch<ObservationAnalysisResponse>('/api/inspect/observations/magnetic', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function submitBleObservation(
  req: SubmitBleObservationRequest,
): Promise<ObservationAnalysisResponse> {
  assertNoForbiddenFields(req, ['riskLevel', 'severity', 'isCamera']);
  return apiFetch<ObservationAnalysisResponse>('/api/inspect/observations/ble', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function submitNetworkObservation(
  req: SubmitNetworkObservationRequest,
): Promise<ObservationAnalysisResponse> {
  assertNoForbiddenFields(req, ['riskLevel', 'severity', 'cameraFound']);
  return apiFetch<ObservationAnalysisResponse>('/api/inspect/observations/network', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

function assertNoForbiddenFields(obj: object, forbidden: string[]): void {
  for (const f of forbidden) {
    if (f in obj) {
      throw new Error(`[API Client] Campo prohibido '${f}' — el servidor lo calcula.`);
    }
  }
}

export { ApiError };
