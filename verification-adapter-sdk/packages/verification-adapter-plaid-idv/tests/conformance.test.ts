import { describe, expect, it } from 'vitest';

import { runAdapterConformance } from '@splitin/verification-adapter-sdk';

import {
  createPlaidRuntime,
  generatePlaidWebhookKey,
  json,
  plaidAttempt,
  plaidIdentity,
  plaidWebhookPayload,
  signedPlaidWebhook,
} from './helpers.ts';

describe('Plaid IDV conformance', () => {
  it('passes lifecycle conformance against mocked IDV HTTP', async () => {
    const created = plaidIdentity();
    const { publicJwk, privateKey, kid } = await generatePlaidWebhookKey();
    const { adapter, clock } = createPlaidRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/identity_verification/create') return json(created);
      if (url.pathname === '/identity_verification/get') return json(created);
      if (url.pathname === '/identity_verification/retry') return json(created);
      if (url.pathname === '/link/token/create') {
        return json({ link_token: 'link-sandbox-conformance', expiration: new Date(clock.now().getTime() + 1800_000).toISOString() });
      }
      if (url.pathname === '/webhook_verification_key/get') return json({ key: publicJwk });
      return json(created);
    });
    const webhookRequest = await signedPlaidWebhook({
      body: plaidWebhookPayload('active'),
      privateKey,
      kid,
      now: clock.now(),
    });
    const results = await runAdapterConformance(adapter, plaidAttempt, { webhookRequest });
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
