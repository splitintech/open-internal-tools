import { exportJWK, generateKeyPair, SignJWT, type GenerateKeyPairResult, type JWK } from 'jose';

import {
  FakeClock,
  createAllowlistedHttp,
  createControlledFetch,
  createDefaultRuntime,
  type ProviderAttemptCommand,
} from '@splitin/verification-adapter-sdk';

import { PlaidIdvVerificationAdapter } from '../src/adapter.ts';
import type { PlaidIdvAdapterConfiguration } from '../src/configuration.ts';
import { plaidIdvProviderManifest } from '../src/manifest.ts';
import { sha256Hex } from '../src/webhook-crypto.ts';
import type { PlaidVerificationJwk } from '../src/webhook-key-cache.ts';

export const FIXED_NOW = Date.parse('2026-01-01T00:00:00.000Z');

export const validPlaidConfig: PlaidIdvAdapterConfiguration = Object.freeze({
  clientId: 'plaid_client_test',
  secret: 'plaid_sandbox_secret',
  templateId: 'idvtmp_published_1',
  clientName: 'Example Host',
});

export const plaidAttempt: ProviderAttemptCommand = {
  attemptId: 'att_plaid_1',
  subjectReference: 'sub_opaque_plaid01',
  packageCode: 'human_idv',
  countryCode: 'US',
  idempotencyKey: 'idem_plaid_1',
  configurationRevision: 'cfg_plaid_1',
};

export function plaidIdentity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'idv_plaid_1',
    client_user_id: plaidAttempt.subjectReference,
    status: 'active',
    created_at: new Date(FIXED_NOW).toISOString(),
    shareable_url: 'https://verify.plaid.com/verify/test',
    ...overrides,
  };
}

export function createPlaidRuntime(
  handler: (request: Request) => Promise<Response> | Response,
  config: PlaidIdvAdapterConfiguration = validPlaidConfig,
  clock = new FakeClock(FIXED_NOW),
) {
  const requests: Request[] = [];
  const fetchImpl = createControlledFetch(async (request) => {
    requests.push(request);
    return handler(request);
  });
  const runtime = createDefaultRuntime('sandbox', config, {
    now: clock.now,
    crypto: globalThis.crypto,
    http: createAllowlistedHttp(plaidIdvProviderManifest.apiHosts, fetchImpl),
  });
  return {
    adapter: new PlaidIdvVerificationAdapter(runtime),
    runtime,
    clock,
    requests,
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function generatePlaidWebhookKey(nowMs = FIXED_NOW): Promise<{
  publicJwk: PlaidVerificationJwk;
  privateKey: CryptoKey | Uint8Array;
  kid: string;
}> {
  const pair: GenerateKeyPairResult = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(pair.publicKey) as JWK;
  const kid = 'plaid-webhook-key-1';
  const publicJwk: PlaidVerificationJwk = {
    ...jwk,
    kid,
    alg: 'ES256',
    use: 'sig',
    created_at: Math.floor(nowMs / 1000) - 60,
  };
  return { publicJwk, privateKey: pair.privateKey, kid };
}

export async function signedPlaidWebhook(options: {
  body: string;
  privateKey: CryptoKey | Uint8Array;
  kid: string;
  now: Date;
  bodyHash?: string;
}): Promise<Request> {
  const hash = options.bodyHash ?? await sha256Hex(globalThis.crypto, new TextEncoder().encode(options.body));
  const token = await new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: 'ES256', kid: options.kid })
    .setIssuedAt(Math.floor(options.now.getTime() / 1000))
    .sign(options.privateKey);
  return new Request('https://example.test/webhooks/plaid', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Plaid-Verification': token,
    },
    body: options.body,
  });
}

export function plaidWebhookPayload(status = 'success') {
  return JSON.stringify({
    webhook_type: 'IDENTITY_VERIFICATION',
    webhook_code: 'STATUS_UPDATED',
    identity_verification_id: 'idv_plaid_1',
    environment: 'sandbox',
    status,
  });
}
