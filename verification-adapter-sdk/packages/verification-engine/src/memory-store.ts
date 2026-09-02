import { hmacSha256Hex, newId } from './hash.ts';
import type { PolicyStore, VerificationStore } from './store.ts';
import type {
  AppealRecord,
  AttemptRecord,
  AuditEventRecord,
  CircuitRecord,
  ConfigurationRevisionRecord,
  ContinuationRecord,
  DecisionRecord,
  HealthObservationRecord,
  IdempotencyClaimRecord,
  JobRecord,
  ManualDecisionProposalRecord,
  PolicyVersionRecord,
  ProtectedActionRequirementRecord,
  ProviderDefinitionRecord,
  ProviderResourceLineageRecord,
  QueueJobKind,
  RedactionStatus,
  ReviewCaseRecord,
  RouteChangeRequestRecord,
  RouteRecord,
  TenantRecord,
  VerificationPackageCode,
  VerificationProviderCode,
  VerificationProviderEnvironment,
  WebhookEventRecord,
} from './types.ts';

class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface MemoryStoreOptions {
  hashSecret?: string;
  now?: () => Date;
  seedTenantKey?: string;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): VerificationStore & PolicyStore {
  const hashSecret = options.hashSecret ?? 'test-verification-hash-secret';
  const nowFn = options.now ?? (() => new Date());
  const seedTenantKey = options.seedTenantKey ?? 'default';
  const mutex = new AsyncMutex();
  const keyLocks = new Map<string, AsyncMutex>();

  const tenants = new Map<string, TenantRecord>();
  const configs = new Map<string, ConfigurationRevisionRecord>();
  const providers = new Map<string, ProviderDefinitionRecord>();
  const routes = new Map<string, RouteRecord>();
  const routeChanges = new Map<string, RouteChangeRequestRecord>();
  const policies = new Map<string, PolicyVersionRecord>();
  const requirements = new Map<string, ProtectedActionRequirementRecord>();
  const attempts = new Map<string, AttemptRecord>();
  const lineage = new Map<string, ProviderResourceLineageRecord>();
  const decisions = new Map<string, DecisionRecord>();
  const idempotency = new Map<string, IdempotencyClaimRecord>();
  const webhooks = new Map<string, WebhookEventRecord>();
  const health = new Map<string, HealthObservationRecord>();
  const circuits = new Map<string, CircuitRecord>();
  const appeals = new Map<string, AppealRecord>();
  const reviews = new Map<string, ReviewCaseRecord>();
  const proposals = new Map<string, ManualDecisionProposalRecord>();
  const continuations = new Map<string, ContinuationRecord>();
  const audit = new Map<string, AuditEventRecord>();
  const jobs = new Map<string, JobRecord>();

  const iso = () => nowFn().toISOString();
  const k = (...parts: string[]) => parts.join('::');
  const lockFor = (key: string) => {
    let lock = keyLocks.get(key);
    if (!lock) {
      lock = new AsyncMutex();
      keyLocks.set(key, lock);
    }
    return lock;
  };

  const seedTenant: TenantRecord = {
    tenantKey: seedTenantKey,
    displayName: 'Default tenant',
    continuationDestinations: ['verification.resume', 'application.home'],
    createdAt: iso(),
  };
  tenants.set(seedTenantKey, seedTenant);

  const sandboxPolicy: PolicyVersionRecord = {
    tenantKey: seedTenantKey,
    id: 'pol_sandbox_example',
    version: 'sandbox-example-1',
    environment: 'sandbox',
    lifecycle: 'active',
    reason: 'Seeded sandbox example policy',
    expiresAt: null,
    proposedByActorId: 'system:seed',
    approvedByActorId: 'system:seed-approver',
    approvedAt: iso(),
    activatedAt: iso(),
    createdAt: iso(),
    decisionRetentionDays: null,
    providerRedactionDelayDays: null,
    appealHoldDays: null,
    legalHold: false,
  };
  policies.set(k(seedTenantKey, sandboxPolicy.id), sandboxPolicy);

  const store: VerificationStore = {
    now: nowFn,
    async hashSubject(tenantKey, subjectReference) {
      return hmacSha256Hex(hashSecret, `subject:${tenantKey}:${subjectReference}`);
    },
    async hashResource(tenantKey, resourceType, resourceReference) {
      return hmacSha256Hex(hashSecret, `resource:${tenantKey}:${resourceType}:${resourceReference}`);
    },
    transact(fn) {
      return mutex.run(() => fn(store));
    },
    async getTenant(tenantKey) {
      return tenants.get(tenantKey) ? clone(tenants.get(tenantKey)!) : null;
    },
    async ensureTenant(tenantKey, displayName = tenantKey) {
      const existing = tenants.get(tenantKey);
      if (existing) return clone(existing);
      const created: TenantRecord = {
        tenantKey,
        displayName,
        continuationDestinations: ['verification.resume'],
        createdAt: iso(),
      };
      tenants.set(tenantKey, created);
      return clone(created);
    },
    async getConfigurationRevision(tenantKey, id) {
      const row = configs.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listConfigurationRevisions(tenantKey) {
      return [...configs.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async saveConfigurationRevision(revision) {
      configs.set(k(revision.tenantKey, revision.id), clone(revision));
    },
    async upsertProviderDefinition(definition) {
      providers.set(k(definition.tenantKey, definition.provider, definition.environment), clone(definition));
    },
    async getProviderDefinition(tenantKey, provider, environment) {
      const row = providers.get(k(tenantKey, provider, environment));
      return row ? clone(row) : null;
    },
    async listProviderDefinitions(tenantKey) {
      return [...providers.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async getRoute(tenantKey, routeId) {
      const row = routes.get(k(tenantKey, routeId));
      return row ? clone(row) : null;
    },
    async listRoutes(tenantKey) {
      return [...routes.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async listActiveRoutes(tenantKey, environment) {
      return [...routes.values()]
        .filter((row) => row.tenantKey === tenantKey && row.environment === environment && row.lifecycle === 'active')
        .map(clone);
    },
    async saveRoute(route) {
      routes.set(k(route.tenantKey, route.id), clone(route));
    },
    async saveRouteChangeRequest(request) {
      routeChanges.set(k(request.tenantKey, request.id), clone(request));
    },
    async getRouteChangeRequest(tenantKey, id) {
      const row = routeChanges.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listRouteChangeRequests(tenantKey) {
      return [...routeChanges.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async getActivePolicy(tenantKey, environment) {
      const match = [...policies.values()].find(
        (row) => row.tenantKey === tenantKey && row.environment === environment && row.lifecycle === 'active',
      );
      return match ? clone(match) : null;
    },
    async getPolicyVersion(tenantKey, id) {
      const row = policies.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listPolicyVersions(tenantKey) {
      return [...policies.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async savePolicyVersion(policy) {
      if (policy.lifecycle === 'active') {
        for (const [key, row] of policies) {
          if (row.tenantKey === policy.tenantKey && row.environment === policy.environment && row.lifecycle === 'active' && row.id !== policy.id) {
            policies.set(key, { ...row, lifecycle: 'retired' });
          }
        }
      }
      policies.set(k(policy.tenantKey, policy.id), clone(policy));
    },
    async listProtectedActionRequirements(tenantKey, action, policyVersionId) {
      return [...requirements.values()]
        .filter((row) => row.tenantKey === tenantKey && row.action === action && row.policyVersionId === policyVersionId)
        .map(clone);
    },
    async saveProtectedActionRequirement(requirement) {
      requirements.set(k(requirement.tenantKey, requirement.id), clone(requirement));
    },
    async getContinuationDestinations(tenantKey) {
      const tenant = tenants.get(tenantKey);
      return tenant ? [...tenant.continuationDestinations] : ['verification.resume'];
    },
    async getAttempt(tenantKey, attemptId) {
      const row = attempts.get(k(tenantKey, attemptId));
      return row ? clone(row) : null;
    },
    async getAttemptByIdempotencyKey(tenantKey, key) {
      const match = [...attempts.values()].find((row) => row.tenantKey === tenantKey && row.idempotencyKey === key);
      return match ? clone(match) : null;
    },
    async findAttemptByProviderResource(tenantKey, provider, providerResourceId) {
      const match = [...attempts.values()].find(
        (row) => row.tenantKey === tenantKey && row.provider === provider && row.providerResourceId === providerResourceId,
      );
      return match ? clone(match) : null;
    },
    async listAttempts(tenantKey) {
      return [...attempts.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async listLiveAttempts(tenantKey, subjectHash, packageCode: VerificationPackageCode) {
      const live = new Set(['created', 'pending_user_input', 'paused', 'processing', 'manual_review_required']);
      return [...attempts.values()]
        .filter((row) => row.tenantKey === tenantKey && row.subjectHash === subjectHash && row.packageCode === packageCode && live.has(row.canonicalStatus))
        .map(clone);
    },
    async insertAttempt(attempt) {
      const key = k(attempt.tenantKey, attempt.id);
      if (attempts.has(key)) throw new Error('Attempt already exists.');
      const idemKey = k(attempt.tenantKey, 'idem', attempt.idempotencyKey);
      if ([...attempts.values()].some((row) => row.tenantKey === attempt.tenantKey && row.idempotencyKey === attempt.idempotencyKey)) {
        throw new Error('Idempotency key already used.');
      }
      attempts.set(key, clone(attempt));
      void idemKey;
      return clone(attempt);
    },
    async updateAttempt(attempt) {
      attempts.set(k(attempt.tenantKey, attempt.id), clone(attempt));
    },
    async insertLineage(row) {
      lineage.set(k(row.tenantKey, row.id), clone(row));
    },
    async listLineage(tenantKey, attemptId) {
      return [...lineage.values()].filter((row) => row.tenantKey === tenantKey && row.attemptId === attemptId).map(clone);
    },
    async getValidDecision(tenantKey, subjectHash, packageCode, at) {
      const matches = [...decisions.values()]
        .filter((row) => (
          row.tenantKey === tenantKey
          && row.subjectHash === subjectHash
          && row.packageCode === packageCode
          && row.status === 'verified'
          && !row.revokedAt
          && (!row.expiresAt || row.expiresAt > at.toISOString())
        ))
        .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt));
      return matches[0] ? clone(matches[0]) : null;
    },
    async insertDecision(decision) {
      decisions.set(k(decision.tenantKey, decision.id), clone(decision));
    },
    async listDecisions(tenantKey, subjectHash) {
      return [...decisions.values()]
        .filter((row) => row.tenantKey === tenantKey && (!subjectHash || row.subjectHash === subjectHash))
        .map(clone);
    },
    async revokeDecision(tenantKey, decisionId, at) {
      const row = decisions.get(k(tenantKey, decisionId));
      if (row) decisions.set(k(tenantKey, decisionId), { ...row, status: 'revoked', revokedAt: at });
    },
    async claimIdempotency(claim) {
      return lockFor(k(claim.tenantKey, claim.claimKey)).run(async () => {
        const existing = idempotency.get(k(claim.tenantKey, claim.claimKey));
        if (existing) return { disposition: 'existing' as const, claim: clone(existing) };
        idempotency.set(k(claim.tenantKey, claim.claimKey), clone(claim));
        return { disposition: 'claimed' as const, claim: clone(claim) };
      });
    },
    async completeIdempotency(tenantKey, key, resultRef) {
      const row = idempotency.get(k(tenantKey, key));
      if (row) {
        idempotency.set(k(tenantKey, key), {
          ...row,
          state: 'completed',
          resultRef,
          completedAt: iso(),
        });
      }
    },
    async failIdempotency(tenantKey, key, errorCode) {
      const row = idempotency.get(k(tenantKey, key));
      if (row) {
        idempotency.set(k(tenantKey, key), {
          ...row,
          state: 'failed',
          errorCode,
          completedAt: iso(),
        });
      }
    },
    async getIdempotencyClaim(tenantKey, key) {
      const row = idempotency.get(k(tenantKey, key));
      return row ? clone(row) : null;
    },
    async claimWebhookEvent(input) {
      const key = k(input.tenantKey, input.provider, input.providerEventKey);
      const existing = webhooks.get(key);
      if (existing) {
        if (existing.bodySha256 !== input.bodySha256) {
          const dead: WebhookEventRecord = { ...existing, state: 'dead_letter' };
          webhooks.set(key, dead);
          return { disposition: 'mismatch' as const, event: clone(dead) };
        }
        return { disposition: 'duplicate' as const, event: clone(existing) };
      }
      const event: WebhookEventRecord = {
        tenantKey: input.tenantKey,
        id: newId('wh'),
        provider: input.provider,
        providerEventKey: input.providerEventKey,
        providerResourceId: input.providerResourceId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        bodySha256: input.bodySha256,
        safeMetadata: input.safeMetadata,
        state: 'accepted',
        receivedAt: iso(),
      };
      webhooks.set(key, event);
      return { disposition: 'claimed', event: clone(event) };
    },
    async getWebhookEvent(tenantKey, provider, eventKey) {
      const row = webhooks.get(k(tenantKey, provider, eventKey));
      return row ? clone(row) : null;
    },
    async getWebhookEventById(tenantKey, eventId) {
      const row = [...webhooks.values()].find((event) => event.tenantKey === tenantKey && event.id === eventId);
      return row ? clone(row) : null;
    },
    async settleWebhookEvent(tenantKey, eventId, outcome) {
      for (const [key, row] of webhooks) {
        if (row.tenantKey === tenantKey && row.id === eventId) {
          webhooks.set(key, { ...row, state: outcome });
        }
      }
    },
    async recordHealth(observation) {
      health.set(k(observation.tenantKey, observation.id), clone(observation));
    },
    async listHealth(tenantKey, provider?: VerificationProviderCode) {
      return [...health.values()]
        .filter((row) => row.tenantKey === tenantKey && (!provider || row.provider === provider))
        .map(clone);
    },
    async getCircuit(tenantKey, provider, environment: VerificationProviderEnvironment) {
      const key = k(tenantKey, provider, environment);
      const existing = circuits.get(key);
      if (existing) return clone(existing);
      const created: CircuitRecord = {
        tenantKey,
        provider,
        environment,
        state: 'closed',
        reasonCode: null,
        openUntil: null,
        consecutiveFailures: 0,
        drainedByActorId: null,
        updatedAt: iso(),
      };
      circuits.set(key, created);
      return clone(created);
    },
    async saveCircuit(circuit) {
      circuits.set(k(circuit.tenantKey, circuit.provider, circuit.environment), clone(circuit));
    },
    async listCircuits(tenantKey) {
      return [...circuits.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async saveAppeal(appeal) {
      appeals.set(k(appeal.tenantKey, appeal.id), clone(appeal));
    },
    async getAppeal(tenantKey, id) {
      const row = appeals.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listAppeals(tenantKey) {
      return [...appeals.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async saveReviewCase(reviewCase) {
      reviews.set(k(reviewCase.tenantKey, reviewCase.id), clone(reviewCase));
    },
    async getReviewCase(tenantKey, id) {
      const row = reviews.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listReviewCases(tenantKey) {
      return [...reviews.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async saveManualDecisionProposal(proposal) {
      proposals.set(k(proposal.tenantKey, proposal.id), clone(proposal));
    },
    async getManualDecisionProposal(tenantKey, id) {
      const row = proposals.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listManualDecisionProposals(tenantKey) {
      return [...proposals.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async saveContinuation(continuation) {
      continuations.set(k(continuation.tenantKey, continuation.key), clone(continuation));
    },
    async getContinuation(tenantKey, key) {
      const row = continuations.get(k(tenantKey, key));
      return row ? clone(row) : null;
    },
    async appendAudit(event) {
      audit.set(k(event.tenantKey, event.id), clone(event));
    },
    async listAudit(tenantKey) {
      return [...audit.values()].filter((row) => row.tenantKey === tenantKey).map(clone);
    },
    async saveJob(job) {
      jobs.set(k(job.tenantKey, job.id), clone(job));
    },
    async getJob(tenantKey, id) {
      const row = jobs.get(k(tenantKey, id));
      return row ? clone(row) : null;
    },
    async listJobs(tenantKey, kind?: QueueJobKind) {
      return [...jobs.values()].filter((row) => row.tenantKey === tenantKey && (!kind || row.kind === kind)).map(clone);
    },
    async claimJobs(input) {
      const claimed: JobRecord[] = [];
      const pending = ['scheduled', 'retryable', 'processing'];
      for (const [key, job] of jobs) {
        if (claimed.length >= input.limit) break;
        if (job.tenantKey !== input.tenantKey || !input.kinds.includes(job.kind)) continue;
        if (!pending.includes(job.state) && job.state !== 'processing') continue;
        if (job.state === 'processing' && job.leaseExpiresAt && job.leaseExpiresAt > input.now.toISOString()) continue;
        if (job.nextAttemptAt > input.now.toISOString()) continue;
        const next: JobRecord = {
          ...job,
          state: job.kind === 'redact' ? 'processing' : 'processing',
          leaseId: newId('lease'),
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString(),
          attemptCount: job.attemptCount + 1,
        };
        jobs.set(key, next);
        claimed.push(clone(next));
      }
      return claimed;
    },
    async updateJob(job) {
      jobs.set(k(job.tenantKey, job.id), clone(job));
    },
    async updateRedactionStatus(tenantKey, jobId, status: RedactionStatus) {
      const row = jobs.get(k(tenantKey, jobId));
      if (row) jobs.set(k(tenantKey, jobId), { ...row, state: status });
    },
  };

  return store;
}
