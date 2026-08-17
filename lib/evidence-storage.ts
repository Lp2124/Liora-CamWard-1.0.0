import 'server-only';
import { createHash, createHmac } from 'crypto';

interface EvidenceStorageSettings {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PutEvidenceObjectInput {
  key: string;
  bytes: Uint8Array;
  mimeType: 'image/jpeg';
  sha256: string;
}

export async function putPrivateEvidenceObject(input: PutEvidenceObjectInput): Promise<void> {
  const settings = getSettings();
  validateObjectKey(input.key);

  const payloadHash = sha256Hex(input.bytes);
  if (payloadHash !== input.sha256) throw new Error('EVIDENCE_HASH_MISMATCH_BEFORE_UPLOAD');

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const objectPath = [settings.bucket, ...input.key.split('/')]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const basePath = settings.endpoint.pathname.replace(/\/$/u, '');
  const canonicalUri = `${basePath}/${objectPath}`.replace(/\/+/gu, '/');
  const url = new URL(settings.endpoint.toString());
  url.pathname = canonicalUri;
  url.search = '';

  const canonicalHeaders = [
    `content-type:${input.mimeType}`,
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n');
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${settings.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const dateKey = hmac(`AWS4${settings.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, settings.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': input.mimeType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
    body: input.bytes,
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`EVIDENCE_STORAGE_PUT_FAILED_${response.status}`);
  }
}

function getSettings(): EvidenceStorageSettings {
  const rawEndpoint = process.env.EVIDENCE_S3_ENDPOINT?.trim();
  const region = process.env.EVIDENCE_S3_REGION?.trim();
  const bucket = process.env.EVIDENCE_S3_BUCKET?.trim();
  const accessKeyId = process.env.EVIDENCE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.EVIDENCE_S3_SECRET_ACCESS_KEY?.trim();

  if (!rawEndpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('EVIDENCE_STORAGE_CONFIGURATION_MISSING');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) {
    throw new Error('EVIDENCE_STORAGE_BUCKET_INVALID');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error('EVIDENCE_STORAGE_ENDPOINT_INVALID');
  }

  const local = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost';
  if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
    throw new Error('EVIDENCE_STORAGE_ENDPOINT_MUST_USE_HTTPS');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('EVIDENCE_STORAGE_ENDPOINT_INVALID');
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function validateObjectKey(key: string): void {
  if (!/^[a-zA-Z0-9/_-]+\.jpg$/u.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error('EVIDENCE_OBJECT_KEY_INVALID');
  }
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, '');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
