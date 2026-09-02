import { describe, expect, it } from 'vitest';

import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';

import { createTestPlatform, operatorA, operatorB, startCommand, userActor } from './helpers.ts';

describe('review, appeals, and governance', () => {
  it('requires distinct proposer and approver for manual decisions', async () => {
    const { platform } = createTestPlatform({ adapters: [createFakeAdapterForScenario('manual_review')] });
    const started = await platform.start(userActor, startCommand);
    const proposed = await platform.review.propose(operatorA, {
      attemptId: started.attemptId,
      proposedStatus: 'verified',
      reason: 'documents reviewed',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await expect(platform.review.decide(operatorA, {
      proposalId: proposed.proposalId,
      transition: 'approve',
      reason: 'self-approve',
    })).rejects.toMatchObject({ code: 'GOVERNANCE_TWO_ACTOR' });
    const approved = await platform.review.decide(operatorB, {
      proposalId: proposed.proposalId,
      transition: 'approve',
      reason: 'second actor',
    });
    expect(approved.status).toBe('approved');
    const allowed = await platform.evaluateProtectedAction(userActor, {
      action: 'sign_lease',
      resourceType: 'lease',
      resourceReference: 'lease_2',
      subjectReference: startCommand.subjectReference,
    });
    expect(allowed).toEqual({ allowed: true });
  });

  it('supports appeal transitions including request-more-information, revoke, and expire', async () => {
    const { platform } = createTestPlatform();
    const started = await platform.start(userActor, startCommand);
    const { appealId } = await platform.appeal.submit(userActor, {
      attemptId: started.attemptId,
      reason: 'incorrect decline',
    });
    const more = await platform.appeal.transition(operatorA, {
      appealId,
      transition: 'request_more_information',
      reason: 'need utility bill',
    });
    expect(more.status).toBe('more_information_requested');
    const denied = await platform.appeal.transition(operatorB, {
      appealId,
      transition: 'deny',
      reason: 'insufficient',
    });
    expect(denied.status).toBe('denied');
    const { appealId: second } = await platform.appeal.submit(userActor, {
      attemptId: started.attemptId,
      reason: 'retry appeal',
    });
    expect((await platform.appeal.transition(operatorA, { appealId: second, transition: 'approve', reason: 'ok' })).status).toBe('approved');
    const { appealId: third } = await platform.appeal.submit(userActor, {
      attemptId: started.attemptId,
      reason: 'revoke later',
    });
    expect((await platform.appeal.transition(operatorB, { appealId: third, transition: 'revoke', reason: 'fraud' })).status).toBe('revoked');
    const { appealId: fourth } = await platform.appeal.submit(userActor, {
      attemptId: started.attemptId,
      reason: 'expired window',
    });
    expect((await platform.appeal.transition(operatorA, { appealId: fourth, transition: 'expire', reason: 'timeout' })).status).toBe('expired');
  });

  it('stores application-defined reason codes without interpreting housing or biometric policy', async () => {
    const { platform, store } = createTestPlatform();
    const started = await platform.start(userActor, startCommand);
    await platform.appeal.submit(userActor, {
      attemptId: started.attemptId,
      reason: 'biometric_alternative_requested',
    });
    const attempt = await store.getAttempt('default', started.attemptId);
    expect(attempt?.normalizedReasonCodes).toContain('biometric_alternative_requested');
  });

  it('records governance metadata on audit events', async () => {
    const { platform } = createTestPlatform();
    await platform.start(userActor, startCommand);
    const { policyId } = await platform.admin.proposePolicy(operatorA, {
      version: 'gov-1',
      environment: 'sandbox',
      reason: 'tighten package list',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await platform.admin.approvePolicy(operatorB, policyId, 'approved');
    const audit = await platform.admin.audit(operatorA) as Array<{ operation: string; actorId: string }>;
    expect(audit.some((row) => row.operation === 'admin.propose_policy' && row.actorId === operatorA.actorId)).toBe(true);
    expect(audit.some((row) => row.operation === 'admin.approve_policy' && row.actorId === operatorB.actorId)).toBe(true);
  });
});
