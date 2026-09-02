import { describe, expect, it } from 'vitest';

import { runAdapterConformance } from '@splitin/verification-adapter-sdk';

import {
  createPersonaRuntime,
  inquiryResource,
  json,
  personaAttempt,
  personaWebhookBody,
  signedPersonaRequest,
  validPersonaConfig,
} from './helpers.ts';

describe('Persona conformance', () => {
  it('passes lifecycle conformance against mocked Persona HTTP', async () => {
    const inquiries = new Map<string, ReturnType<typeof inquiryResource>>();
    const { adapter, clock } = createPersonaRuntime(async (request) => {
      const url = new URL(request.url);
      const idempotency = request.headers.get('Idempotency-Key') ?? 'default';
      if (request.method === 'POST' && url.pathname === '/api/v1/inquiries') {
        const existing = inquiries.get(idempotency);
        if (existing) return json(existing);
        const created = inquiryResource({ id: 'inq_persona1' });
        inquiries.set(idempotency, created);
        return json(created);
      }
      if (url.pathname.endsWith('/resume')) {
        return json({ ...inquiryResource(), meta: { 'session-token': 'persona_session_token_resume' } });
      }
      if (url.pathname.endsWith('/expire')) {
        return json(inquiryResource({
          attributes: { status: 'expired', 'created-at': new Date().toISOString() },
        }));
      }
      if (request.method === 'DELETE') {
        return new Response(null, { status: 204, headers: { 'Persona-Environment-Id': validPersonaConfig.environmentId } });
      }
      return json(inquiryResource());
    });

    const webhookRequest = await signedPersonaRequest(
      validPersonaConfig.webhookSecretCurrent,
      personaWebhookBody('inquiry.pending', 'pending'),
      clock,
    );
    const results = await runAdapterConformance(adapter, personaAttempt, { webhookRequest });
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
