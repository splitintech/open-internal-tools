import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createPlaidRuntime, plaidAttempt } from './helpers.ts';

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

describe('Plaid IDV sandbox-contract', () => {
  it('covers create, launch, resume, status variants, retry, webhook, unsupported cancel, and redaction from recorded fixtures', async () => {
    let identity = loadFixture('create.json');
    const { adapter } = createPlaidRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/identity_verification/create') return json(loadFixture('create.json'));
      if (url.pathname === '/identity_verification/retry') return json(loadFixture('retry.json'));
      if (url.pathname === '/link/token/create') return json(loadFixture('link-token.json'));
      if (url.pathname === '/identity_verification/get') return json(identity);
      return json(identity);
    });

    const created = await adapter.createAttempt(plaidAttempt);
    expect(created.providerResourceId).toBe('idv_plaid_1');
    expect(created.launch.launcherKey).toBe('plaid_link');
    expect(created.launch.transientSecret).toBe('link-sandbox-fixture-1');
    expect(created.canonicalStatus).toBe('pending_user_input');

    const resource = {
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: plaidAttempt.configurationRevision,
    };
    const resumed = await adapter.resumeAttempt(resource);
    expect(resumed.transientSecret).toBe('link-sandbox-fixture-1');

    identity = loadFixture('success.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('verified');
    identity = loadFixture('decline.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('failed');
    identity = loadFixture('review.json');
    expect((await adapter.retrieveAttempt(resource)).canonicalStatus).toBe('manual_review_required');

    identity = loadFixture('decline.json');
    const retried = await adapter.retryAttempt({
      ...plaidAttempt,
      previousProviderResourceId: created.providerResourceId,
    });
    expect(retried.providerResourceId).toBe('idv_plaid_2');

    const webhook = loadFixture('webhook-success.json');
    const normalized = await adapter.normalizeWebhook({
      providerEventKey: 'plaid_fixture',
      receivedAt: '2026-01-01T00:00:00.000Z',
      bodySha256: 'e'.repeat(64),
      opaquePayload: new TextEncoder().encode(JSON.stringify(webhook)),
    });
    expect(normalized.canonicalStatus).toBe('verified');

    await expect(adapter.cancelAttempt(resource)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      safeCode: 'plaid_cancel_unsupported',
    });

    const redaction = await adapter.redactSubject({
      subjectReference: plaidAttempt.subjectReference,
      providerResourceId: created.providerResourceId,
      requestReference: 'redact_fixture_1',
    });
    expect(redaction.disposition).toBe('not_applicable');
  });
});
