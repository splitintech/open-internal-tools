import type { ActorContext } from '@splitin/verification-adapter-sdk';

import { VerificationHttpError } from '../src/errors.ts';
import type {
  SessionEnvelopeV1,
  VerificationServerPlatform,
} from '../src/types.ts';

function nowIso(): string {
  return '2026-01-01T00:00:00.000Z';
}

function session(attemptId: string, status: SessionEnvelopeV1['status'] = 'pending_user_input'): SessionEnvelopeV1 {
  return {
    contractVersion: '1.0.0',
    attemptId,
    packageCode: 'human_idv',
    status,
    presentation: 'embedded',
    launch: {
      attemptId,
      canonicalStatus: status,
      launcherKey: 'test_embedded',
      presentation: 'embedded',
      providerDisclosure: 'Test provider',
      transientSecret: `mem_${attemptId}`,
      transientSecretExpiresAt: '2026-01-01T00:05:00.000Z',
      continuationReference: `cont_${attemptId}`,
    },
    launcherKey: 'test_embedded',
    providerDisclosure: 'Test provider',
    safeErrorCode: null,
    retryAfter: null,
    supportPath: '/support/verification',
    expiresAt: '2026-01-01T01:00:00.000Z',
    canResume: status !== 'canceled' && status !== 'verified',
    canRetry: status === 'canceled' || status === 'failed',
    continuation: {
      key: 'verification.resume',
      token: `tok_${attemptId}`,
      expiresAt: '2026-01-01T00:15:00.000Z',
    },
  };
}

export function createFakePlatform(): VerificationServerPlatform & { secrets: string[] } {
  const sessions = new Map<string, SessionEnvelopeV1>();
  const idempotency = new Map<string, unknown>();
  const routeChanges: Array<Record<string, string | number | boolean | null>> = [];
  const exceptions: Array<Record<string, string | number | boolean | null>> = [];
  const secrets: string[] = [];

  const remember = <T>(key: string, produce: () => T): T => {
    const existing = idempotency.get(key);
    if (existing !== undefined) return existing as T;
    const value = produce();
    idempotency.set(key, value);
    return value;
  };

  return {
    secrets,
    async startSession(_actor, input, idempotencyKey) {
      return remember(`start:${idempotencyKey}`, () => {
        const attemptId = `att_${idempotencyKey.slice(0, 8)}`;
        const created = session(attemptId);
        if (input.packageCode) created.packageCode = input.packageCode;
        sessions.set(attemptId, created);
        if (created.launch?.transientSecret) secrets.push(created.launch.transientSecret);
        return created;
      });
    },
    async resumeSession(_actor, input) {
      const existing = sessions.get(input.attemptId) ?? session(input.attemptId);
      existing.status = 'pending_user_input';
      sessions.set(input.attemptId, existing);
      return existing;
    },
    async getSession(actor, attemptId) {
      const existing = sessions.get(attemptId);
      if (!existing) {
        throw new VerificationHttpError(404, 'NOT_FOUND', 'The verification session was not found.');
      }
      if (actor.actorType === 'user' && actor.actorId !== 'user_1') {
        throw new VerificationHttpError(403, 'FORBIDDEN', 'The actor is not authorized for this subject.');
      }
      return existing;
    },
    async retrySession(_actor, input) {
      const next = session(`${input.attemptId}_r`);
      sessions.set(next.attemptId, next);
      return next;
    },
    async pauseSession(_actor, input) {
      const existing = sessions.get(input.attemptId) ?? session(input.attemptId);
      existing.status = 'paused';
      existing.canResume = true;
      sessions.set(input.attemptId, existing);
      return { attemptId: input.attemptId, status: 'paused', paused: true, canResume: true };
    },
    async cancelSession(_actor, input) {
      const existing = sessions.get(input.attemptId) ?? session(input.attemptId);
      existing.status = 'canceled';
      existing.canRetry = true;
      sessions.set(input.attemptId, existing);
      return { attemptId: input.attemptId, status: 'canceled', canceled: true, canRetry: true };
    },
    async createAppeal(_actor, _input, idempotencyKey) {
      return remember(`appeal:${idempotencyKey}`, () => ({ appealId: `apl_${idempotencyKey.slice(0, 8)}`, status: 'open' as const }));
    },
    async createSupportEscalation(_actor, _input, idempotencyKey) {
      return remember(`esc:${idempotencyKey}`, () => ({ escalationId: `esc_${idempotencyKey.slice(0, 8)}`, status: 'open' as const }));
    },
    async ingestWebhook(provider, request) {
      const raw = await request.clone().text();
      if (/sk_live|whsec_/.test(raw)) secrets.push('leaked');
      return { accepted: true, duplicate: false, providerEventKey: `${provider}_evt_1` };
    },
    async evaluateProtectedAction(_actor, input) {
      if (input.action === 'example.allowed') return { allowed: true, enforcementActive: true, policyVersionId: 'pol_1' };
      return {
        allowed: false,
        code: 'VERIFICATION_REQUIRED',
        action: input.action,
        resourceHash: 'a'.repeat(64),
        requiredPackages: ['human_idv'],
        continuation: { key: 'verification.resume', token: 'cont_opaque', expiresAt: nowIso() },
        retryAfter: null,
        supportPath: '/support/verification',
      };
    },
    admin: {
      async health() {
        return { generatedAt: nowIso(), runtime: [{ provider: 'test_fake', enabled: true }], health: [{ provider: 'test_fake', status: 'healthy' }], alerts: [] };
      },
      async routes() {
        return { generatedAt: nowIso(), routes: [{ id: 'rte_1', lifecycle: 'draft' }], routeChanges };
      },
      async mutateRoute(actor: ActorContext, input) {
        if (input.operation === 'propose') {
          const row = { id: `chg_${actor.actorId}`, status: 'proposed', proposedBy: actor.actorId, action: input.action ?? 'drain', reasonCode: input.reasonCode ?? 'operator_requested_drain' };
          routeChanges.push(row);
          return row;
        }
        const row = routeChanges.find((item) => item.id === input.requestId);
        if (!row) return { id: input.requestId ?? 'missing', status: 'missing' };
        if (input.operation === 'approve') {
          row.status = 'approved';
          row.approvedBy = actor.actorId;
        }
        if (input.operation === 'apply') row.status = 'applied';
        return row;
      },
      async circuits() {
        return { generatedAt: nowIso(), circuits: [{ provider: 'test_fake', status: 'healthy' }] };
      },
      async setCircuit(_actor, input) {
        return { provider: input.provider, status: input.status };
      },
      async attempts() {
        return { generatedAt: nowIso(), attempts: [...sessions.values()].map((item) => ({ id: item.attemptId, status: item.status, package_code: String(item.packageCode) })) };
      },
      async review() {
        return { generatedAt: nowIso(), appeals: [{ id: 'apl_open', status: 'open', reason_code: 'decision_appeal' }], manualExceptions: exceptions, policyVersions: [{ id: 'pol_1', version: '1' }] };
      },
      async mutateReview(actor, input) {
        if (input.operation === 'propose_manual_exception') {
          const row = { id: `exc_${actor.actorId}`, status: 'proposed', proposedBy: actor.actorId, decision: input.decision ?? 'deny' };
          exceptions.push(row);
          return row;
        }
        const row = exceptions.find((item) => item.id === input.requestId) ?? { id: input.requestId ?? 'missing' };
        if (input.operation === 'approve_manual_exception') {
          row.status = 'approved';
          row.approvedBy = actor.actorId;
        }
        if (input.operation === 'apply_manual_exception') row.status = 'applied';
        if (input.operation === 'begin_appeal_review') return { id: input.appealId ?? 'apl', status: 'in_review' };
        return row;
      },
      async audit() {
        return { generatedAt: nowIso(), audit: [{ id: 'aud_1', action: 'session.start' }] };
      },
      async reconciliation() {
        return { generatedAt: nowIso(), jobs: [], queues: { reconciliation: 0, redaction: 0, deadLetter: 0 } };
      },
      async enqueueReconciliation(_actor, input) {
        return { id: input.attemptId, queued: true };
      },
      async redaction() {
        return { generatedAt: nowIso(), privacyRequests: [{ id: 'prv_1', status: 'requested' }], jobs: [] };
      },
      async approveRedaction(_actor, input) {
        return { id: input.privacyRequestId, status: 'approved' };
      },
    },
    workers: {
      async claim(_actor, input) {
        return { leases: [{ leaseId: 'lease_1', jobId: 'job_1', queue: input.queue }] };
      },
      async process() {
        return { processed: true, disposition: 'completed' as const };
      },
    },
  };
}

export const userActor: ActorContext = {
  tenantKey: 'default',
  actorId: 'user_1',
  actorType: 'user',
  roles: ['subject'],
  authorizedSubjectScope: ['user_1'],
};

export const operatorActor: ActorContext = {
  tenantKey: 'default',
  actorId: 'ops_1',
  actorType: 'operator',
  roles: ['operator'],
  authorizedSubjectScope: ['*'],
};

export const approverActor: ActorContext = {
  tenantKey: 'default',
  actorId: 'ops_2',
  actorType: 'operator',
  roles: ['approver', 'operator'],
  authorizedSubjectScope: ['*'],
};

export const workerActor: ActorContext = {
  tenantKey: 'default',
  actorId: 'worker_1',
  actorType: 'system',
  roles: ['worker'],
  authorizedSubjectScope: ['*'],
};
