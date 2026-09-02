import { describe, expect, it } from 'vitest';

import { FakeClock, ProviderError } from '@splitin/verification-adapter-sdk';

import {
  createPersonaRuntime,
  personaWebhookBody,
  signedPersonaRequest,
  validPersonaConfig,
} from './helpers.ts';

describe('Persona webhooks', () => {
  it('accepts HMAC over the exact raw body with the current secret', async () => {
    const clock = new FakeClock();
    const body = personaWebhookBody('inquiry.completed', 'completed');
    const request = await signedPersonaRequest(validPersonaConfig.webhookSecretCurrent, body, clock);
    const { adapter } = createPersonaRuntime(async () => new Response('unused'), validPersonaConfig, clock);
    const verified = await adapter.verifyWebhook(request);
    expect(verified.providerEventKey).toBe('evt_persona_1');
    const normalized = await adapter.normalizeWebhook(verified);
    expect(normalized.canonicalStatus).toBe('processing');
    expect(normalized.providerEventType).toBe('inquiry.completed');
  });

  it('accepts the rotated previous secret', async () => {
    const clock = new FakeClock();
    const body = personaWebhookBody('inquiry.approved', 'approved');
    const request = await signedPersonaRequest(validPersonaConfig.webhookSecretPrevious!, body, clock);
    const { adapter } = createPersonaRuntime(async () => new Response('unused'), validPersonaConfig, clock);
    const normalized = await adapter.normalizeWebhook(await adapter.verifyWebhook(request));
    expect(normalized.canonicalStatus).toBe('verified');
  });

  it('rejects an invalid signature', async () => {
    const clock = new FakeClock();
    const body = personaWebhookBody('inquiry.approved', 'approved');
    const request = await signedPersonaRequest('attacker-secret', body, clock);
    const { adapter } = createPersonaRuntime(async () => new Response('unused'), validPersonaConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toMatchObject({
      code: 'SIGNATURE_INVALID',
      safeCode: 'persona_webhook_signature_invalid',
    });
  });

  it('rejects a replayed timestamp', async () => {
    const clock = new FakeClock();
    const body = personaWebhookBody('inquiry.pending', 'pending');
    const request = await signedPersonaRequest(validPersonaConfig.webhookSecretCurrent, body, clock);
    clock.advance(301_000);
    const { adapter } = createPersonaRuntime(async () => new Response('unused'), validPersonaConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects a mismatched Persona-Environment-Id', async () => {
    const clock = new FakeClock();
    const body = personaWebhookBody('inquiry.approved', 'approved');
    const request = await signedPersonaRequest(validPersonaConfig.webhookSecretCurrent, body, clock, 'env_other');
    const { adapter } = createPersonaRuntime(async () => new Response('unused'), validPersonaConfig, clock);
    await expect(adapter.verifyWebhook(request)).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('maps inquiry.redacted to canonical redacted', async () => {
    const clock = new FakeClock();
    const body = personaWebhookBody('inquiry.redacted', 'redacted');
    const request = await signedPersonaRequest(validPersonaConfig.webhookSecretCurrent, body, clock);
    const { adapter } = createPersonaRuntime(async () => new Response('unused'), validPersonaConfig, clock);
    const normalized = await adapter.normalizeWebhook(await adapter.verifyWebhook(request));
    expect(normalized.canonicalStatus).toBe('redacted');
    expect(normalized.safeMetadata.redacted).toBe(true);
  });
});
