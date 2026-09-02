import { ProviderError, ProviderRequiredInformationError } from '@splitin/verification-adapter-sdk';

import type { StripeVerificationSession } from './types.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireSession(value: unknown): StripeVerificationSession {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^vs_[A-Za-z0-9_]{8,252}$/.test(value.id)
    || typeof value.status !== 'string'
    || typeof value.created !== 'number'
    || typeof value.livemode !== 'boolean') {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Stripe Identity returned an invalid session.', {
      safeCode: 'malformed_provider_response',
    });
  }
  return value as unknown as StripeVerificationSession;
}

export function encodeSessionId(value: string): string {
  if (!/^vs_[A-Za-z0-9_]{8,252}$/.test(value)) throw new ProviderRequiredInformationError('Stripe Identity session id is invalid.');
  return encodeURIComponent(value);
}

export function safeClientSecret(value: unknown): string | undefined {
  return typeof value === 'string' && /^vs_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(value) ? value : undefined;
}

export function safeStripeHostedUrl(value: unknown, hostedHost: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostedHost && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ProviderRequiredInformationError();
  }
  return normalized;
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Math.min(Number(value), 3600);
}

export function isoExpiry(observedAt: Date, ttlSeconds: number): string {
  return new Date(observedAt.getTime() + ttlSeconds * 1000).toISOString();
}

export async function sha256Hex(crypto: Crypto, payload: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(payload)));
  return toHex(digest);
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index)! ^ right.charCodeAt(index)!;
  }
  return difference === 0;
}

export function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mapProviderHttpError(status: number, retryAfterHeader: string | null, providerLabel: string): ProviderError {
  const retryAfter = parseRetryAfter(retryAfterHeader);
  const code = status === 401 || status === 403 ? 'AUTHENTICATION_FAILED'
    : status === 429 ? 'RATE_LIMITED'
      : status === 408 || status === 504 ? 'TIMEOUT'
        : status >= 500 ? 'RETRYABLE_PROVIDER_FAILURE' : 'TERMINAL_INPUT_FAILURE';
  const prefix = providerLabel.replace(/[^a-z0-9]+/g, '_');
  return new ProviderError(code, `${providerLabel} request failed.`, {
    retryable: status === 408 || status === 429 || status >= 500,
    retryAfterSeconds: retryAfter,
    safeCode: code === 'AUTHENTICATION_FAILED' ? `${prefix}_authentication_failed`
      : code === 'RATE_LIMITED' ? `${prefix}_rate_limited`
        : code === 'TIMEOUT' ? `${prefix}_timeout`
          : code === 'RETRYABLE_PROVIDER_FAILURE' ? `${prefix}_provider_failure`
            : `${prefix}_terminal_input_failure`,
  });
}
