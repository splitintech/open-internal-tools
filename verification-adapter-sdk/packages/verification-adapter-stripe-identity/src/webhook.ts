import { ProviderError, type VerifiedWebhookEnvelope } from '@splitin/verification-adapter-sdk';

import { STRIPE_IDENTITY_EVENTS } from './constants.ts';
import { normalizeStripeIdentityStatus } from './status.ts';
import type { StripeIdentityEvent, StripeVerificationSession } from './types.ts';
import { isRecord, requireSession, sha256Hex, timingSafeEqualHex } from './util.ts';

export async function verifyStripeIdentityWebhook(
  request: Request,
  options: {
    secrets: readonly string[];
    toleranceSeconds: number;
    now: Date;
    crypto: Crypto;
    environment: 'sandbox' | 'production';
  },
): Promise<VerifiedWebhookEnvelope> {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength === 0 || rawBody.byteLength > 1_048_576) {
    throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity webhook body is invalid.', {
      safeCode: 'stripe_identity_webhook_body_invalid',
    });
  }
  const signature = parseStripeSignature(request.headers.get('stripe-signature'));
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (Math.abs(nowSeconds - signature.timestamp) > options.toleranceSeconds) {
    throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity webhook signature is stale.', {
      safeCode: 'stripe_identity_webhook_replay',
    });
  }
  const prefix = new TextEncoder().encode(`${signature.timestamp}.`);
  const signedPayload = new Uint8Array(prefix.length + rawBody.length);
  signedPayload.set(prefix);
  signedPayload.set(rawBody, prefix.length);
  let matched = false;
  for (const secret of options.secrets) {
    const digest = await hmacSha256Hex(options.crypto, secret, signedPayload);
    if (signature.v1.some((candidate) => timingSafeEqualHex(digest, candidate))) matched = true;
  }
  if (!matched) {
    throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity webhook signature is invalid.', {
      safeCode: 'stripe_identity_webhook_signature_invalid',
    });
  }
  const bodySha256 = await sha256Hex(options.crypto, rawBody);
  let providerEventKey = `stripe_${bodySha256}`;
  try {
    const parsed = parseStripeEvent(rawBody);
    assertLivemode(parsed.livemode, options.environment);
    providerEventKey = parsed.id;
  } catch (error) {
    if (!(error instanceof ProviderError) || error.safeCode !== 'stripe_webhook_payload_invalid') throw error;
  }
  return {
    providerEventKey,
    receivedAt: options.now.toISOString(),
    bodySha256,
    signatureIssuedAt: new Date(signature.timestamp * 1000).toISOString(),
    opaquePayload: rawBody,
  };
}

export function parseStripeEvent(rawBody: Uint8Array): StripeIdentityEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook payload is invalid.', {
      safeCode: 'stripe_webhook_payload_invalid',
    });
  }
  if (!isRecord(parsed)
    || typeof parsed.id !== 'string'
    || !/^evt_[A-Za-z0-9_]{8,252}$/.test(parsed.id)
    || typeof parsed.type !== 'string'
    || typeof parsed.created !== 'number'
    || typeof parsed.livemode !== 'boolean'
    || !isRecord(parsed.data)
    || !isRecord(parsed.data.object)) {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook event is invalid.', {
      safeCode: 'stripe_webhook_payload_invalid',
    });
  }
  return parsed as unknown as StripeIdentityEvent;
}

export function eventIsAllowlisted(eventType: string): boolean {
  return STRIPE_IDENTITY_EVENTS.has(eventType);
}

export function sessionFromEvent(event: StripeIdentityEvent): StripeVerificationSession {
  return requireSession(event.data.object);
}

export function normalizeAllowlistedEvent(event: StripeIdentityEvent) {
  const session = sessionFromEvent(event);
  const allowlisted = eventIsAllowlisted(event.type);
  return allowlisted
    ? normalizeStripeIdentityStatus(
      session.status,
      session.last_error?.code ?? null,
      event.type,
      session.redaction?.status ?? null,
    )
    : { canonicalStatus: 'manual_review_required' as const, reasonCodes: ['stripe_unknown_event'] };
}

function parseStripeSignature(value: string | null): { timestamp: number; v1: string[] } {
  if (!value || value.length > 4096) {
    throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity signature is missing.', {
      safeCode: 'stripe_identity_signature_missing',
    });
  }
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of value.split(',')) {
    const [key, candidate] = part.trim().split('=', 2);
    if (key === 't' && /^\d{1,16}$/.test(candidate ?? '')) timestamp = Number(candidate);
    if (key === 'v1' && /^[a-f0-9]{64}$/i.test(candidate ?? '')) v1.push((candidate ?? '').toLowerCase());
  }
  if (!timestamp || !Number.isSafeInteger(timestamp) || v1.length === 0) {
    throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity signature is invalid.', {
      safeCode: 'stripe_identity_signature_invalid',
    });
  }
  return { timestamp, v1 };
}

function assertLivemode(livemode: boolean, environment: 'sandbox' | 'production'): void {
  if (livemode !== (environment === 'production')) {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity mode does not match the pinned environment.', {
      safeCode: 'stripe_environment_mismatch',
    });
  }
}

async function hmacSha256Hex(crypto: Crypto, secret: string, payload: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
