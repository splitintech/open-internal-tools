import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ProviderError } from '@splitin/verification-adapter-sdk';

import {
  createPersonaRuntime,
  personaAttempt,
  validPersonaConfig,
} from './helpers.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'Persona-Environment-Id': validPersonaConfig.environmentId,
    },
  });
}

describe('Persona sandbox-contract', () => {
  it('covers create, launch, resume, status variants, retry, webhook, cancel, and redaction from recorded fixtures', async () => {
    let retrieve = loadFixture('create-inquiry.json');
    const { adapter } = createPersonaRuntime(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/api/v1/inquiries') return json(loadFixture('create-inquiry.json'));
      if (url.pathname.endsWith('/resume')) return json(loadFixture('resume-inquiry.json'));
      if (url.pathname.endsWith('/expire')) return json(loadFixture('expire.json'));
      if (request.method === 'DELETE') {
        return new Response(null, {
          status: 204,
          headers: { 'Persona-Environment-Id': validPersonaConfig.environmentId },
        });
      }
      return json(retrieve);
    });

    const created = await adapter.createAttempt(personaAttempt);
    expect(created.providerResourceId).toBe('inq_persona1');
    expect(created.launch.launcherKey).toBe('persona_embedded');
    expect(created.launch.transientSecret).toBe('persona_session_token_resume');

    const resource = {
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: personaAttempt.configurationRevision,
      requestOrigin: personaAttempt.requestOrigin,
    };
    const resumed = await adapter.resumeAttempt(resource);
    expect(resumed.transientSecret).toBe('persona_session_token_resume');

    retrieve = loadFixture('success.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('verified');
    retrieve = loadFixture('decline.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('declined');
    retrieve = loadFixture('review.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('manual_review_required');

    retrieve = loadFixture('create-inquiry.json');
    const retried = await adapter.retryAttempt({
      ...personaAttempt,
      previousProviderResourceId: created.providerResourceId,
    });
    expect(retried.providerResourceId).toBe(created.providerResourceId);

    const approved = loadFixture('webhook-approved.json');
    const declined = loadFixture('webhook-declined.json');
    expect((await adapter.normalizeWebhook({
      providerEventKey: 'evt_persona_1',
      receivedAt: '2026-01-01T00:00:00.000Z',
      bodySha256: 'c'.repeat(64),
      opaquePayload: new TextEncoder().encode(JSON.stringify(approved)),
    })).canonicalStatus).toBe('verified');
    expect((await adapter.normalizeWebhook({
      providerEventKey: 'evt_persona_decline',
      receivedAt: '2026-01-01T00:00:00.000Z',
      bodySha256: 'd'.repeat(64),
      opaquePayload: new TextEncoder().encode(JSON.stringify(declined)),
    })).canonicalStatus).toBe('declined');

    const canceled = await adapter.cancelAttempt(resource);
    expect(canceled.accepted).toBe(true);

    await expect(adapter.cancelAttempt({ ...resource, providerResourceId: 'txn_kyb_1aaa' })).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.cancelAttempt({ ...resource, providerResourceId: 'txn_kyb_1aaa' })).rejects.toMatchObject({
      safeCode: 'persona_noninteractive_cancel_unsupported',
    });

    const redaction = await adapter.redactSubject({
      subjectReference: personaAttempt.subjectReference,
      providerResourceId: created.providerResourceId,
      requestReference: 'redact_fixture_1',
    });
    expect(redaction.completed).toBe(true);
    expect(redaction.disposition).toBe('redacted');
  });
});
