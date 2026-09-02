import { expect } from 'vitest';

import type { ActorContext } from '@splitin/verification-adapter-sdk';

import { listV1Paths } from '../src/catalog.ts';
import { approverActor, operatorActor, userActor, workerActor } from './fake-platform.ts';

const ORIGIN = 'https://app.example.com';

export type FetchLike = (request: Request) => Promise<Response>;

export function actorHeader(actor: ActorContext): string {
  return `Bearer ${actor.actorType}:${actor.actorId}`;
}

export async function runContractSuite(fetchLike: FetchLike): Promise<void> {
  const created = await json(fetchLike, 'POST', '/v1/sessions', userActor, {
    packageCode: 'human_idv',
    countryCode: 'US',
    action: 'listing.publish',
    resourceType: 'listing',
    resourceReference: 'res_opaque_1234',
  }, 'idem-start-1');
  expect(created.status).toBe(200);
  const session = created.body as { attemptId: string; launch: { transientSecret?: string; launcherKey: string }; status: string };
  expect(session.attemptId).toMatch(/^att_/);
  expect(session.launch.launcherKey).toBe('test_embedded');
  expect(session.launch.transientSecret).toMatch(/^mem_/);

  const duplicate = await json(fetchLike, 'POST', '/v1/sessions', userActor, {
    packageCode: 'human_idv',
    countryCode: 'US',
    action: 'listing.publish',
    resourceType: 'listing',
    resourceReference: 'res_opaque_1234',
  }, 'idem-start-1');
  expect((duplicate.body as { attemptId: string }).attemptId).toBe(session.attemptId);

  const missingKey = await json(fetchLike, 'POST', '/v1/sessions', userActor, { packageCode: 'human_idv' });
  expect(missingKey.status).toBe(400);
  expect((missingKey.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

  const providerField = await json(fetchLike, 'POST', '/v1/sessions', userActor, {
    packageCode: 'human_idv',
    provider: 'stripe_identity',
  }, 'idem-bad-field');
  expect(providerField.status).toBe(400);
  expect((providerField.body as { error: { code: string } }).error.code).toBe('UNSUPPORTED_REQUEST_FIELD');

  const unauthenticated = await fetchLike(new Request('https://app.example.com/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN, 'Idempotency-Key': 'idem-no-auth' },
    body: JSON.stringify({ packageCode: 'human_idv' }),
  }));
  expect(unauthenticated.status).toBe(401);

  const cookieCsrf = await fetchLike(new Request('https://app.example.com/v1/sessions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'session=abc',
      'Idempotency-Key': 'idem-csrf',
    },
    body: JSON.stringify({ packageCode: 'human_idv' }),
  }));
  expect(cookieCsrf.status).toBe(403);
  const csrfBody = await cookieCsrf.json() as { error: { code: string } };
  expect(['CSRF_REJECTED', 'ORIGIN_NOT_ALLOWED']).toContain(csrfBody.error.code);

  const got = await json(fetchLike, 'GET', `/v1/sessions/${session.attemptId}`, userActor);
  expect(got.status).toBe(200);
  expect((got.body as { attemptId: string }).attemptId).toBe(session.attemptId);

  const missing = await json(fetchLike, 'GET', '/v1/sessions/att_missing1', userActor);
  expect(missing.status).toBe(404);

  const resumed = await json(fetchLike, 'POST', `/v1/sessions/${session.attemptId}/resume`, userActor, {}, 'idem-resume-1');
  expect(resumed.status).toBe(200);

  const paused = await json(fetchLike, 'POST', `/v1/sessions/${session.attemptId}/pause`, userActor, {}, 'idem-pause-1');
  expect((paused.body as { status: string }).status).toBe('paused');

  const canceled = await json(fetchLike, 'POST', `/v1/sessions/${session.attemptId}/cancel`, userActor, {}, 'idem-cancel-1');
  expect((canceled.body as { status: string }).status).toBe('canceled');

  const retried = await json(fetchLike, 'POST', `/v1/sessions/${session.attemptId}/retry`, userActor, {}, 'idem-retry-1');
  expect((retried.body as { attemptId: string }).attemptId).toContain('_r');

  const appeal = await json(fetchLike, 'POST', '/v1/appeals', userActor, {
    attemptId: session.attemptId,
    reasonCode: 'decision_appeal',
  }, 'idem-appeal-1');
  expect((appeal.body as { appealId: string }).appealId).toMatch(/^apl_/);

  const support = await json(fetchLike, 'POST', '/v1/support/escalations', userActor, {
    attemptId: session.attemptId,
    reasonCode: 'accessibility_support',
  }, 'idem-support-1');
  expect((support.body as { escalationId: string }).escalationId).toMatch(/^esc_/);

  const denied = await json(fetchLike, 'POST', '/v1/protected-actions/evaluate', userActor, {
    action: 'listing.publish',
    resourceType: 'listing',
    resourceReference: 'res_opaque_1234',
  }, 'idem-gate-1');
  expect((denied.body as { code: string }).code).toBe('VERIFICATION_REQUIRED');

  const webhook = await fetchLike(new Request('https://app.example.com/v1/webhooks/test_fake', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_1', type: 'test' }),
  }));
  expect(webhook.status).toBe(202);

  const adminDenied = await json(fetchLike, 'GET', '/v1/admin/health', userActor);
  expect(adminDenied.status).toBe(403);

  const health = await json(fetchLike, 'GET', '/v1/admin/health', operatorActor);
  expect(health.status).toBe(200);

  for (const path of ['/v1/admin/routes', '/v1/admin/circuits', '/v1/admin/attempts', '/v1/admin/review', '/v1/admin/audit', '/v1/admin/reconciliation', '/v1/admin/redaction']) {
    const response = await json(fetchLike, 'GET', path, operatorActor);
    expect(response.status, path).toBe(200);
  }

  const proposed = await json(fetchLike, 'POST', '/v1/admin/routes', operatorActor, {
    operation: 'propose',
    targetRoutePolicyId: 'rte_1',
    action: 'drain',
    reasonCode: 'operator_requested_drain',
  }, 'idem-route-propose');
  expect(proposed.status).toBe(200);
  const requestId = (proposed.body as { id: string }).id;
  expect(requestId).toBeTruthy();
  const selfApprove = await json(fetchLike, 'POST', '/v1/admin/routes', operatorActor, {
    operation: 'approve',
    requestId,
  }, 'idem-route-self-approve');
  expect(selfApprove.status).toBe(403);
  expect((selfApprove.body as { error: { code: string } }).error.code).toBe('SEPARATION_OF_DUTIES');

  const approved = await json(fetchLike, 'POST', '/v1/admin/routes', approverActor, {
    operation: 'approve',
    requestId,
  }, 'idem-route-approve');
  expect(approved.status).toBe(200);

  const circuit = await json(fetchLike, 'POST', '/v1/admin/circuits', operatorActor, {
    provider: 'test_fake',
    providerEnvironment: 'sandbox',
    status: 'degraded',
  }, 'idem-circuit-1');
  expect(circuit.status).toBe(200);
  expect((circuit.body as { status: string }).status).toBe('degraded');

  const review = await json(fetchLike, 'POST', '/v1/admin/review', operatorActor, {
    operation: 'begin_appeal_review',
    appealId: 'apl_open',
  }, 'idem-review-1');
  expect(review.status).toBe(200);

  const reconcile = await json(fetchLike, 'POST', '/v1/admin/reconciliation', operatorActor, {
    attemptId: session.attemptId,
  }, 'idem-reconcile-1');
  expect(reconcile.status).toBe(200);

  const redact = await json(fetchLike, 'POST', '/v1/admin/redaction', operatorActor, {
    privacyRequestId: 'prv_1',
  }, 'idem-redact-1');
  expect(redact.status).toBe(200);

  const workerDenied = await json(fetchLike, 'POST', '/v1/workers/claim', userActor, { queue: 'webhook' }, 'idem-worker-denied');
  expect(workerDenied.status).toBe(403);

  const claimed = await json(fetchLike, 'POST', '/v1/workers/claim', workerActor, { queue: 'webhook' }, 'idem-worker-claim');
  expect((claimed.body as { leases: unknown[] }).leases).toHaveLength(1);

  const processed = await json(fetchLike, 'POST', '/v1/workers/process', workerActor, {
    leaseId: 'lease_1',
    jobId: 'job_1',
  }, 'idem-worker-process');
  expect((processed.body as { processed: boolean }).processed).toBe(true);

  const leaked = await json(fetchLike, 'POST', '/v1/sessions', userActor, {
    packageCode: 'human_idv',
    metadata: { note: 'ok' },
  }, 'idem-no-secret-echo');
  expect(JSON.stringify(leaked.body)).not.toMatch(/sk_live|whsec_|rk_live/);
  const secretField = await json(fetchLike, 'POST', '/v1/sessions', userActor, {
    packageCode: 'human_idv',
    adapter: 'sk_live_should_never_return',
  } as never, 'idem-secret-field');
  expect(JSON.stringify(secretField.body)).not.toMatch(/sk_live_should_never_return/);
  expect(listV1Paths().length).toBeGreaterThan(10);
}

async function json(
  fetchLike: FetchLike,
  method: string,
  path: string,
  actor: ActorContext,
  body?: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    authorization: actorHeader(actor),
    origin: ORIGIN,
  };
  if (method !== 'GET') headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const response = await fetchLike(new Request(`https://app.example.com${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  }));
  return { status: response.status, body: await response.json() };
}
