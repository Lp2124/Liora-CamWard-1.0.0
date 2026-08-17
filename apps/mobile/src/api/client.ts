/**
 * Liora CamWard — mobile API client.
 *
 * The client submits raw observations only. Authentication is cookie-based when
 * a valid native/web session exists; no bearer/session token is stored in
 * AsyncStorage.
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

class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConfigurationError';
  }
}

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

function getApiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!configured) {
    throw new ApiConfigurationError('EXPO_PUBLIC_API_URL no está configurada.');
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiConfigurationError('EXPO_PUBLIC_API_URL no es una URL válida.');
  }

  const isLocalDev = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !isLocalDev) {
    throw new ApiConfigurationError('EXPO_PUBLIC_API_URL debe usar HTTPS fuera de desarrollo local.');
  }

  return url.origin;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Preserve the HTTP status when the response body is not JSON.
    }
    throw new ApiError(response.status, code, message);
  }

  const envelope = (await response.json()) as { success?: boolean; data?: T };
  if (envelope.success !== true || envelope.data === undefined) {
    throw new ApiError(response.status, 'INVALID_API_RESPONSE', 'Respuesta API inválida.');
  }
  return envelope.data;
}

export async function createInspection(req: CreateInspectionRequest): Promise<InspectionResponse> {
  return apiFetch<InspectionResponse>('/api/scans', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function listInspections(): Promise<InspectionResponse[]> {
  return apiFetch<InspectionResponse[]>('/api/scans');
}

export async function submitOpticalObservation(
  req: SubmitOpticalObservationRequest,
): Promise<ObservationAnalysisResponse> {
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

function assertNoForbiddenFields(obj: object, forbidden: readonly string[]): void {
  for (const field of forbidden) {
    if (field in obj) {
      throw new Error(`[API Client] Campo prohibido '${field}'; la autoridad es el servidor.`);
    }
  }
}

export { ApiConfigurationError, ApiError };
