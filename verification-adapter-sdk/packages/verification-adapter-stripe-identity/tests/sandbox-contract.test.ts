import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { attemptCommand, createStripeRuntime } from './helpers.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Stripe Identity sandbox-contract', () => {
  it('covers create, launch, resume, status variants, retry, webhook, cancel, and redaction from recorded fixtures', async () => {
    let current = loadFixture('create.json');
    const { adapter } = createStripeRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/cancel') && request.method === 'POST') return json(loadFixture('cancel.json'));
      if (url.pathname.endsWith('/redact') && request.method === 'POST') return json(loadFixture('redact.json'));
      return json(current);
    });

    const created = await adapter.createAttempt(attemptCommand);
    expect(created.providerResourceId).toBe('vs_identity1');
    expect(created.launch.launcherKey).toBe('stripe_identity');
    expect(created.launch.transientSecret).toBe('vs_identity1_secret_abc');
    expect(created.canonicalStatus).toBe('pending_user_input');

    const resource = {
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: attemptCommand.configurationRevision,
    };
    const resumed = await adapter.resumeAttempt(resource);
    expect(resumed.launcherKey).toBe('stripe_identity');
    expect(resumed.transientSecret).toBeTruthy();

    current = loadFixture('success.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('verified');
    current = loadFixture('decline.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('declined');
    current = loadFixture('review.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('manual_review_required');

    current = loadFixture('create.json');
    const retried = await adapter.retryAttempt({
      ...attemptCommand,
      previousProviderResourceId: created.providerResourceId,
    });
    expect(retried.providerResourceId).toBe(created.providerResourceId);

    const verifiedEvent = loadFixture('webhook-verified.json');
    const declinedEvent = loadFixture('webhook-declined.json');
    const verified = await adapter.normalizeWebhook({
      providerEventKey: String(verifiedEvent.id),
      receivedAt: '2026-01-01T00:00:00.000Z',
      bodySha256: 'a'.repeat(64),
      opaquePayload: new TextEncoder().encode(JSON.stringify(verifiedEvent)),
    });
    expect(verified.canonicalStatus).toBe('verified');
    const declined = await adapter.normalizeWebhook({
      providerEventKey: String(declinedEvent.id),
      receivedAt: '2026-01-01T00:00:00.000Z',
      bodySha256: 'b'.repeat(64),
      opaquePayload: new TextEncoder().encode(JSON.stringify(declinedEvent)),
    });
    expect(declined.canonicalStatus).toBe('declined');

    current = loadFixture('create.json');
    const canceled = await adapter.cancelAttempt(resource);
    expect(canceled.accepted).toBe(true);
    expect(canceled.canonicalStatus).toBe('canceled');

    current = loadFixture('success.json');
    const redaction = await adapter.redactSubject({
      subjectReference: attemptCommand.subjectReference,
      providerResourceId: created.providerResourceId,
      requestReference: 'redact_fixture_1',
    });
    expect(redaction.disposition).toBe('processing');
  });
});
