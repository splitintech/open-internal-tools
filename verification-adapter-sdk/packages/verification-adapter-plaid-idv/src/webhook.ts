import { decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from 'jose';

import { ProviderError } from '@splitin/verification-adapter-sdk';

import { constantTimeEqual, sha256Hex } from './webhook-crypto.ts';
import {
  PlaidWebhookVerificationError,
  assertKeyId,
  validatePlaidJwk,
  type PlaidVerificationJwk,
} from './webhook-key-cache.ts';

export interface VerifyPlaidWebhookOptions {
  rawBody: Uint8Array;
  verificationHeader: string | null;
  getKey: (keyId: string) => Promise<PlaidVerificationJwk>;
  crypto: Crypto;
  nowMs?: number;
  maxTokenAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
}

export async function verifyPlaidWebhook(options: VerifyPlaidWebhookOptions): Promise<{
  bodySha256: string;
  issuedAt: number;
  keyId: string;
}> {
  try {
    return await verifyPlaidWebhookInner(options);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const code = error instanceof PlaidWebhookVerificationError ? error.code : 'INVALID_SIGNATURE';
    const retryable = code === 'KEY_FETCH_FAILED';
    throw new ProviderError(
      retryable ? 'RETRYABLE_PROVIDER_FAILURE' : 'SIGNATURE_INVALID',
      'Plaid webhook signature is invalid.',
      {
        retryable,
        safeCode: `plaid_webhook_${code.toLowerCase()}`,
        cause: error,
      },
    );
  }
}

async function verifyPlaidWebhookInner(options: VerifyPlaidWebhookOptions): Promise<{
  bodySha256: string;
  issuedAt: number;
  keyId: string;
}> {
  const token = options.verificationHeader?.trim();
  if (!token) {
    throw new PlaidWebhookVerificationError('MISSING_HEADER', 'Missing Plaid-Verification header');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new PlaidWebhookVerificationError('MALFORMED_JWT', 'Malformed webhook verification token');
  }

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new PlaidWebhookVerificationError('MALFORMED_JWT', 'Malformed webhook verification token');
  }
  if (header.alg !== 'ES256') {
    throw new PlaidWebhookVerificationError('WRONG_ALGORITHM', 'Webhook token must use ES256');
  }
  if (typeof header.kid !== 'string' || !header.kid) {
    throw new PlaidWebhookVerificationError('MISSING_KEY_ID', 'Webhook token is missing its key ID');
  }
  assertKeyId(header.kid);

  let jwk: PlaidVerificationJwk;
  try {
    jwk = await options.getKey(header.kid);
  } catch (error) {
    if (error instanceof PlaidWebhookVerificationError) throw error;
    throw new PlaidWebhookVerificationError('KEY_FETCH_FAILED', 'Unable to retrieve webhook verification key');
  }

  const nowMs = options.nowMs ?? Date.now();
  validatePlaidJwk(jwk, header.kid, nowMs);

  let payload: JWTPayload;
  try {
    const key = await importJWK(jwk, 'ES256');
    const result = await jwtVerify(token, key, {
      algorithms: ['ES256'],
      currentDate: new Date(nowMs),
    });
    payload = result.payload;
  } catch {
    throw new PlaidWebhookVerificationError('INVALID_SIGNATURE', 'Webhook signature is invalid');
  }

  if (!Number.isInteger(payload.iat)) {
    throw new PlaidWebhookVerificationError('MISSING_ISSUED_AT', 'Webhook token is missing a valid issued-at time');
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  const maxAge = options.maxTokenAgeSeconds ?? 300;
  const futureSkew = options.maxFutureSkewSeconds ?? 60;
  if (nowSeconds - payload.iat! > maxAge) {
    throw new PlaidWebhookVerificationError('STALE_TOKEN', 'Webhook token is older than five minutes');
  }
  if (payload.iat! - nowSeconds > futureSkew) {
    throw new PlaidWebhookVerificationError('FUTURE_TOKEN', 'Webhook token issued-at time is in the future');
  }

  const claimedBodyHash = payload.request_body_sha256;
  if (typeof claimedBodyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(claimedBodyHash)) {
    throw new PlaidWebhookVerificationError('MISSING_BODY_HASH', 'Webhook token is missing a valid body hash');
  }
  const bodySha256 = await sha256Hex(options.crypto, options.rawBody);
  if (!constantTimeEqual(bodySha256.toLowerCase(), claimedBodyHash.toLowerCase())) {
    throw new PlaidWebhookVerificationError('BODY_MISMATCH', 'Webhook body does not match its signed digest');
  }

  return { bodySha256, issuedAt: payload.iat!, keyId: header.kid };
}
