import type { ActorContext, ProtectedActionDenial } from '@splitin/verification-adapter-sdk';
import {
  AuthorizationError,
  ClientRouteInjectionError,
  EngineError,
  type SafeAttemptView,
  type VerificationPlatform,
} from '@splitin/verification-engine';

import { VerificationHttpError } from './errors.ts';
import {
  SESSION_CONTRACT_VERSION,
  type AdminAttemptsSnapshot,
  type AdminAuditSnapshot,
  type AdminCircuitsSnapshot,
  type AdminHealthSnapshot,
  type AdminReconciliationSnapshot,
  type AdminRedactionSnapshot,
  type AdminReviewSnapshot,
  type AdminRoutesSnapshot,
  type ProtectedActionDecision,
  type SafeAdminRecord,
  type SessionEnvelopeV1,
  type VerificationServerPlatform,
  type WorkerProcessResult,
} from './types.ts';

export function createEngineServerPlatform(platform: VerificationPlatform): VerificationServerPlatform {
  return {
    async startSession(actor, input, idempotencyKey, request) {
      const view = await mapEngine(() => platform.start(actor, {
        packageCode: input.packageCode,
        countryCode: input.countryCode ?? 'US',
        subjectReference: requireSubject(actor, input.subjectReference),
        idempotencyKey,
        action: input.action,
        resourceType: input.resourceType,
        resourceReference: input.resourceReference,
        organization: input.organization,
        relationship: input.relationship,
        associatedPerson: input.associatedPerson,
        legalFirstName: input.legalFirstName,
        legalLastName: input.legalLastName,
        email: input.email,
        requestOrigin: request.headers.get('origin'),
        metadata: input.metadata,
        evidenceReferences: input.evidenceReferences,
      }));
      return toSessionEnvelope(view);
    },
    async resumeSession(actor, input, request) {
      return toSessionEnvelope(await mapEngine(() => platform.resume(actor, {
        attemptId: input.attemptId,
        requestOrigin: request.headers.get('origin'),
      })));
    },
    async getSession(actor, attemptId) {
      return toSessionEnvelope(await mapEngine(() => platform.status(actor, attemptId)));
    },
    async retrySession(actor, input, request) {
      const current = await mapEngine(() => platform.status(actor, input.attemptId));
      return toSessionEnvelope(await mapEngine(() => platform.retry(actor, {
        parentAttemptId: input.attemptId,
        packageCode: current.packageCode,
        countryCode: 'US',
        subjectReference: requireSubject(actor, undefined),
        idempotencyKey: input.idempotencyKey,
        requestOrigin: request.headers.get('origin'),
      })));
    },
    async pauseSession(actor, input) {
      const view = await mapEngine(() => platform.pause(actor, input.attemptId));
      return { attemptId: view.attemptId, status: view.status, paused: true, canResume: view.canResume, canRetry: view.canRetry };
    },
    async cancelSession(actor, input) {
      const view = await mapEngine(() => platform.cancel(actor, input.attemptId));
      return { attemptId: view.attemptId, status: view.status, canceled: true, canResume: view.canResume, canRetry: view.canRetry };
    },
    async createAppeal(actor, input) {
      const attemptId = input.attemptId;
      if (!attemptId) throw new VerificationHttpError(400, 'INVALID_REQUEST', 'An attempt ID is required.');
      const result = await mapEngine(() => platform.appeal.submit(actor, {
        attemptId,
        reason: input.reasonCode,
      }));
      return { appealId: result.appealId, status: 'open' };
    },
    async createSupportEscalation(_actor, _input, idempotencyKey) {
      return { escalationId: `esc_${idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`, status: 'open' };
    },
    async ingestWebhook(provider, request) {
      const result = await mapEngine(() => platform.ingestWebhook({
        provider,
        request,
        tenantKey: 'default',
      }));
      return { accepted: result.accepted, duplicate: result.duplicate, providerEventKey: result.eventId };
    },
    async evaluateProtectedAction(actor, input): Promise<ProtectedActionDecision> {
      const result = await mapEngine(() => platform.evaluateProtectedAction(actor, {
        action: input.action,
        resourceType: input.resourceType ?? 'resource',
        resourceReference: input.resourceReference ?? requireSubject(actor, undefined),
        subjectReference: requireSubject(actor, undefined),
      }));
      if ('allowed' in result && result.allowed) {
        return { allowed: true, enforcementActive: true };
      }
      return { allowed: false, ...(result as ProtectedActionDenial) };
    },
    admin: {
      async health(actor): Promise<AdminHealthSnapshot> {
        const payload = await mapEngine(() => platform.admin.health(actor));
        return { generatedAt: nowIso(), runtime: asRecords(payload), health: [], alerts: [] };
      },
      async routes(actor): Promise<AdminRoutesSnapshot> {
        const payload = await mapEngine(() => platform.admin.routes(actor));
        return { generatedAt: nowIso(), routes: asRecords(payload), routeChanges: [] };
      },
      async mutateRoute(actor, input) {
        if (input.operation === 'approve') {
          const result = await mapEngine(() => platform.admin.approveRoute(actor, input.requestId ?? '', input.reasonCode ?? 'approved'));
          return flatten(result);
        }
        if (input.operation === 'propose') {
          throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Route proposals require a complete route payload on the engine admin API.');
        }
        throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Unsupported route operation.');
      },
      async circuits(actor): Promise<AdminCircuitsSnapshot> {
        const payload = await mapEngine(() => platform.admin.circuits(actor));
        return { generatedAt: nowIso(), circuits: asRecords(payload) };
      },
      async setCircuit(actor, input) {
        if (input.status === 'circuit_open') {
          const result = await mapEngine(() => platform.admin.emergencyDrain(actor, input.provider, input.providerEnvironment, input.errorCode ?? 'admin_circuit'));
          return flatten(result);
        }
        return { provider: input.provider, status: input.status };
      },
      async attempts(actor): Promise<AdminAttemptsSnapshot> {
        const payload = await mapEngine(() => platform.admin.attempts(actor));
        return { generatedAt: nowIso(), attempts: asRecords(payload) };
      },
      async review(_actor): Promise<AdminReviewSnapshot> {
        return { generatedAt: nowIso(), appeals: [], manualExceptions: [], policyVersions: [] };
      },
      async mutateReview(actor, input) {
        const requestId = input.requestId;
        if (input.operation === 'approve_manual_exception' && requestId) {
          const result = await mapEngine(() => platform.review.decide(actor, {
            proposalId: requestId,
            transition: input.decision === 'deny' ? 'deny' : 'approve',
            reason: input.reasonCode ?? 'approved',
          }));
          return flatten(result);
        }
        if (input.operation === 'propose_manual_exception' && requestId) {
          const result = await mapEngine(() => platform.review.propose(actor, {
            attemptId: requestId,
            proposedStatus: 'verified',
            reason: input.reasonCode ?? 'proposed',
          }));
          return flatten(result);
        }
        throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Unsupported review operation.');
      },
      async audit(actor): Promise<AdminAuditSnapshot> {
        const payload = await mapEngine(() => platform.admin.audit(actor));
        return { generatedAt: nowIso(), audit: asRecords(payload) };
      },
      async reconciliation(_actor): Promise<AdminReconciliationSnapshot> {
        return { generatedAt: nowIso(), jobs: [], queues: {} };
      },
      async enqueueReconciliation(actor, input) {
        const result = await mapEngine(() => platform.reconcile(actor, input.attemptId));
        return flatten(result);
      },
      async redaction(_actor): Promise<AdminRedactionSnapshot> {
        return { generatedAt: nowIso(), privacyRequests: [], jobs: [] };
      },
      async approveRedaction(actor, input) {
        const result = await mapEngine(() => platform.redact(actor, {
          subjectReference: requireSubject(actor, undefined),
          requestReference: input.privacyRequestId,
        }));
        return flatten(result);
      },
    },
    workers: {
      async claim(actor, input) {
        const kinds = input.queue === 'reconciliation'
          ? ['reconcile' as const]
          : input.queue === 'dead_letter'
            ? ['webhook' as const, 'reconcile' as const, 'redact' as const]
            : [input.queue === 'redaction' ? 'redact' as const : 'webhook' as const];
        const jobs = await mapEngine(() => platform.workers.claim(actor, {
          workerId: actor.actorId,
          kinds,
          limit: input.limit ?? 8,
        }));
        return {
          leases: jobs.map((job) => ({
            leaseId: job.leaseId ?? job.id,
            jobId: job.id,
            queue: input.queue,
          })),
        };
      },
      async process(actor, input) {
        const result = await mapEngine(() => platform.workers.process(actor, { id: input.jobId }));
        return { processed: result.processed, disposition: result.disposition as WorkerProcessResult['disposition'] };
      },
    },
  };
}

function toSessionEnvelope(view: SafeAttemptView): SessionEnvelopeV1 {
  return {
    contractVersion: SESSION_CONTRACT_VERSION,
    attemptId: view.attemptId,
    packageCode: view.packageCode,
    status: view.status,
    presentation: view.launch?.presentation ?? 'none',
    launch: view.launch,
    launcherKey: view.launch?.launcherKey ?? null,
    providerDisclosure: view.launch?.providerDisclosure ?? null,
    safeErrorCode: view.safeErrorCode,
    retryAfter: view.retryAfter,
    supportPath: view.supportPath,
    expiresAt: view.expiresAt,
    canResume: view.canResume,
    canRetry: view.canRetry,
    continuation: null,
  };
}

function requireSubject(actor: ActorContext, explicit?: string): string {
  const subject = explicit ?? actor.authorizedSubjectScope[0];
  if (!subject) throw new VerificationHttpError(400, 'INVALID_REQUEST', 'A subject reference is required.');
  return subject;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRecords(value: unknown): SafeAdminRecord[] {
  if (Array.isArray(value)) {
    return value.map((item) => flatten(item));
  }
  return [flatten(value)];
}

function flatten(value: unknown): SafeAdminRecord {
  if (!value || typeof value !== 'object') return { value: String(value) };
  const record: SafeAdminRecord = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === null || ['string', 'number', 'boolean'].includes(typeof nested)) {
      record[key] = nested as string | number | boolean | null;
    }
  }
  return record;
}

async function mapEngine<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VerificationHttpError) throw error;
    if (error instanceof AuthorizationError) {
      throw new VerificationHttpError(403, 'FORBIDDEN', error.message);
    }
    if (error instanceof ClientRouteInjectionError) {
      throw new VerificationHttpError(400, 'UNSUPPORTED_REQUEST_FIELD', error.message);
    }
    if (error instanceof EngineError) {
      const status = error.code === 'ATTEMPT_NOT_FOUND' ? 404
        : error.code === 'PRODUCTION_NOT_ACTIVATED' || error.code === 'NO_ELIGIBLE_ROUTE' ? 409
        : error.retryable ? 503 : 409;
      throw new VerificationHttpError(status, error.code, error.message, error.retryAfterSeconds ?? null);
    }
    throw error;
  }
}
