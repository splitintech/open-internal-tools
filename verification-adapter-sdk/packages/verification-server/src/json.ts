import { VerificationHttpError } from './errors.ts';
import { FORBIDDEN_CLIENT_FIELDS } from './types.ts';

export type JsonRecord = Record<string, unknown>;

export function jsonResponse(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra,
  });
  if (typeof extra['Retry-After'] === 'string') headers.set('Retry-After', extra['Retry-After']);
  return new Response(JSON.stringify(body), { status, headers });
}

export async function readLimitedBody(request: Request, maxBodyBytes: number): Promise<Request> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return request;
  }
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > maxBodyBytes) {
    throw new VerificationHttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size.');
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: raw.byteLength > 0 ? raw : undefined,
  });
}

export async function parseJsonObject(
  request: Request,
  allowedKeys: readonly string[],
  options: { rejectRoutingFields?: boolean } = {},
): Promise<JsonRecord> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new VerificationHttpError(415, 'INVALID_REQUEST', 'Content-Type must be application/json.');
  }
  let body: unknown;
  try {
    const text = await request.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new VerificationHttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!isPlainRecord(body)) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Request body must be an object.');
  }
  for (const key of Object.keys(body)) {
  if (options.rejectRoutingFields && (FORBIDDEN_CLIENT_FIELDS as readonly string[]).includes(key)) {
      throw new VerificationHttpError(400, 'UNSUPPORTED_REQUEST_FIELD', `Unsupported request field: ${key}.`);
    }
    if (!allowedKeys.includes(key)) {
      throw new VerificationHttpError(400, 'UNSUPPORTED_REQUEST_FIELD', `Unsupported request field: ${key}.`);
    }
  }
  return body;
}

export function requiredString(body: JsonRecord, field: string, pattern: RegExp, maxLength: number): string {
  const value = body[field];
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maxLength) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', `Invalid ${field}.`);
  }
  return value;
}

export function optionalString(body: JsonRecord, field: string, pattern: RegExp, maxLength: number): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maxLength) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', `Invalid ${field}.`);
  }
  return value;
}

export function optionalBoolean(body: JsonRecord, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', `Invalid ${field}.`);
  }
  return value;
}

export function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
