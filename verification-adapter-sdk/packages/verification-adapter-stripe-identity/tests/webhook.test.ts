import { describe, expect, it } from 'vitest';

import { FakeClock, createSignedWebhookFixture } from '@splitin/verification-adapter-sdk';

import { createStripeRuntime, stripeEvent, stripeSession, validConfig } from './helpers.ts';

describe('Stripe Identity webhooks', () => {
  it('accepts a current-secret HMAC and normalizes verified', async () => {
    const clock = new FakeClock();
    const body = JSON.stringify(stripeEvent('identity.verification_session.verified', stripeSession({ status: 'verified' })));
    const request = await createSignedWebhookFixture({
      protocol: 'stripe_v1_hmac',
      secret: validConfig.webhookSecret,
      body,
      now: clock.now(),
    });
    const { adapter } = createStripeRuntime(async () => new Response('unused'), validConfig, clock);
    const verified = await adapter.verifyWebhook(request);
    expect(verified.providerEventKey).toBe('evt_identity1');
    const normalized = await adapter.normalizeWebhook(verified);
    expect(normalized.canonicalStatus).toBe('verified');
    expect(normalized.providerResourceId).toBe('vs_identity1');
  });

  it('accepts the rotated previous secret', async () => {
    const clock = new FakeClock();
    const body = JSON.stringify(stripeEvent('identity.verification_session.requires_input'));
    const request = await createSignedWebhookFixture({
      protocol: 'stripe_v1_hmac',
      secret: validConfig.webhookSecretPrevious!,
      body,
      now: clock.now(),
    });
    const { adapter } = createStripeRuntime(async () => new Response('unused'), validConfig, clock);
    const verified = await adapter.verifyWebhook(request);
    expect(verified.providerEventKey).toBe('evt_identity1');
  });

  it('rejects an invalid signature', async () => {
    const clock = new FakeClock();
    const body = JSON.stringify(stripeEvent('identity.verification_session.verified', stripeSession({ status: 'verified' })));
    const request = await createSignedWebhookFixture({
      protocol: 'stripe_v1_hmac',
      secret: 'whsec_attacker',
      body,
      now: clock.now(),
    });
    const { adapter } = createStripeRuntime(async () => new Response('unused'), validConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
  });

  it('rejects a replayed timestamp outside tolerance', async () => {
    const clock = new FakeClock();
    const body = JSON.stringify(stripeEvent('identity.verification_session.processing', stripeSession({ status: 'processing' })));
    const request = await createSignedWebhookFixture({
      protocol: 'stripe_v1_hmac',
      secret: validConfig.webhookSecret,
      body,
      now: clock.now(),
    });
    clock.advance(301_000);
    const { adapter } = createStripeRuntime(async () => new Response('unused'), validConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toMatchObject({
      code: 'SIGNATURE_INVALID',
      safeCode: 'stripe_identity_webhook_replay',
    });
  });

  it('maps a redacted webhook to canonical redacted', async () => {
    const clock = new FakeClock();
    const body = JSON.stringify(stripeEvent(
      'identity.verification_session.redacted',
      stripeSession({ status: 'verified', redaction: { status: 'redacted' } }),
    ));
    const request = await createSignedWebhookFixture({
      protocol: 'stripe_v1_hmac',
      secret: validConfig.webhookSecret,
      body,
      now: clock.now(),
    });
    const { adapter } = createStripeRuntime(async () => new Response('unused'), validConfig, clock);
    const normalized = await adapter.normalizeWebhook(await adapter.verifyWebhook(request));
    expect(normalized.canonicalStatus).toBe('redacted');
    expect(normalized.normalizedReasonCodes).toContain('provider_redacted');
  });
});
