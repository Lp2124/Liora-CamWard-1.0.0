/**
 * Liora CamWard — mobile API client.
 *
 * The client submits raw observations only. Authentication is cookie-based when
 * a valid native/web session exists; no bearer/session token is stored in
 * AsyncStorage.
 */
import { File } from 'expo-file-system/next';
import type {
  SubmitOpticalObservationRequest,
  SubmitMagneticObservationRequest,
  SubmitBleObservationRequest,
  SubmitNetworkObservationRequest,
  ObservationAnalysisResponse,
  CreateInspectionRequest,
  InspectionResponse,
  UploadOpticalEvidenceResponse,
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

  return readApiResponse<T>(response);
}

async function readApiResponse<T>(response: Response): Promise<T> {
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

export async function uploadOpticalEvidence(input: {
  inspectionId: string;
  captureNonce: string;
  phase: 'torch_off' | 'torch_on';
  uri: string;
  expectedSha256: string;
  expectedSizeBytes: number;
}): Promise<UploadOpticalEvidenceResponse> {
  const localFile = new File(input.uri);
  if (!localFile.exists) throw new Error('OPTICAL_LOCAL_FILE_NOT_FOUND');
  if (localFile.size !== input.expectedSizeBytes) {
    throw new Error('OPTICAL_LOCAL_FILE_SIZE_CHANGED');
  }
  const blob = await localFile.blob();
  if (blob.size !== input.expectedSizeBytes) {
    throw new Error('OPTICAL_LOCAL_BLOB_SIZE_CHANGED');
  }

  const query = new URLSearchParams({
    inspectionId: input.inspectionId,
    captureNonce: input.captureNonce,
    phase: input.phase,
  });
  const response = await fetch(`${getApiBase()}/api/inspect/evidence/optical?${query.toString()}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'image/jpeg',
    },
    body: blob,
    credentials: 'include',
  });
  const result = await readApiResponse<UploadOpticalEvidenceResponse>(response);

  if (result.sha256 !== input.expectedSha256 || result.sizeBytes !== input.expectedSizeBytes) {
    throw new Error('OPTICAL_EVIDENCE_SERVER_HASH_MISMATCH');
  }
  return result;
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
