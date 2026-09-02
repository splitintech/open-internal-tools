import { describe, expect, it } from 'vitest';

import { createSignedWebhookFixture, runAdapterConformance } from '@splitin/verification-adapter-sdk';

import {
  attemptCommand,
  createStripeRuntime,
  stripeEvent,
  stripeSession,
  validConfig,
} from './helpers.ts';

describe('Stripe Identity conformance', () => {
  it('passes lifecycle conformance against mocked Identity HTTP', async () => {
    const sessions = new Map<string, ReturnType<typeof stripeSession>>();
    const { adapter, clock } = createStripeRuntime(async (request) => {
      const url = new URL(request.url);
      const idempotency = request.headers.get('Idempotency-Key') ?? '';
      if (request.method === 'POST' && url.pathname === '/v1/identity/verification_sessions') {
        const existing = [...sessions.values()].find((session) => session.id === `vs_${idempotency.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).padEnd(8, 'x')}`);
        if (existing) return json(existing);
        const created = stripeSession({
          id: `vs_${idempotency.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).padEnd(8, 'x')}`,
        });
        sessions.set(created.id, created);
        return json(created);
      }
      const match = url.pathname.match(/\/v1\/identity\/verification_sessions\/([^/]+)(?:\/(cancel|redact))?$/);
      const id = match?.[1] ?? '';
      const action = match?.[2];
      const current = sessions.get(id) ?? stripeSession({ id });
      if (action === 'cancel') {
        const canceled = stripeSession({ ...current, status: 'canceled', client_secret: null, url: null });
        sessions.set(id, canceled);
        return json(canceled);
      }
      if (action === 'redact') {
        const redacted = stripeSession({ ...current, redaction: { status: 'processing' } });
        sessions.set(id, redacted);
        return json(redacted);
      }
      return json(current);
    });

    const webhookBody = JSON.stringify(stripeEvent(
      'identity.verification_session.requires_input',
      stripeSession({ id: 'vs_identity1' }),
    ));
    const webhookRequest = await createSignedWebhookFixture({
      protocol: 'stripe_v1_hmac',
      secret: validConfig.webhookSecret,
      body: webhookBody,
      now: clock.now(),
    });
    const results = await runAdapterConformance(adapter, attemptCommand, { webhookRequest });
    const failed = results.filter((result) => !result.passed);
    expect(failed).toEqual([]);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
