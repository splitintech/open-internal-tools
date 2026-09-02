import { ProviderError, toSafeProviderFailure } from '@splitin/verification-adapter-sdk';

export const API_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'ORIGIN_NOT_ALLOWED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INVALID_IDEMPOTENCY_KEY',
  'INVALID_REQUEST',
  'UNSUPPORTED_REQUEST_FIELD',
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'SEPARATION_OF_DUTIES',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'VERIFICATION_REQUIRED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class VerificationHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'VerificationHttpError';
  }
}

const SECRET_PATTERN = /sk_|rk_|whsec_|client_secret|ephemeral|password|bearer\s+[a-z0-9._-]+/i;

export function scrubUnsafeMessage(value: string): string {
  if (SECRET_PATTERN.test(value) || /provider\s+body|raw\s+webhook/i.test(value)) {
    return 'The verification request could not be completed.';
  }
  return value;
}

export function toSafeErrorEnvelope(
  error: unknown,
  supportPath: string | null,
): { status: number; body: Record<string, unknown>; retryAfterSeconds: number | null } {
  if (error instanceof VerificationHttpError) {
    return {
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
      body: envelope(error.code, scrubUnsafeMessage(error.message), error.retryAfterSeconds, supportPath),
    };
  }
  if (error instanceof ProviderError) {
    const status = error.retryable ? (error.code === 'RATE_LIMITED' ? 429 : 503) : 409;
    return {
      status,
      retryAfterSeconds: error.retryAfterSeconds ?? null,
      body: envelope(error.safeCode, scrubUnsafeMessage(error.message), error.retryAfterSeconds ?? null, supportPath),
    };
  }
  const safe = toSafeProviderFailure(error);
  return {
    status: 503,
    retryAfterSeconds: safe.retryAfterSeconds ?? null,
    body: envelope(safe.safeCode, 'The verification request could not be completed.', safe.retryAfterSeconds ?? null, supportPath),
  };
}

function envelope(
  code: string,
  message: string,
  retryAfterSeconds: number | null,
  supportPath: string | null,
): Record<string, unknown> {
  return {
    contractVersion: '1.0.0',
    error: {
      code,
      message,
      retryable: retryAfterSeconds !== null || /retry|unavailable|rate/i.test(code),
    },
    safeErrorCode: code,
    retryAfter: retryAfterSeconds,
    supportPath,
  };
}
