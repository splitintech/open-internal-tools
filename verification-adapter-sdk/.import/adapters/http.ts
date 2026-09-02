import { getCorsHeaders, rateLimitCheck, validateRequest } from '../security.ts';

export type JsonRecord = Record<string, unknown>;

export function noStoreJson(request: Request, body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function noStoreError(
  request: Request,
  status: number,
  code: string,
  message: string,
  extraHeaders: HeadersInit = {},
  retryAfterSeconds: number | null = null,
): Response {
  return noStoreJson(request, {
    contractVersion: '2.0.0',
    error: { code, message },
    safeErrorCode: code,
    retryAfter: retryAfterSeconds,
    supportPath: '/support/verification',
  }, status, retryAfterSeconds === null ? extraHeaders : {
    ...extraHeaders,
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
}

export function preflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  try {
    requireAllowedOrigin(request);
  } catch {
    return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin' } });
  }
  return new Response(null, { headers: { ...getCorsHeaders(request), 'Cache-Control': 'no-store' } });
}

export async function parsePostBody(request: Request, allowedKeys: readonly string[]): Promise<JsonRecord> {
  if (request.method !== 'POST') {
    throw new VerificationHttpError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
  }
  requireAllowedOrigin(request);
  try {
    validateRequest(request);
  } catch {
    throw new VerificationHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new VerificationHttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  if (!isPlainRecord(body)) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Request body must be an object.');
  }
  for (const key of Object.keys(body)) {
    if (!allowedKeys.includes(key)) {
      // Reject authority-shaped fields such as provider, subject, user, role,
      // or organization rather than silently accepting or ignoring them.
      throw new VerificationHttpError(400, 'UNSUPPORTED_REQUEST_FIELD', `Unsupported request field: ${key}.`);
    }
  }
  return body;
}

export function requireAllowedOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  // Service-to-service requests authenticate independently and commonly have
  // no Origin header. Browser requests must match the reviewed exact allowlist.
  if (!origin) return;
  const configured = (Deno.env.get('CORS_ORIGINS') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const environment = Deno.env.get('ENVIRONMENT');
  const developmentDefaults = new Set([
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:5174', 'http://127.0.0.1:5174',
    'https://www.splitin.net', 'https://splitin.net',
  ]);
  const allowed = configured.length > 0
    ? configured.includes(origin)
    : environment !== 'production' && developmentDefaults.has(origin);
  if (!allowed) {
    throw new VerificationHttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
  }
}

export function requiredString(
  body: JsonRecord,
  field: string,
  pattern: RegExp,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maxLength) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', `Invalid ${field}.`);
  }
  return value;
}

export function requiredIdempotencyKey(body: JsonRecord, field = 'idempotencyKey'): string {
  return requiredString(
    body,
    field,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    36,
  );
}

export function optionalString(
  body: JsonRecord,
  field: string,
  pattern: RegExp,
  maxLength: number,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !pattern.test(value) || value.length > maxLength) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', `Invalid ${field}.`);
  }
  return value;
}

export async function requireVerificationRateLimit(userId: string, endpoint: string): Promise<void> {
  const allowed = await rateLimitCheck(userId, endpoint);
  if (!allowed) {
    throw new VerificationHttpError(429, 'RATE_LIMIT_EXCEEDED', 'Please wait before trying verification again.');
  }
}

export class VerificationHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'VerificationHttpError';
  }
}

export function asVerificationHttpError(error: unknown): VerificationHttpError {
  if (error instanceof VerificationHttpError) return error;
  if (error instanceof Error && error.name === 'ProviderUnavailableError') {
    return new VerificationHttpError(
      503,
      'VERIFICATION_PROVIDER_UNAVAILABLE',
      'Verification is temporarily unavailable.',
      30,
    );
  }
  if (error instanceof Error && error.name === 'ProviderOperationPendingError') {
    return new VerificationHttpError(409, 'VERIFICATION_PROVIDER_OPERATION_PENDING', 'Verification is already being prepared. Please retry shortly.');
  }
  if (error instanceof Error && error.name === 'VerificationAttemptLimitError') {
    const retryAfter = Number((error as Error & { retryAfterSeconds?: number }).retryAfterSeconds);
    return new VerificationHttpError(
      429,
      'VERIFICATION_ATTEMPT_LIMIT',
      'You have reached the identity verification session limit. Resume an existing session or try again later.',
      Number.isFinite(retryAfter) ? Math.max(1, retryAfter) : null,
    );
  }
  if (error instanceof Error && error.name === 'ProviderRequiredInformationError') {
    return new VerificationHttpError(422, 'VERIFICATION_REQUIRED_INFORMATION_MISSING', 'Add the required legal business information before continuing.');
  }
  if (error instanceof Error && error.name === 'ProviderError') {
    const providerError = error as Error & {
      code?: string;
      retryable?: boolean;
      safeCode?: string;
      retryAfterSeconds?: number;
    };
    const retryAfter = Number.isSafeInteger(providerError.retryAfterSeconds)
      ? Math.max(1, Number(providerError.retryAfterSeconds))
      : providerError.retryable ? 30 : null;
    if (providerError.code === 'SIGNATURE_INVALID') {
      return new VerificationHttpError(401, 'VERIFICATION_WEBHOOK_SIGNATURE_INVALID', 'Webhook authentication failed.');
    }
    if (providerError.code === 'INVALID_CONFIGURATION' || providerError.code === 'AUTHENTICATION_FAILED') {
      return new VerificationHttpError(
        503,
        'VERIFICATION_CONFIGURATION_MISMATCH',
        'Verification configuration is temporarily unavailable.',
        retryAfter,
      );
    }
    if (providerError.code === 'RATE_LIMITED') {
      return new VerificationHttpError(
        503,
        'VERIFICATION_PROVIDER_RATE_LIMITED',
        'Verification is temporarily busy.',
        retryAfter,
      );
    }
    if (providerError.code === 'TIMEOUT' || providerError.code === 'RETRYABLE_PROVIDER_FAILURE') {
      const isProcessing = providerError.safeCode?.includes('processing') === true;
      return new VerificationHttpError(
        isProcessing ? 409 : 503,
        isProcessing ? 'VERIFICATION_PROCESSING' : 'VERIFICATION_PROVIDER_UNAVAILABLE',
        isProcessing ? 'Verification is still processing.' : 'Verification is temporarily unavailable.',
        retryAfter,
      );
    }
    if (providerError.code === 'UNKNOWN_PROVIDER_STATUS') {
      return new VerificationHttpError(
        409,
        'VERIFICATION_MANUAL_REVIEW',
        'Verification needs review before it can continue.',
      );
    }
    if (providerError.code === 'TERMINAL_INPUT_FAILURE') {
      const safeCode = providerError.safeCode ?? '';
      if (safeCode.includes('under_supported_age') || safeCode.includes('underage')) {
        return new VerificationHttpError(422, 'VERIFICATION_UNDERAGE', 'This account does not meet the age requirement.');
      }
      if (safeCode.includes('redacted')) {
        return new VerificationHttpError(409, 'VERIFICATION_REDACTED', 'This verification session was redacted.');
      }
      if (safeCode.includes('canceled')) {
        return new VerificationHttpError(409, 'VERIFICATION_CANCELED', 'This verification session was canceled.');
      }
      if (safeCode.includes('consent') || safeCode.includes('selfie')) {
        return new VerificationHttpError(422, 'VERIFICATION_MANUAL_REVIEW', 'Use the verification support path for an alternative review.');
      }
      return new VerificationHttpError(
        422,
        'VERIFICATION_REQUIRES_INPUT',
        'The verification information needs attention before continuing.',
      );
    }
    return new VerificationHttpError(
      providerError.retryable ? 503 : 502,
      'VERIFICATION_PROVIDER_OPERATION_FAILED',
      'The verification provider could not complete this request.',
      retryAfter,
    );
  }
  return new VerificationHttpError(500, 'VERIFICATION_ORCHESTRATION_ERROR', 'Unable to start verification right now.');
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
