/**
 * body-parser.ts — Streaming body reader with hard size limit
 *
 * Cancels the read as soon as the accumulated size exceeds maxBytes,
 * even when Content-Length is absent, falsified, or the request is chunked.
 *
 * Does NOT rely on Content-Length header alone.
 */

import { PayloadTooLargeError, ValidationError } from './errors';

/**
 * Read the request body as a string, enforcing a hard byte limit during streaming.
 * Throws PayloadTooLargeError if the body exceeds maxBytes.
 * Throws ValidationError if the body is not valid JSON.
 */
export async function readBodyJson<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  // Reject early if Content-Length header is clearly oversized
  if (contentLength > maxBytes) {
    throw new PayloadTooLargeError(`Cuerpo demasiado grande (máx ${maxBytes} bytes).`);
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new ValidationError('Cuerpo de solicitud vacío.');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Cancel the stream immediately — do not continue reading
        await reader.cancel('payload_too_large');
        throw new PayloadTooLargeError(`Cuerpo demasiado grande (máx ${maxBytes} bytes).`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const raw = new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array(0)),
  );

  if (!raw.trim()) {
    throw new ValidationError('Cuerpo de solicitud vacío.');
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ValidationError('Cuerpo de solicitud no es JSON válido.');
  }
}
