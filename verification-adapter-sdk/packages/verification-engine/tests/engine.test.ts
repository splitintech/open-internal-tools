import { describe, expect, it } from 'vitest';

import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';

import { ClientRouteInjectionError, WebhookSecurityIncidentError } from '../src/errors.ts';
import {
  createNamedAdapter,
  createTestPlatform,
  createWebhookAdapter,
  operatorA,
  operatorB,
  startCommand,
  userActor,
} from './helpers.ts';

describe('verification engine', () => {
  it('treats concurrent start as one provider resource', async () => {
    const adapter = createFakeAdapterForScenario('input_required');
    let creates = 0;
    const original = adapter.createAttempt.bind(adapter);
    adapter.createAttempt = async (command) => {
      creates += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return original(command);
    };
    const { platform } = createTestPlatform({ adapters: [adapter] });
    const [first, second] = await Promise.all([
      platform.start(userActor, startCommand),
      platform.start(userActor, startCommand),
    ]);
    expect(first.attemptId).toBe(second.attemptId);
    expect(first.provider).toBe(second.provider);
    expect(creates).toBe(1);
  });

  it('rejects client-chosen provider, template, workflow, origin, and revision', async () => {
    const { platform } = createTestPlatform();
    await expect(platform.start(userActor, {
      ...startCommand,
      provider: 'stripe_identity',
    } as never)).rejects.toBeInstanceOf(ClientRouteInjectionError);
    await expect(platform.start(userActor, {
      ...startCommand,
      templateId: 'tmpl_123',
    } as never)).rejects.toBeInstanceOf(ClientRouteInjectionError);
    await expect(platform.start(userActor, {
      ...startCommand,
      workflowId: 'wf_9',
    } as never)).rejects.toBeInstanceOf(ClientRouteInjectionError);
    await expect(platform.start(userActor, {
      ...startCommand,
      apiOrigin: 'https://evil.example',
    } as never)).rejects.toBeInstanceOf(ClientRouteInjectionError);
    await expect(platform.start(userActor, {
      ...startCommand,
      configurationRevision: 'cfg_from_browser',
    } as never)).rejects.toBeInstanceOf(ClientRouteInjectionError);
    const started = await platform.start(userActor, { ...startCommand, idempotencyKey: 'idem_server_route' });
    expect(started.provider).toBe('test_fake');
  });

  it('keeps started attempts pinned after routes change', async () => {
    const primary = createNamedAdapter('test_fake', 'input_required');
    const secondary = createNamedAdapter('alt_fake', 'input_required');
    const { platform, store } = createTestPlatform({ adapters: [primary, secondary] });
    const started = await platform.start(userActor, startCommand);
    expect(started.provider).toBe('test_fake');
    const routes = await store.listRoutes('default');
    for (const route of routes) {
      if (route.provider === 'test_fake') {
        await store.saveRoute({ ...route, lifecycle: 'retired', updatedAt: new Date().toISOString() });
      }
      if (route.provider === 'alt_fake') {
        await store.saveRoute({ ...route, priority: 1, lifecycle: 'active', updatedAt: new Date().toISOString() });
      }
    }
    const resumed = await platform.resume(userActor, { attemptId: started.attemptId });
    expect(resumed.provider).toBe('test_fake');
    expect(resumed.adapterVersion).toBe(started.adapterVersion);
    expect(resumed.manifestDigest).toBe(started.manifestDigest);
    expect(resumed.configurationRevision).toBe(started.configurationRevision);
    expect(resumed.policyVersion).toBe(started.policyVersion);
  });

  it('requires both runtime production key and two-actor policy', async () => {
    const { platform, store } = createTestPlatform({ runtime: { productionEnabled: false } });
    const proposed = await platform.admin.proposePolicy(operatorA, {
      version: 'prod-1',
      environment: 'production',
      reason: 'activate production',
    });
    await expect(platform.admin.approvePolicy(operatorA, proposed.policyId, 'self')).rejects.toMatchObject({
      code: 'GOVERNANCE_TWO_ACTOR',
    });
    await platform.admin.approvePolicy(operatorB, proposed.policyId, 'approved');
    await expect(platform.admin.activatePolicy(operatorB, proposed.policyId)).rejects.toMatchObject({
      code: 'PRODUCTION_NOT_ACTIVATED',
    });

    const enabled = createTestPlatform({ runtime: { productionEnabled: true } });
    const again = await enabled.platform.admin.proposePolicy(operatorA, {
      version: 'prod-2',
      environment: 'production',
      reason: 'activate production',
      decisionRetentionDays: 365,
      providerRedactionDelayDays: 30,
      appealHoldDays: 14,
      legalHold: false,
    });
    await enabled.platform.admin.approvePolicy(operatorB, again.policyId, 'approved');
    await enabled.platform.admin.activatePolicy(operatorB, again.policyId);
    const policy = await enabled.store.getActivePolicy('default', 'production');
    expect(policy?.lifecycle).toBe('active');
    expect(policy?.proposedByActorId).not.toBe(policy?.approvedByActorId);
    const sandboxRoutes = await store.listRoutes('default');
    expect(sandboxRoutes.some((route) => route.environment === 'production' && route.lifecycle === 'active')).toBe(false);
  });

  it('returns the protected-action denial envelope and never auto-replays', async () => {
    const { platform } = createTestPlatform();
    const denied = await platform.evaluateProtectedAction(userActor, {
      action: 'sign_lease',
      resourceType: 'lease',
      resourceReference: 'lease_opaque_1',
      subjectReference: startCommand.subjectReference,
    });
    expect(denied).toMatchObject({
      code: 'VERIFICATION_REQUIRED',
      action: 'sign_lease',
      retryAfter: null,
      supportPath: null,
    });
    if ('allowed' in denied) throw new Error('expected denial');
    expect(denied.requiredPackages).toContain('human_idv');
    expect(denied.continuation.key).toMatch(/^cont_/);
    expect(denied.continuation.token).toHaveLength(64);
    expect(denied.resourceHash).toMatch(/^[a-f0-9]{64}$/);

    const verifiedAdapter = createFakeAdapterForScenario('verified');
    const ready = createTestPlatform({ adapters: [verifiedAdapter] });
    await ready.platform.start(userActor, { ...startCommand, idempotencyKey: 'idem_verified' });
    const allowed = await ready.platform.evaluateProtectedAction(userActor, {
      action: 'sign_lease',
      resourceType: 'lease',
      resourceReference: 'lease_opaque_1',
      subjectReference: startCommand.subjectReference,
    });
    expect(allowed).toEqual({ allowed: true });
  });

  it('rejects forged webhooks and treats digest mismatch as a security incident', async () => {
    const adapter = createWebhookAdapter('input_required');
    const { platform, queue } = createTestPlatform({ adapters: [adapter] });
    const started = await platform.start(userActor, startCommand);
    const status = await platform.status(userActor, started.attemptId);
    const attempt = status;
    const body = JSON.stringify({
      eventId: 'evt_1',
      resourceId: (await platform.status(userActor, started.attemptId)).attemptId,
      type: 'inquiry.completed',
      status: 'verified',
    });
    const forged = new Request('https://example.test/webhooks/test_fake', {
      method: 'POST',
      headers: { 'x-test-signature': 'forged', 'content-type': 'application/json' },
      body,
    });
    await expect(platform.ingestWebhook({
      provider: 'test_fake',
      tenantKey: 'default',
      request: forged,
    })).rejects.toMatchObject({ code: 'WEBHOOK_UNAUTHENTICATED' });

    const attemptRow = await platform.admin.attempts(operatorA);
    const bound = (attemptRow as Array<{ id: string; providerResourceId: string | null }>).find((row) => row.id === started.attemptId);
    const validBody = JSON.stringify({
      eventId: 'evt_1',
      resourceId: bound?.providerResourceId,
      type: 'inquiry.completed',
      status: 'verified',
    });
    const valid = () => new Request('https://example.test/webhooks/test_fake', {
      method: 'POST',
      headers: { 'x-test-signature': 'valid', 'content-type': 'application/json' },
      body: validBody,
    });
    const first = await platform.ingestWebhook({ provider: 'test_fake', tenantKey: 'default', request: valid() });
    expect(first.accepted).toBe(true);
    const replay = await platform.ingestWebhook({ provider: 'test_fake', tenantKey: 'default', request: valid() });
    expect(replay.duplicate).toBe(true);

    const jobs = await queue.claim({
      tenantKey: 'default',
      kinds: ['webhook'],
      workerId: 'w1',
      leaseSeconds: 30,
      limit: 1,
      now: new Date(),
    });
    expect(jobs[0]).toBeTruthy();
    await platform.processWebhookJob('default', jobs[0]!);
    const after = await platform.status(userActor, started.attemptId);
    expect(after.status).toBe('verified');

    const colliding = new Request('https://example.test/webhooks/test_fake', {
      method: 'POST',
      headers: { 'x-test-signature': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'evt_1',
        resourceId: bound?.providerResourceId,
        type: 'inquiry.completed',
        status: 'declined',
      }),
    });
    await expect(platform.ingestWebhook({
      provider: 'test_fake',
      tenantKey: 'default',
      request: colliding,
    })).rejects.toBeInstanceOf(WebhookSecurityIncidentError);
    void attempt;
  });

  it('drains new traffic without invalidating verified decisions', async () => {
    const verified = createFakeAdapterForScenario('verified');
    const { platform } = createTestPlatform({ adapters: [verified] });
    await platform.start(userActor, startCommand);
    const allowed = await platform.evaluateProtectedAction(userActor, {
      action: 'payout',
      resourceType: 'account',
      resourceReference: 'acct_1',
      subjectReference: startCommand.subjectReference,
    });
    expect(allowed).toEqual({ allowed: true });
    await platform.admin.emergencyDrain(operatorA, 'test_fake', 'sandbox', 'incident');
    await expect(platform.start(userActor, {
      ...startCommand,
      idempotencyKey: 'idem_after_drain',
      subjectReference: 'sub_opaque_unverified_peer',
    })).rejects.toMatchObject({
      code: 'NO_ELIGIBLE_ROUTE',
    });
    const stillAllowed = await platform.evaluateProtectedAction(userActor, {
      action: 'payout',
      resourceType: 'account',
      resourceReference: 'acct_1',
      subjectReference: startCommand.subjectReference,
    });
    expect(stillAllowed).toEqual({ allowed: true });
    const original = await platform.status(userActor, (await platform.admin.attempts(operatorA) as Array<{ id: string }>)[0]!.id);
    expect(original.status).toBe('verified');
  });

  it('reuses an unexpired verified decision without a second provider create', async () => {
    const adapter = createFakeAdapterForScenario('verified');
    let creates = 0;
    const original = adapter.createAttempt.bind(adapter);
    adapter.createAttempt = async (command) => {
      creates += 1;
      return original(command);
    };
    const { platform } = createTestPlatform({ adapters: [adapter] });
    const first = await platform.start(userActor, startCommand);
    expect(first.status).toBe('verified');
    const second = await platform.start(userActor, { ...startCommand, idempotencyKey: 'idem_reuse_decision' });
    expect(second.attemptId).toBe(first.attemptId);
    expect(creates).toBe(1);
  });

  it('claims and processes leased webhook workers', async () => {
    const { platform, queue } = createTestPlatform({ adapters: [createWebhookAdapter('input_required')] });
    const started = await platform.start(userActor, { ...startCommand, idempotencyKey: 'idem_worker' });
    const attempt = await platform.admin.attempts(operatorA);
    const bound = (attempt as Array<{ id: string; providerResourceId: string | null }>).find((row) => row.id === started.attemptId);
    const body = JSON.stringify({
      eventId: 'evt_worker_1',
      resourceId: bound?.providerResourceId,
      type: 'inquiry.completed',
      status: 'verified',
    });
    await platform.ingestWebhook({
      provider: 'test_fake',
      tenantKey: 'default',
      request: new Request('https://example.test/webhooks/test_fake', {
        method: 'POST',
        headers: { 'x-test-signature': 'valid', 'content-type': 'application/json' },
        body,
      }),
    });
    const leases = await platform.workers.claim(operatorA, { workerId: 'w-claim', kinds: ['webhook'], limit: 4 });
    expect(leases.length).toBeGreaterThan(0);
    const processed = await platform.workers.process(operatorA, leases[0]!);
    expect(processed.disposition).toBe('completed');
    expect((await platform.status(userActor, started.attemptId)).status).toBe('verified');
    expect(queue).toBeTruthy();
  });

  it('requires production retention values before activation', async () => {
    const { platform } = createTestPlatform({ runtime: { productionEnabled: true } });
    const proposed = await platform.admin.proposePolicy(operatorA, {
      version: 'prod-1',
      environment: 'production',
      reason: 'missing retention',
    });
    await platform.admin.approvePolicy(operatorB, proposed.policyId, 'approved');
    await expect(platform.admin.activatePolicy(operatorA, proposed.policyId)).rejects.toMatchObject({
      code: 'PRODUCTION_NOT_ACTIVATED',
    });
    const complete = await platform.admin.proposePolicy(operatorA, {
      version: 'prod-2',
      environment: 'production',
      reason: 'complete retention',
      decisionRetentionDays: 365,
      providerRedactionDelayDays: 30,
      appealHoldDays: 14,
      legalHold: false,
    });
    await platform.admin.approvePolicy(operatorB, complete.policyId, 'approved');
    await expect(platform.admin.activatePolicy(operatorA, complete.policyId)).resolves.toEqual({ policyId: complete.policyId });
  });
});
