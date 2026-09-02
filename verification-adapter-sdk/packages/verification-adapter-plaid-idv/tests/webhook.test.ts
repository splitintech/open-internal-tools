import { describe, expect, it } from 'vitest';

import { FakeClock, ProviderError } from '@splitin/verification-adapter-sdk';

import {
  createPlaidRuntime,
  generatePlaidWebhookKey,
  json,
  plaidIdentity,
  plaidWebhookPayload,
  signedPlaidWebhook,
  validPlaidConfig,
} from './helpers.ts';

describe('Plaid IDV webhooks', () => {
  it('accepts a valid ES256 JWT and normalizes IDV status', async () => {
    const clock = new FakeClock();
    const { publicJwk, privateKey, kid } = await generatePlaidWebhookKey(clock.now().getTime());
    const body = plaidWebhookPayload('success');
    const request = await signedPlaidWebhook({ body, privateKey, kid, now: clock.now() });
    const { adapter } = createPlaidRuntime(async (httpRequest) => {
      if (new URL(httpRequest.url).pathname === '/webhook_verification_key/get') {
        return json({ key: publicJwk });
      }
      return json(plaidIdentity());
    }, validPlaidConfig, clock);
    const verified = await adapter.verifyWebhook(request);
    const normalized = await adapter.normalizeWebhook(verified);
    expect(normalized.canonicalStatus).toBe('verified');
    expect(normalized.providerEventType).toBe('IDENTITY_VERIFICATION.STATUS_UPDATED');
    expect(normalized.providerResourceId).toBe('idv_plaid_1');
  });

  it('rejects an invalid signature', async () => {
    const clock = new FakeClock();
    const { publicJwk, kid } = await generatePlaidWebhookKey(clock.now().getTime());
    const other = await generatePlaidWebhookKey(clock.now().getTime());
    const body = plaidWebhookPayload('success');
    const request = await signedPlaidWebhook({ body, privateKey: other.privateKey, kid, now: clock.now() });
    const { adapter } = createPlaidRuntime(async (httpRequest) => {
      if (new URL(httpRequest.url).pathname === '/webhook_verification_key/get') return json({ key: publicJwk });
      return json({});
    }, validPlaidConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('rejects a replayed (stale) token', async () => {
    const clock = new FakeClock();
    const { publicJwk, privateKey, kid } = await generatePlaidWebhookKey(clock.now().getTime());
    const body = plaidWebhookPayload('success');
    const request = await signedPlaidWebhook({ body, privateKey, kid, now: clock.now() });
    clock.advance(301_000);
    const { adapter } = createPlaidRuntime(async (httpRequest) => {
      if (new URL(httpRequest.url).pathname === '/webhook_verification_key/get') return json({ key: publicJwk });
      return json({});
    }, validPlaidConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects a rotated key that no longer verifies the token', async () => {
    const clock = new FakeClock();
    const original = await generatePlaidWebhookKey(clock.now().getTime());
    const rotated = await generatePlaidWebhookKey(clock.now().getTime());
    const body = plaidWebhookPayload('success');
    const request = await signedPlaidWebhook({
      body,
      privateKey: original.privateKey,
      kid: original.kid,
      now: clock.now(),
    });
    const { adapter } = createPlaidRuntime(async (httpRequest) => {
      if (new URL(httpRequest.url).pathname === '/webhook_verification_key/get') {
        return json({ key: { ...rotated.publicJwk, kid: original.kid } });
      }
      return json({});
    }, validPlaidConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('rejects non-IDV webhook families', async () => {
    const clock = new FakeClock();
    const { publicJwk, privateKey, kid } = await generatePlaidWebhookKey(clock.now().getTime());
    const body = JSON.stringify({
      webhook_type: 'AUTH',
      webhook_code: 'AUTOMATICALLY_VERIFIED',
      identity_verification_id: 'idv_plaid_1',
      environment: 'sandbox',
    });
    const request = await signedPlaidWebhook({ body, privateKey, kid, now: clock.now() });
    const { adapter } = createPlaidRuntime(async (httpRequest) => {
      if (new URL(httpRequest.url).pathname === '/webhook_verification_key/get') return json({ key: publicJwk });
      return json({});
    }, validPlaidConfig, clock);
    const verified = await adapter.verifyWebhook(request);
    await expect(adapter.normalizeWebhook(verified)).rejects.toMatchObject({
      safeCode: 'plaid_webhook_scope_denied',
    });
  });
});
