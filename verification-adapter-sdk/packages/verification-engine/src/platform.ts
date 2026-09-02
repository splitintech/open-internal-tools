import {
  isTerminalStatus,
  ProviderError,
  ProviderOperationPendingError,
  toSafeProviderFailure,
  type ActorContext,
  type ProtectedActionDenial,
  type ProviderAttemptCommand,
  type ProviderHealthObservation,
  type ProviderLaunchEnvelope,
  type VerificationAdapterV1,
  type VerificationCanonicalStatus,
} from '@splitin/verification-adapter-sdk';

import { digestCanonical } from './canonical.ts';
import {
  AuthorizationError,
  EngineError,
  WebhookSecurityIncidentError,
} from './errors.ts';
import { assertNoClientRouting, assertStartCommand, twoActorApproved } from './guards.ts';
import { newId, randomToken, sha256Hex } from './hash.ts';
import { backoffSeconds, type VerificationQueue } from './queue.ts';
import { createRateBudget } from './rate-budget.ts';
import type { ProviderRegistry } from './registry.ts';
import { selectRoute } from './routing.ts';
import { seedSandboxExamples } from './seed.ts';
import { applyMonotonicStatus } from './status.ts';
import type { PolicyStore, VerificationStore } from './store.ts';
import { isApplicationReasonCode } from './types.ts';
import type {
  AppealSubmitCommand,
  AppealTransitionCommand,
  AttemptRecord,
  AuthorizeFn,
  EngineOperation,
  EngineRuntime,
  IngestWebhookCommand,
  IngestWebhookResult,
  JobRecord,
  ProtectedActionAllow,
  ProtectedActionCommand,
  ProtectedActionResult,
  RedactCommand,
  RedactionStatus,
  ResumeVerificationCommand,
  RetryVerificationCommand,
  ReviewCaseTransitionCommand,
  ReviewDecideCommand,
  ReviewProposeCommand,
  RouteRecord,
  SafeAttemptView,
  StartVerificationCommand,
} from './types.ts';

export interface CreateVerificationPlatformInput {
  registry: ProviderRegistry;
  store: VerificationStore;
  queue: VerificationQueue;
  policyStore?: PolicyStore;
  authorize: AuthorizeFn;
  runtime?: EngineRuntime;
}

export interface VerificationPlatform {
  start(actor: ActorContext, command: StartVerificationCommand): Promise<SafeAttemptView>;
  resume(actor: ActorContext, command: ResumeVerificationCommand): Promise<SafeAttemptView>;
  status(actor: ActorContext, attemptId: string): Promise<SafeAttemptView>;
  retry(actor: ActorContext, command: RetryVerificationCommand): Promise<SafeAttemptView>;
  pause(actor: ActorContext, attemptId: string): Promise<SafeAttemptView>;
  cancel(actor: ActorContext, attemptId: string): Promise<SafeAttemptView>;
  redact(actor: ActorContext, command: RedactCommand): Promise<{ jobId: string; status: string }>;
  ingestWebhook(command: IngestWebhookCommand): Promise<IngestWebhookResult>;
  processWebhookJob(tenantKey: string, job: JobRecord): Promise<void>;
  reconcile(actor: ActorContext, attemptId?: string): Promise<{ reconciled: number }>;
  appeal: {
    submit(actor: ActorContext, command: AppealSubmitCommand): Promise<{ appealId: string }>;
    transition(actor: ActorContext, command: AppealTransitionCommand): Promise<{ status: string }>;
  };
  review: {
    propose(actor: ActorContext, command: ReviewProposeCommand): Promise<{ proposalId: string; reviewCaseId: string }>;
    decide(actor: ActorContext, command: ReviewDecideCommand): Promise<{ status: string }>;
    transitionCase(actor: ActorContext, command: ReviewCaseTransitionCommand): Promise<{ status: string }>;
  };
  admin: {
    health(actor: ActorContext): Promise<unknown>;
    routes(actor: ActorContext): Promise<unknown>;
    circuits(actor: ActorContext): Promise<unknown>;
    attempts(actor: ActorContext): Promise<unknown>;
    audit(actor: ActorContext): Promise<unknown>;
    proposeRoute(actor: ActorContext, input: { route: Omit<RouteRecord, 'lifecycle' | 'approvedByActorId' | 'approvedAt' | 'activatedAt'>; reason: string }): Promise<{ requestId: string }>;
    approveRoute(actor: ActorContext, requestId: string, reason: string): Promise<{ routeId: string }>;
    proposePolicy(actor: ActorContext, input: {
      version: string;
      environment: 'sandbox' | 'production';
      reason: string;
      expiresAt?: string | null;
      decisionRetentionDays?: number | null;
      providerRedactionDelayDays?: number | null;
      appealHoldDays?: number | null;
      legalHold?: boolean;
    }): Promise<{ policyId: string }>;
    approvePolicy(actor: ActorContext, policyId: string, reason: string): Promise<{ policyId: string }>;
    activatePolicy(actor: ActorContext, policyId: string): Promise<{ policyId: string }>;
    emergencyDrain(actor: ActorContext, provider: string, environment: 'sandbox' | 'production', reason: string): Promise<{ state: string }>;
  };
  evaluateProtectedAction(actor: ActorContext, command: ProtectedActionCommand): Promise<ProtectedActionResult>;
  workers: {
    claim(actor: ActorContext, input?: { workerId?: string; kinds?: JobRecord['kind'][]; limit?: number }): Promise<JobRecord[]>;
    process(actor: ActorContext, job: JobRecord | { id: string }): Promise<{ processed: boolean; disposition: string }>;
    scheduleReconciliation(actor: ActorContext): Promise<{ enqueued: number }>;
  };
}

const CLIENT_OPS = new Set<EngineOperation>([
  'start', 'resume', 'status', 'retry', 'pause', 'cancel', 'evaluate_protected_action', 'appeal',
]);

export function createVerificationPlatform(input: CreateVerificationPlatformInput): VerificationPlatform {
  const runtime: EngineRuntime = input.runtime ?? {};
  const store = input.store;
  const queue = input.queue;
  const policyStore = input.policyStore ?? store;
  const registry = input.registry;
  const now = () => (runtime.now ?? store.now ?? (() => new Date()))();
  const cryptoImpl = runtime.crypto ?? globalThis.crypto;
  const createLocks = new Map<string, Promise<unknown>>();
  const rateBudget = createRateBudget(runtime.rateBudgetPerProvider ?? 25);
  let boot: Promise<void> | null = null;

  const ready = () => {
    if (!boot) boot = bootstrap();
    return boot;
  };

  async function bootstrap(): Promise<void> {
    if (runtime.seedSandboxExamples !== false) {
      await seedSandboxExamples(store, registry, runtime);
    } else {
      const iso = now().toISOString();
      for (const adapter of registry.list()) {
        await store.upsertProviderDefinition({
          tenantKey: 'default',
          provider: adapter.provider,
          environment: adapter.environment,
          adapterVersion: adapter.manifest.adapterVersion,
          manifestDigest: await digestCanonical(adapter.manifest),
          compiledInRegistry: true,
          productionEligible: false,
          createdAt: iso,
          updatedAt: iso,
        });
      }
    }
  }

  async function authorize(actor: ActorContext, operation: EngineOperation, resource: { type: string; id?: string }) {
    const allowed = await input.authorize(actor, operation, resource);
    if (!allowed) throw new AuthorizationError();
  }

  async function audit(
    actor: ActorContext,
    operation: string,
    resourceType: string,
    resourceId: string | null,
    reasonCode: string | null,
    safeMetadata: Record<string, string | number | boolean | null> = {},
  ) {
    await store.appendAudit({
      tenantKey: actor.tenantKey,
      id: newId('aud', cryptoImpl),
      actorId: actor.actorId,
      actorType: actor.actorType,
      operation,
      resourceType,
      resourceId,
      reasonCode,
      safeMetadata,
      occurredAt: now().toISOString(),
    });
  }

  function adapterFor(provider: string, environment: 'sandbox' | 'production'): VerificationAdapterV1 {
    return registry.get(provider, environment);
  }

  async function recordHealth(adapter: VerificationAdapterV1, actorTenant: string, observation: ProviderHealthObservation) {
    await store.recordHealth({
      tenantKey: actorTenant,
      id: newId('hlth', cryptoImpl),
      provider: adapter.provider,
      environment: adapter.environment,
      operation: observation.operation,
      outcome: observation.outcome,
      safeCode: observation.safeCode,
      observedAt: observation.observedAt,
      latencyMs: observation.latencyMs ?? null,
    });
    const circuit = await store.getCircuit(actorTenant, adapter.provider, adapter.environment);
    if (observation.outcome === 'success') {
      await store.saveCircuit({
        ...circuit,
        consecutiveFailures: 0,
        state: circuit.drainedByActorId ? circuit.state : 'closed',
        reasonCode: circuit.drainedByActorId ? circuit.reasonCode : null,
        openUntil: circuit.drainedByActorId ? circuit.openUntil : null,
        updatedAt: now().toISOString(),
      });
      return;
    }
    if (observation.outcome === 'retryable_failure' || observation.outcome === 'terminal_failure') {
      const failures = circuit.consecutiveFailures + 1;
      const open = failures >= 5;
      await store.saveCircuit({
        ...circuit,
        consecutiveFailures: failures,
        state: open ? 'open' : circuit.state,
        reasonCode: observation.safeCode,
        openUntil: open ? new Date(now().getTime() + 300_000).toISOString() : circuit.openUntil,
        updatedAt: now().toISOString(),
      });
    }
  }

  async function toView(attempt: AttemptRecord, launch: ProviderLaunchEnvelope | null = null): Promise<SafeAttemptView> {
    return {
      attemptId: attempt.id,
      packageCode: attempt.packageCode,
      status: attempt.canonicalStatus,
      provider: attempt.provider,
      environment: attempt.environment,
      adapterVersion: attempt.adapterVersion,
      manifestDigest: attempt.manifestDigest,
      configurationRevision: attempt.configurationRevision,
      policyVersion: attempt.policyVersion,
      canResume: !isTerminalStatus(attempt.canonicalStatus),
      canRetry: ['declined', 'failed', 'expired', 'canceled', 'provider_unavailable'].includes(attempt.canonicalStatus),
      expiresAt: attempt.expiresAt,
      safeErrorCode: attempt.canonicalStatus === 'provider_unavailable' ? 'provider_unavailable' : null,
      retryAfter: null,
      supportPath: null,
      launch,
    };
  }

  async function persistDecision(attempt: AttemptRecord) {
    if (attempt.canonicalStatus !== 'verified') return;
    const existing = await store.getValidDecision(attempt.tenantKey, attempt.subjectHash, attempt.packageCode, now());
    if (existing) return;
    const ttl = (runtime.defaultDecisionTtlSeconds ?? 365 * 24 * 3600) * 1000;
    await store.insertDecision({
      tenantKey: attempt.tenantKey,
      id: newId('dec', cryptoImpl),
      subjectHash: attempt.subjectHash,
      packageCode: attempt.packageCode,
      attemptId: attempt.id,
      status: 'verified',
      source: 'provider',
      policyVersion: attempt.policyVersion,
      reasonCodes: attempt.normalizedReasonCodes,
      effectiveAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + ttl).toISOString(),
      revokedAt: null,
      proposerActorId: null,
      approverActorId: null,
      createdAt: now().toISOString(),
    });
  }

  async function bindProviderResult(attempt: AttemptRecord, result: {
    providerResourceId: string;
    providerStatus: string;
    canonicalStatus: VerificationCanonicalStatus;
    linkedResources?: Array<{ resourceType: string; resourceId: string; relationshipCode: string; providerStatus: string; occurredAt: string }>;
  }): Promise<AttemptRecord> {
    const next: AttemptRecord = {
      ...attempt,
      providerResourceId: result.providerResourceId,
      providerStatus: result.providerStatus,
      canonicalStatus: applyMonotonicStatus(attempt.canonicalStatus, result.canonicalStatus),
      statusVersion: attempt.statusVersion + 1,
      createClaimId: null,
      createClaimExpiresAt: null,
      updatedAt: now().toISOString(),
    };
    await store.updateAttempt(next);
    await store.insertLineage({
      tenantKey: attempt.tenantKey,
      id: newId('lin', cryptoImpl),
      attemptId: attempt.id,
      resourceType: 'primary',
      providerResourceId: result.providerResourceId,
      relationshipCode: 'primary',
      providerStatus: result.providerStatus,
      occurredAt: now().toISOString(),
    });
    for (const linked of result.linkedResources ?? []) {
      await store.insertLineage({
        tenantKey: attempt.tenantKey,
        id: newId('lin', cryptoImpl),
        attemptId: attempt.id,
        resourceType: linked.resourceType,
        providerResourceId: linked.resourceId,
        relationshipCode: linked.relationshipCode,
        providerStatus: linked.providerStatus,
        occurredAt: linked.occurredAt,
      });
    }
    await persistDecision(next);
    return next;
  }

  function launchCommand(attempt: AttemptRecord, command: StartVerificationCommand): ProviderAttemptCommand {
    return {
      attemptId: attempt.id,
      subjectReference: command.subjectReference,
      organizationReference: command.organization?.legalName ?? null,
      packageCode: attempt.packageCode,
      countryCode: attempt.countryCode,
      idempotencyKey: attempt.idempotencyKey,
      configurationRevision: attempt.configurationRevision,
      legalFirstName: command.legalFirstName,
      legalLastName: command.legalLastName,
      email: command.email,
      organization: command.organization,
      relationship: command.relationship,
      associatedPerson: command.associatedPerson,
      evidenceReferences: command.evidenceReferences,
      requestOrigin: command.requestOrigin,
      metadata: command.metadata,
    };
  }

  async function createProviderResource(actor: ActorContext, attempt: AttemptRecord, command: StartVerificationCommand, adapter: VerificationAdapterV1) {
    const budget = rateBudget.consume(adapter.provider, now());
    if (!budget.allowed) {
      throw new EngineError(
        'PROVIDER_UNAVAILABLE',
        'The provider rate budget is exhausted.',
        true,
        budget.retryAfterSeconds,
      );
    }
    const started = now();
    try {
      const created = await adapter.createAttempt(launchCommand(attempt, command));
      await recordHealth(adapter, actor.tenantKey, {
        operation: 'create',
        outcome: 'success',
        safeCode: 'ok',
        observedAt: now().toISOString(),
        latencyMs: now().getTime() - started.getTime(),
      });
      return created;
    } catch (error) {
      const safe = toSafeProviderFailure(error);
      await recordHealth(adapter, actor.tenantKey, {
        operation: 'create',
        outcome: safe.retryable ? 'retryable_failure' : 'terminal_failure',
        safeCode: safe.safeCode,
        observedAt: now().toISOString(),
        latencyMs: now().getTime() - started.getTime(),
      });
      throw error;
    }
  }

  async function startLocked(actor: ActorContext, command: StartVerificationCommand): Promise<SafeAttemptView> {
    assertNoClientRouting(command);
    assertStartCommand(command);
    await authorize(actor, 'start', { type: 'package', id: command.packageCode });
    const subjectHash = await store.hashSubject(actor.tenantKey, command.subjectReference);
    const reused = await store.getValidDecision(actor.tenantKey, subjectHash, command.packageCode, now());
    if (reused?.attemptId) {
      const prior = await store.getAttempt(actor.tenantKey, reused.attemptId);
      if (prior) {
        await audit(actor, 'start', 'decision', reused.id, 'reused_verified_decision', { attemptId: prior.id });
        return toView(prior);
      }
    }
    const resourceHash = command.resourceReference && command.resourceType
      ? await store.hashResource(actor.tenantKey, command.resourceType, command.resourceReference)
      : null;
    const existing = await store.getAttemptByIdempotencyKey(actor.tenantKey, command.idempotencyKey);
    if (existing?.providerResourceId) {
      return toView(existing);
    }
    if (existing && existing.createClaimExpiresAt && existing.createClaimExpiresAt > now().toISOString()) {
      throw new ProviderOperationPendingError();
    }

    const productionPolicy = await store.getActivePolicy(actor.tenantKey, 'production');
    const environment = runtime.productionEnabled
      && productionPolicy?.lifecycle === 'active'
      && twoActorApproved(productionPolicy.proposedByActorId, productionPolicy.approvedByActorId)
      ? 'production' as const
      : 'sandbox' as const;
    const selected = await selectRoute({
      store,
      adapters: registry.list(),
      tenantKey: actor.tenantKey,
      packageCode: command.packageCode,
      countryCode: command.countryCode,
      subjectHash,
      environment: environment === 'production' ? 'production' : 'sandbox',
      runtime,
    });
    const adapter = selected.adapter;
    const manifestDigest = await digestCanonical(adapter.manifest);
    const iso = now().toISOString();
    const attemptId = newId('att', cryptoImpl);
    const claimKey = `start:${command.idempotencyKey}`;

    const prepared = await store.transact(async (tx) => {
      const claim = await tx.claimIdempotency({
        tenantKey: actor.tenantKey,
        claimKey,
        operation: 'start',
        attemptId,
        state: 'claimed',
        resultRef: null,
        errorCode: null,
        createdAt: iso,
        completedAt: null,
      });
      if (claim.disposition === 'existing' && claim.claim.resultRef) {
        const prior = await tx.getAttempt(actor.tenantKey, claim.claim.resultRef);
        if (prior) return { kind: 'existing' as const, attempt: prior };
      }
      if (claim.disposition === 'existing' && claim.claim.state === 'claimed') {
        throw new ProviderOperationPendingError();
      }
      const attempt: AttemptRecord = {
        tenantKey: actor.tenantKey,
        id: attemptId,
        subjectHash,
        packageCode: command.packageCode,
        countryCode: command.countryCode,
        provider: adapter.provider,
        environment: adapter.environment,
        adapterVersion: adapter.manifest.adapterVersion,
        manifestDigest,
        configurationRevision: selected.route.configurationRevisionId,
        policyVersion: selected.route.policyVersionId,
        providerResourceId: null,
        providerStatus: null,
        canonicalStatus: 'created',
        statusVersion: 0,
        idempotencyKey: command.idempotencyKey,
        parentAttemptId: null,
        purposeAction: command.action ?? null,
        purposeResourceHash: resourceHash,
        routeId: selected.route.id,
        selectionReason: selected.reason,
        normalizedReasonCodes: [],
        expiresAt: null,
        createClaimId: newId('claim', cryptoImpl),
        createClaimExpiresAt: new Date(now().getTime() + 30_000).toISOString(),
        createdAt: iso,
        updatedAt: iso,
      };
      await tx.insertAttempt(attempt);
      return { kind: 'created' as const, attempt };
    });

    if (prepared.kind === 'existing') return toView(prepared.attempt);

    try {
      const created = await createProviderResource(actor, prepared.attempt, command, adapter);
      const bound = await store.transact(async (tx) => {
        const latest = await tx.getAttempt(actor.tenantKey, prepared.attempt.id);
        if (!latest) throw new EngineError('ATTEMPT_NOT_FOUND', 'The verification attempt was lost after provider create.');
        const next = await bindProviderResult(latest, created);
        await tx.completeIdempotency(actor.tenantKey, claimKey, next.id);
        return next;
      });
      await audit(actor, 'start', 'attempt', bound.id, selected.reason, { provider: adapter.provider });
      return toView(bound, stripPersistedLaunch(created.launch));
    } catch (error) {
      await store.failIdempotency(actor.tenantKey, claimKey, toSafeProviderFailure(error).safeCode);
      await store.updateAttempt({
        ...prepared.attempt,
        canonicalStatus: 'provider_unavailable',
        createClaimId: null,
        createClaimExpiresAt: null,
        updatedAt: now().toISOString(),
      });
      throw error;
    }
  }

  async function start(actor: ActorContext, command: StartVerificationCommand): Promise<SafeAttemptView> {
    await ready();
    const lockKey = `${actor.tenantKey}:${command.idempotencyKey}`;
    const pending = createLocks.get(lockKey);
    const run = (pending ?? Promise.resolve()).then(() => startLocked(actor, command), () => startLocked(actor, command));
    createLocks.set(lockKey, run.then(() => undefined, () => undefined));
    return run;
  }

  async function loadAttempt(actor: ActorContext, attemptId: string): Promise<AttemptRecord> {
    const attempt = await store.getAttempt(actor.tenantKey, attemptId);
    if (!attempt) throw new EngineError('ATTEMPT_NOT_FOUND', 'The verification attempt was not found.');
    return attempt;
  }

  async function resume(actor: ActorContext, command: ResumeVerificationCommand): Promise<SafeAttemptView> {
    await ready();
    assertNoClientRouting(command);
    await authorize(actor, 'resume', { type: 'attempt', id: command.attemptId });
    const attempt = await loadAttempt(actor, command.attemptId);
    if (isTerminalStatus(attempt.canonicalStatus)) {
      throw new EngineError('ATTEMPT_TERMINAL', 'A terminal verification attempt cannot be resumed.');
    }
    if (!attempt.providerResourceId) {
      throw new EngineError('ATTEMPT_PINNED', 'The pinned verification attempt is not yet bound to a provider resource.');
    }
    const adapter = adapterFor(attempt.provider, attempt.environment);
    const launch = await adapter.resumeAttempt({
      attemptId: attempt.id,
      providerResourceId: attempt.providerResourceId,
      configurationRevision: attempt.configurationRevision,
      requestOrigin: command.requestOrigin,
    });
    await audit(actor, 'resume', 'attempt', attempt.id, 'resumed_pinned', { provider: attempt.provider });
    return toView(attempt, stripPersistedLaunch(launch));
  }

  async function status(actor: ActorContext, attemptId: string): Promise<SafeAttemptView> {
    await ready();
    await authorize(actor, 'status', { type: 'attempt', id: attemptId });
    return toView(await loadAttempt(actor, attemptId), null);
  }

  async function retry(actor: ActorContext, command: RetryVerificationCommand): Promise<SafeAttemptView> {
    await ready();
    assertNoClientRouting(command);
    await authorize(actor, 'retry', { type: 'attempt', id: command.parentAttemptId });
    const parent = await loadAttempt(actor, command.parentAttemptId);
    const subjectHash = await store.hashSubject(actor.tenantKey, command.subjectReference);
    const selected = await selectRoute({
      store,
      adapters: registry.list(),
      tenantKey: actor.tenantKey,
      packageCode: command.packageCode,
      countryCode: command.countryCode,
      subjectHash,
      environment: parent.environment,
      runtime,
      requiredCapability: 'canRetry',
    });
    const child = await startLocked(actor, command);
    const latest = await store.getAttempt(actor.tenantKey, child.attemptId);
    if (latest) {
      await store.updateAttempt({
        ...latest,
        parentAttemptId: parent.id,
        selectionReason: selected.reason,
        updatedAt: now().toISOString(),
      });
    }
    return child;
  }

  async function pause(actor: ActorContext, attemptId: string): Promise<SafeAttemptView> {
    await ready();
    await authorize(actor, 'pause', { type: 'attempt', id: attemptId });
    const attempt = await loadAttempt(actor, attemptId);
    if (isTerminalStatus(attempt.canonicalStatus)) {
      throw new EngineError('ATTEMPT_TERMINAL', 'A terminal verification attempt cannot be paused.');
    }
    const next = { ...attempt, canonicalStatus: applyMonotonicStatus(attempt.canonicalStatus, 'paused'), updatedAt: now().toISOString() };
    await store.updateAttempt(next);
    await audit(actor, 'pause', 'attempt', attemptId, 'paused');
    return toView(next);
  }

  async function cancel(actor: ActorContext, attemptId: string): Promise<SafeAttemptView> {
    await ready();
    await authorize(actor, 'cancel', { type: 'attempt', id: attemptId });
    const attempt = await loadAttempt(actor, attemptId);
    if (isTerminalStatus(attempt.canonicalStatus) && attempt.canonicalStatus !== 'canceled') {
      throw new EngineError('ATTEMPT_TERMINAL', 'A terminal verification attempt cannot be canceled.');
    }
    if (attempt.providerResourceId) {
      const adapter = adapterFor(attempt.provider, attempt.environment);
      if (adapter.manifest.capabilities.canCancel) {
        await adapter.cancelAttempt({
          attemptId: attempt.id,
          providerResourceId: attempt.providerResourceId,
          configurationRevision: attempt.configurationRevision,
        });
      }
    }
    const next = {
      ...attempt,
      canonicalStatus: applyMonotonicStatus(attempt.canonicalStatus, 'canceled') as VerificationCanonicalStatus,
      updatedAt: now().toISOString(),
    };
    await store.updateAttempt(next);
    await audit(actor, 'cancel', 'attempt', attemptId, 'canceled');
    return toView(next);
  }

  async function redact(actor: ActorContext, command: RedactCommand): Promise<{ jobId: string; status: string }> {
    await ready();
    await authorize(actor, 'redact', { type: 'subject' });
    const subjectHash = await store.hashSubject(actor.tenantKey, command.subjectReference);
    const job: JobRecord = {
      tenantKey: actor.tenantKey,
      id: newId('red', cryptoImpl),
      kind: 'redact',
      attemptId: command.attemptId ?? null,
      eventId: null,
      subjectHash,
      providerResourceId: null,
      state: 'scheduled',
      leaseId: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      nextAttemptAt: now().toISOString(),
      lastErrorCode: null,
      createdAt: now().toISOString(),
    };
    await queue.enqueue(job);
    const targets = command.attemptId
      ? [await loadAttempt(actor, command.attemptId)]
      : (await store.listAttempts(actor.tenantKey)).filter((row) => row.subjectHash === subjectHash);
    if (!targets.length) {
      await store.updateRedactionStatus(actor.tenantKey, job.id, 'not_applicable');
      return { jobId: job.id, status: 'not_applicable' };
    }
    let status = 'scheduled';
    for (const attempt of targets) {
      const adapter = adapterFor(attempt.provider, attempt.environment);
      const result = await adapter.redactSubject({
        subjectReference: command.subjectReference,
        providerResourceId: attempt.providerResourceId,
        requestReference: command.requestReference ?? job.id,
      });
      status = result.disposition ?? (result.completed ? 'redacted' : result.retryable ? 'retryable' : 'dead_letter');
      await store.updateRedactionStatus(actor.tenantKey, job.id, toRedactionStatus(status));
      if (result.completed) {
        await store.updateAttempt({
          ...attempt,
          canonicalStatus: 'redacted',
          updatedAt: now().toISOString(),
        });
      }
      await audit(actor, 'redact', 'attempt', attempt.id, status);
    }
    return { jobId: job.id, status };
  }

  async function ingestWebhook(command: IngestWebhookCommand): Promise<IngestWebhookResult> {
    await ready();
    const systemActor: ActorContext = {
      tenantKey: command.tenantKey,
      actorId: 'system:webhook',
      actorType: 'system',
      roles: ['webhook'],
      authorizedSubjectScope: ['*'],
    };
    await authorize(systemActor, 'ingest_webhook', { type: 'provider', id: command.provider });
    const adapter = registry.get(command.provider);
    let verified;
    try {
      verified = await adapter.verifyWebhook(command.request);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'SIGNATURE_INVALID') {
        throw new EngineError('WEBHOOK_UNAUTHENTICATED', 'The webhook signature is invalid.');
      }
      throw error;
    }
    const normalized = await adapter.normalizeWebhook(verified);
    const claim = await store.claimWebhookEvent({
      tenantKey: command.tenantKey,
      provider: command.provider,
      providerEventKey: normalized.providerEventKey,
      providerResourceId: normalized.providerResourceId,
      eventType: normalized.eventType,
      occurredAt: normalized.occurredAt,
      bodySha256: verified.bodySha256,
      safeMetadata: {
        ...normalized.safeMetadata,
        ...(normalized.canonicalStatus ? { canonicalStatus: normalized.canonicalStatus } : {}),
      },
    });
    if (claim.disposition === 'mismatch') {
      throw new WebhookSecurityIncidentError();
    }
    if (claim.disposition === 'claimed') {
      await queue.enqueue({
        tenantKey: command.tenantKey,
        id: newId('job', cryptoImpl),
        kind: 'webhook',
        attemptId: null,
        eventId: claim.event.id,
        subjectHash: null,
        providerResourceId: normalized.providerResourceId,
        state: 'scheduled',
        leaseId: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        nextAttemptAt: now().toISOString(),
        lastErrorCode: null,
        createdAt: now().toISOString(),
      });
    }
    await audit(systemActor, 'ingest_webhook', 'webhook_event', claim.event.id, claim.disposition, {
      provider: command.provider,
    });
    return { accepted: true, duplicate: claim.disposition === 'duplicate', eventId: claim.event.id };
  }

  async function processWebhookJob(tenantKey: string, job: JobRecord): Promise<void> {
    await ready();
    if (!job.eventId) return;
    const event = await store.getWebhookEventById(tenantKey, job.eventId);
    const resourceId = event?.providerResourceId ?? job.providerResourceId;
    let matched = resourceId
      ? await store.findAttemptByProviderResource(tenantKey, event?.provider ?? 'test_fake', resourceId)
      : null;
    if (!matched && resourceId) {
      for (const adapter of registry.list()) {
        matched = await store.findAttemptByProviderResource(tenantKey, adapter.provider, resourceId);
        if (matched) break;
      }
    }
    if (!matched || !event) {
      if (job.leaseId) {
        await queue.retry(tenantKey, job.id, job.leaseId, {
          errorCode: 'ATTEMPT_NOT_BOUND',
          retryAfterSeconds: backoffSeconds(job.attemptCount, undefined, runtime.random),
        });
      }
      return;
    }
    const canonicalFromEvent = event.safeMetadata.canonicalStatus;
    const canonical = (
      typeof canonicalFromEvent === 'string' ? canonicalFromEvent : matched.canonicalStatus
    ) as VerificationCanonicalStatus;
    const updated = {
      ...matched,
      canonicalStatus: applyMonotonicStatus(matched.canonicalStatus, canonical),
      providerStatus: typeof event.safeMetadata.providerStatus === 'string'
        ? event.safeMetadata.providerStatus
        : matched.providerStatus,
      statusVersion: matched.statusVersion + 1,
      updatedAt: now().toISOString(),
    };
    await store.updateAttempt(updated);
    await persistDecision(updated);
    await store.settleWebhookEvent(tenantKey, event.id, 'completed');
    if (job.leaseId) await queue.complete(tenantKey, job.id, job.leaseId);
  }

  async function reconcile(actor: ActorContext, attemptId?: string): Promise<{ reconciled: number }> {
    await ready();
    await authorize(actor, 'reconcile', { type: 'attempt', id: attemptId });
    const targets = attemptId
      ? [await loadAttempt(actor, attemptId)]
      : (await store.listAttempts(actor.tenantKey)).filter((row) => !isTerminalStatus(row.canonicalStatus) && row.providerResourceId);
    let reconciled = 0;
    for (const attempt of targets) {
      if (!attempt.providerResourceId) continue;
      const adapter = adapterFor(attempt.provider, attempt.environment);
      const snapshot = await adapter.retrieveAttempt({
        attemptId: attempt.id,
        providerResourceId: attempt.providerResourceId,
        configurationRevision: attempt.configurationRevision,
      });
      const next = {
        ...attempt,
        canonicalStatus: applyMonotonicStatus(attempt.canonicalStatus, snapshot.canonicalStatus),
        providerStatus: snapshot.providerStatus,
        normalizedReasonCodes: snapshot.normalizedReasonCodes,
        statusVersion: attempt.statusVersion + 1,
        updatedAt: now().toISOString(),
      };
      await store.updateAttempt(next);
      await persistDecision(next);
      reconciled += 1;
    }
    await audit(actor, 'reconcile', 'attempt', attemptId ?? null, 'reconciled', { count: reconciled });
    return { reconciled };
  }

  async function scheduleReconciliation(actor: ActorContext): Promise<{ enqueued: number }> {
    await ready();
    await authorize(actor, 'reconcile', { type: 'tenant' });
    const live = (await store.listAttempts(actor.tenantKey)).filter((row) => (
      ['processing', 'manual_review_required'].includes(row.canonicalStatus) && row.providerResourceId
    ));
    let enqueued = 0;
    for (const attempt of live) {
      await queue.enqueue({
        tenantKey: actor.tenantKey,
        id: newId('job', cryptoImpl),
        kind: 'reconcile',
        attemptId: attempt.id,
        eventId: null,
        subjectHash: attempt.subjectHash,
        providerResourceId: attempt.providerResourceId,
        state: 'scheduled',
        leaseId: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        nextAttemptAt: now().toISOString(),
        lastErrorCode: null,
        createdAt: now().toISOString(),
      });
      enqueued += 1;
    }
    await audit(actor, 'reconcile.schedule', 'tenant', actor.tenantKey, 'scheduled', { count: enqueued });
    return { enqueued };
  }

  async function claimWorkerJobs(actor: ActorContext, input: { workerId?: string; kinds?: JobRecord['kind'][]; limit?: number } = {}) {
    await ready();
    await authorize(actor, 'reconcile', { type: 'tenant' });
    const limit = Math.min(input.limit ?? runtime.workerConcurrency ?? 8, 32);
    return queue.claim({
      tenantKey: actor.tenantKey,
      kinds: input.kinds ?? ['webhook', 'reconcile', 'redact'],
      workerId: input.workerId ?? actor.actorId,
      leaseSeconds: runtime.webhookLeaseSeconds ?? 30,
      limit,
      now: now(),
    });
  }

  async function processWorkerJob(actor: ActorContext, jobOrRef: JobRecord | { id: string }): Promise<{ processed: boolean; disposition: string }> {
    await ready();
    const job = 'kind' in jobOrRef ? jobOrRef : await store.getJob(actor.tenantKey, jobOrRef.id);
    if (!job) throw new EngineError('ATTEMPT_NOT_FOUND', 'The worker job was not found.');
    await authorize(actor, 'process_webhook', { type: 'job', id: job.id });
    try {
      if (job.kind === 'webhook') await processWebhookJob(actor.tenantKey, job);
      else if (job.kind === 'reconcile') await reconcile(actor, job.attemptId ?? undefined);
      else if (job.kind === 'redact' && job.attemptId) {
        const attempt = await store.getAttempt(actor.tenantKey, job.attemptId);
        if (attempt) {
          const adapter = adapterFor(attempt.provider, attempt.environment);
          const result = await adapter.redactSubject({
            subjectReference: attempt.subjectHash,
            providerResourceId: attempt.providerResourceId,
            requestReference: job.id,
          });
          const status = result.disposition ?? (result.completed ? 'redacted' : 'retryable');
          await store.updateRedactionStatus(actor.tenantKey, job.id, toRedactionStatus(status));
          if (result.completed) {
            await store.updateAttempt({ ...attempt, canonicalStatus: 'redacted', updatedAt: now().toISOString() });
          }
        }
      }
      if (job.leaseId && job.kind !== 'webhook') await queue.complete(actor.tenantKey, job.id, job.leaseId);
      return { processed: true, disposition: 'completed' };
    } catch (error) {
      const safe = toSafeProviderFailure(error);
      if (job.leaseId) {
        const dead = job.attemptCount >= (runtime.maxWorkerAttempts ?? 8);
        await queue.retry(actor.tenantKey, job.id, job.leaseId, {
          errorCode: safe.safeCode,
          retryAfterSeconds: backoffSeconds(job.attemptCount, safe.retryAfterSeconds, runtime.random),
          deadLetter: dead,
        });
        return { processed: true, disposition: dead ? 'dead_letter' : 'retryable' };
      }
      throw error;
    }
  }

  async function submitAppeal(actor: ActorContext, command: AppealSubmitCommand) {
    await ready();
    await authorize(actor, 'appeal', { type: 'attempt', id: command.attemptId });
    const attempt = await loadAttempt(actor, command.attemptId);
    const appeal = {
      tenantKey: actor.tenantKey,
      id: newId('apl', cryptoImpl),
      attemptId: attempt.id,
      subjectHash: attempt.subjectHash,
      status: 'open' as const,
      reason: command.reason,
      policyVersion: attempt.policyVersion,
      proposedByActorId: actor.actorId,
      decidedByActorId: null,
      expiresAt: command.expiresAt ?? null,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    await store.saveAppeal(appeal);
    if (isApplicationReasonCode(command.reason) && !attempt.normalizedReasonCodes.includes(command.reason)) {
      await store.updateAttempt({
        ...attempt,
        normalizedReasonCodes: [...attempt.normalizedReasonCodes, command.reason],
        updatedAt: now().toISOString(),
      });
    }
    await audit(actor, 'appeal.submit', 'appeal', appeal.id, 'open');
    return { appealId: appeal.id };
  }

  function applyGovernanceStatus(current: string, transition: AppealTransitionCommand['transition']): string {
    const map = {
      approve: 'approved',
      deny: 'denied',
      request_more_information: 'more_information_requested',
      revoke: 'revoked',
      expire: 'expired',
    } as const;
    return map[transition] ?? current;
  }

  async function transitionAppeal(actor: ActorContext, command: AppealTransitionCommand) {
    await ready();
    await authorize(actor, 'appeal', { type: 'appeal', id: command.appealId });
    const appeal = await store.getAppeal(actor.tenantKey, command.appealId);
    if (!appeal) throw new EngineError('ATTEMPT_NOT_FOUND', 'The appeal was not found.');
    if (command.transition === 'approve' || command.transition === 'deny' || command.transition === 'revoke') {
      if (appeal.proposedByActorId === actor.actorId) {
        throw new EngineError('GOVERNANCE_TWO_ACTOR', 'The proposing actor cannot approve or deny their own appeal.');
      }
    }
    const status = applyGovernanceStatus(appeal.status, command.transition);
    await store.saveAppeal({
      ...appeal,
      status: status as typeof appeal.status,
      reason: command.reason,
      decidedByActorId: actor.actorId,
      updatedAt: now().toISOString(),
    });
    await audit(actor, 'appeal.transition', 'appeal', appeal.id, status);
    return { status };
  }

  async function proposeReview(actor: ActorContext, command: ReviewProposeCommand) {
    await ready();
    await authorize(actor, 'review', { type: 'attempt', id: command.attemptId });
    const attempt = await loadAttempt(actor, command.attemptId);
    const reviewCase = {
      tenantKey: actor.tenantKey,
      id: newId('rev', cryptoImpl),
      attemptId: attempt.id,
      subjectHash: attempt.subjectHash,
      status: 'in_review' as const,
      reason: command.reason,
      policyVersion: attempt.policyVersion,
      assignedActorId: actor.actorId,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    await store.saveReviewCase(reviewCase);
    if (isApplicationReasonCode(command.reason) && !attempt.normalizedReasonCodes.includes(command.reason)) {
      await store.updateAttempt({
        ...attempt,
        normalizedReasonCodes: [...attempt.normalizedReasonCodes, command.reason],
        updatedAt: now().toISOString(),
      });
    }
    const proposal = {
      tenantKey: actor.tenantKey,
      id: newId('prp', cryptoImpl),
      reviewCaseId: reviewCase.id,
      attemptId: attempt.id,
      proposedStatus: command.proposedStatus,
      reason: command.reason,
      policyVersion: attempt.policyVersion,
      expiresAt: command.expiresAt ?? null,
      proposedByActorId: actor.actorId,
      approvedByActorId: null,
      status: 'proposed' as const,
      createdAt: now().toISOString(),
    };
    await store.saveManualDecisionProposal(proposal);
    await audit(actor, 'review.propose', 'manual_decision_proposal', proposal.id, 'proposed');
    return { proposalId: proposal.id, reviewCaseId: reviewCase.id };
  }

  async function decideReview(actor: ActorContext, command: ReviewDecideCommand) {
    await ready();
    await authorize(actor, 'review', { type: 'proposal', id: command.proposalId });
    const proposal = await store.getManualDecisionProposal(actor.tenantKey, command.proposalId);
    if (!proposal) throw new EngineError('ATTEMPT_NOT_FOUND', 'The manual decision proposal was not found.');
    if (proposal.proposedByActorId === actor.actorId) {
      throw new EngineError('GOVERNANCE_TWO_ACTOR', 'The proposer cannot approve their own manual decision.');
    }
    if (command.transition === 'deny') {
      await store.saveManualDecisionProposal({ ...proposal, status: 'rejected', approvedByActorId: actor.actorId });
      await audit(actor, 'review.decide', 'manual_decision_proposal', proposal.id, 'rejected');
      return { status: 'rejected' };
    }
    const attempt = await loadAttempt(actor, proposal.attemptId);
    await store.saveManualDecisionProposal({ ...proposal, status: 'approved', approvedByActorId: actor.actorId });
    if (proposal.proposedStatus === 'verified') {
      await store.insertDecision({
        tenantKey: actor.tenantKey,
        id: newId('dec', cryptoImpl),
        subjectHash: attempt.subjectHash,
        packageCode: attempt.packageCode,
        attemptId: attempt.id,
        status: 'verified',
        source: 'manual',
        policyVersion: proposal.policyVersion,
        reasonCodes: [command.reason],
        effectiveAt: now().toISOString(),
        expiresAt: proposal.expiresAt,
        revokedAt: null,
        proposerActorId: proposal.proposedByActorId,
        approverActorId: actor.actorId,
        createdAt: now().toISOString(),
      });
    }
    if (proposal.proposedStatus === 'declined' || proposal.proposedStatus === 'revoked') {
      const nextStatus = proposal.proposedStatus === 'declined' ? 'declined' : attempt.canonicalStatus;
      await store.updateAttempt({
        ...attempt,
        canonicalStatus: applyMonotonicStatus(attempt.canonicalStatus, nextStatus),
        updatedAt: now().toISOString(),
      });
    }
    await audit(actor, 'review.decide', 'manual_decision_proposal', proposal.id, 'approved');
    return { status: 'approved' };
  }

  async function transitionCase(actor: ActorContext, command: ReviewCaseTransitionCommand) {
    await ready();
    await authorize(actor, 'review', { type: 'review_case', id: command.reviewCaseId });
    const reviewCase = await store.getReviewCase(actor.tenantKey, command.reviewCaseId);
    if (!reviewCase) throw new EngineError('ATTEMPT_NOT_FOUND', 'The review case was not found.');
    const status = applyGovernanceStatus(reviewCase.status, command.transition);
    await store.saveReviewCase({
      ...reviewCase,
      status: status as typeof reviewCase.status,
      reason: command.reason,
      updatedAt: now().toISOString(),
    });
    await audit(actor, 'review.case', 'review_case', reviewCase.id, status);
    return { status };
  }

  async function evaluateProtectedAction(actor: ActorContext, command: ProtectedActionCommand): Promise<ProtectedActionResult> {
    await ready();
    await authorize(actor, 'evaluate_protected_action', { type: 'action', id: command.action });
    const subjectHash = await store.hashSubject(actor.tenantKey, command.subjectReference);
    const resourceHash = await store.hashResource(actor.tenantKey, command.resourceType, command.resourceReference);
    const environment = runtime.productionEnabled ? 'production' : 'sandbox';
    const policy = await policyStore.getActivePolicy(actor.tenantKey, environment === 'production' ? 'production' : 'sandbox')
      ?? await policyStore.getActivePolicy(actor.tenantKey, 'sandbox');
    if (!policy) {
      throw new EngineError('NO_ELIGIBLE_ROUTE', 'No active verification policy is available for protected actions.');
    }
    let requirements = await policyStore.listProtectedActionRequirements(actor.tenantKey, command.action, policy.id);
    if (!requirements.length) {
      requirements = [{
        tenantKey: actor.tenantKey,
        id: 'implicit_human_idv',
        action: command.action,
        packageCode: 'human_idv',
        policyVersionId: policy.id,
        createdAt: now().toISOString(),
      }];
    }
    const missing: string[] = [];
    for (const requirement of requirements) {
      const decision = await store.getValidDecision(actor.tenantKey, subjectHash, requirement.packageCode, now());
      if (!decision) missing.push(requirement.packageCode);
    }
    if (!missing.length) return { allowed: true } satisfies ProtectedActionAllow;

    const destinations = await policyStore.getContinuationDestinations(actor.tenantKey);
    const destinationKey = command.destinationKey ?? 'verification.resume';
    if (!destinations.includes(destinationKey)) {
      throw new EngineError('DESTINATION_NOT_ALLOWLISTED', 'The continuation destination is not allowlisted.');
    }
    const token = randomToken(cryptoImpl);
    const key = newId('cont', cryptoImpl);
    const expiresAt = new Date(now().getTime() + (runtime.continuationTtlSeconds ?? 900) * 1000).toISOString();
    await store.saveContinuation({
      tenantKey: actor.tenantKey,
      key,
      tokenHash: await sha256Hex(token),
      action: command.action,
      resourceHash,
      subjectHash,
      destinationKey,
      expiresAt,
      consumedAt: null,
    });
    const denial: ProtectedActionDenial = {
      code: 'VERIFICATION_REQUIRED',
      action: command.action,
      resourceHash,
      requiredPackages: missing,
      continuation: { key, token, expiresAt },
      retryAfter: null,
      supportPath: null,
    };
    return denial;
  }

  const admin = {
    async health(actor: ActorContext) {
      await ready();
      await authorize(actor, 'admin.health', { type: 'tenant' });
      return {
        observations: await store.listHealth(actor.tenantKey),
        circuits: await store.listCircuits(actor.tenantKey),
      };
    },
    async routes(actor: ActorContext) {
      await ready();
      await authorize(actor, 'admin.routes', { type: 'tenant' });
      return store.listRoutes(actor.tenantKey);
    },
    async circuits(actor: ActorContext) {
      await ready();
      await authorize(actor, 'admin.circuits', { type: 'tenant' });
      return store.listCircuits(actor.tenantKey);
    },
    async attempts(actor: ActorContext) {
      await ready();
      await authorize(actor, 'admin.attempts', { type: 'tenant' });
      return store.listAttempts(actor.tenantKey);
    },
    async audit(actor: ActorContext) {
      await ready();
      await authorize(actor, 'admin.audit', { type: 'tenant' });
      return store.listAudit(actor.tenantKey);
    },
    async proposeRoute(actor: ActorContext, input: { route: Omit<RouteRecord, 'lifecycle' | 'approvedByActorId' | 'approvedAt' | 'activatedAt'>; reason: string }) {
      await ready();
      await authorize(actor, 'admin.propose_route', { type: 'route' });
      const request = {
        tenantKey: actor.tenantKey,
        id: newId('rcr', cryptoImpl),
        routeId: input.route.id,
        proposedPayload: {
          provider: input.route.provider,
          packageCode: String(input.route.packageCode),
          environment: input.route.environment,
          priority: input.route.priority,
        },
        status: 'proposed' as const,
        reason: input.reason,
        policyVersion: input.route.policyVersionId,
        proposedByActorId: actor.actorId,
        approvedByActorId: null,
        approvedAt: null,
        expiresAt: null,
        createdAt: now().toISOString(),
      };
      await store.saveRouteChangeRequest(request);
      await store.saveRoute({
        ...input.route,
        tenantKey: actor.tenantKey,
        lifecycle: 'draft',
        proposedByActorId: actor.actorId,
        approvedByActorId: null,
        approvedAt: null,
        activatedAt: null,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      });
      await audit(actor, 'admin.propose_route', 'route', input.route.id, 'proposed');
      return { requestId: request.id };
    },
    async approveRoute(actor: ActorContext, requestId: string, reason: string) {
      await ready();
      await authorize(actor, 'admin.approve_route', { type: 'route_change_request', id: requestId });
      const request = await store.getRouteChangeRequest(actor.tenantKey, requestId);
      if (!request) throw new EngineError('ATTEMPT_NOT_FOUND', 'The route change request was not found.');
      if (request.proposedByActorId === actor.actorId) {
        throw new EngineError('GOVERNANCE_TWO_ACTOR', 'The proposer cannot approve their own route change.');
      }
      const route = request.routeId ? await store.getRoute(actor.tenantKey, request.routeId) : null;
      if (!route) throw new EngineError('NO_ELIGIBLE_ROUTE', 'The proposed route was not found.');
      if (route.environment === 'production' && !runtime.productionEnabled) {
        throw new EngineError('PRODUCTION_NOT_ACTIVATED', 'Production routes cannot be activated without the runtime key.');
      }
      await store.saveRouteChangeRequest({
        ...request,
        status: 'approved',
        reason,
        approvedByActorId: actor.actorId,
        approvedAt: now().toISOString(),
      });
      await store.saveRoute({
        ...route,
        lifecycle: 'active',
        approvedByActorId: actor.actorId,
        approvedAt: now().toISOString(),
        activatedAt: now().toISOString(),
        updatedAt: now().toISOString(),
      });
      await audit(actor, 'admin.approve_route', 'route', route.id, 'approved');
      return { routeId: route.id };
    },
    async proposePolicy(actor: ActorContext, input: {
      version: string;
      environment: 'sandbox' | 'production';
      reason: string;
      expiresAt?: string | null;
      decisionRetentionDays?: number | null;
      providerRedactionDelayDays?: number | null;
      appealHoldDays?: number | null;
      legalHold?: boolean;
    }) {
      await ready();
      await authorize(actor, 'admin.propose_policy', { type: 'policy' });
      const policy = {
        tenantKey: actor.tenantKey,
        id: newId('pol', cryptoImpl),
        version: input.version,
        environment: input.environment,
        lifecycle: 'draft' as const,
        reason: input.reason,
        expiresAt: input.expiresAt ?? null,
        proposedByActorId: actor.actorId,
        approvedByActorId: null,
        approvedAt: null,
        activatedAt: null,
        createdAt: now().toISOString(),
        decisionRetentionDays: input.decisionRetentionDays ?? null,
        providerRedactionDelayDays: input.providerRedactionDelayDays ?? null,
        appealHoldDays: input.appealHoldDays ?? null,
        legalHold: input.legalHold ?? false,
      };
      await store.savePolicyVersion(policy);
      await audit(actor, 'admin.propose_policy', 'policy', policy.id, 'draft');
      return { policyId: policy.id };
    },
    async approvePolicy(actor: ActorContext, policyId: string, reason: string) {
      await ready();
      await authorize(actor, 'admin.approve_policy', { type: 'policy', id: policyId });
      const policy = await store.getPolicyVersion(actor.tenantKey, policyId);
      if (!policy) throw new EngineError('ATTEMPT_NOT_FOUND', 'The policy was not found.');
      if (policy.proposedByActorId === actor.actorId) {
        throw new EngineError('GOVERNANCE_TWO_ACTOR', 'The proposer cannot approve their own policy.');
      }
      await store.savePolicyVersion({
        ...policy,
        lifecycle: 'approved',
        reason,
        approvedByActorId: actor.actorId,
        approvedAt: now().toISOString(),
      });
      await audit(actor, 'admin.approve_policy', 'policy', policy.id, 'approved');
      return { policyId: policy.id };
    },
    async activatePolicy(actor: ActorContext, policyId: string) {
      await ready();
      await authorize(actor, 'admin.activate_policy', { type: 'policy', id: policyId });
      const policy = await store.getPolicyVersion(actor.tenantKey, policyId);
      if (!policy) throw new EngineError('ATTEMPT_NOT_FOUND', 'The policy was not found.');
      if (!twoActorApproved(policy.proposedByActorId, policy.approvedByActorId)) {
        throw new EngineError('GOVERNANCE_TWO_ACTOR', 'An active policy requires distinct proposer and approver.');
      }
      if (policy.environment === 'production' && !runtime.productionEnabled) {
        throw new EngineError('PRODUCTION_NOT_ACTIVATED', 'Production policy activation requires the runtime production key.');
      }
      if (
        policy.environment === 'production'
        && (policy.decisionRetentionDays == null
          || policy.providerRedactionDelayDays == null
          || policy.appealHoldDays == null)
      ) {
        throw new EngineError(
          'PRODUCTION_NOT_ACTIVATED',
          'Production policy activation requires explicit retention, redaction, appeal-hold, and legal-hold values.',
        );
      }
      await store.savePolicyVersion({
        ...policy,
        lifecycle: 'active',
        activatedAt: now().toISOString(),
      });
      await audit(actor, 'admin.activate_policy', 'policy', policy.id, 'active');
      return { policyId: policy.id };
    },
    async emergencyDrain(actor: ActorContext, provider: string, environment: 'sandbox' | 'production', reason: string) {
      await ready();
      await authorize(actor, 'admin.emergency_drain', { type: 'provider', id: provider });
      const circuit = await store.getCircuit(actor.tenantKey, provider, environment);
      await store.saveCircuit({
        ...circuit,
        state: 'open',
        reasonCode: reason,
        openUntil: new Date(now().getTime() + 24 * 3600_000).toISOString(),
        drainedByActorId: actor.actorId,
        updatedAt: now().toISOString(),
      });
      await audit(actor, 'admin.emergency_drain', 'circuit', provider, reason);
      return { state: 'open' };
    },
  };

  void CLIENT_OPS;

  return {
    start,
    resume,
    status,
    retry,
    pause,
    cancel,
    redact,
    ingestWebhook,
    processWebhookJob,
    reconcile,
    appeal: { submit: submitAppeal, transition: transitionAppeal },
    review: { propose: proposeReview, decide: decideReview, transitionCase },
    admin,
    evaluateProtectedAction,
    workers: {
      claim: claimWorkerJobs,
      process: processWorkerJob,
      scheduleReconciliation,
    },
  };
}

function stripPersistedLaunch(launch: ProviderLaunchEnvelope): ProviderLaunchEnvelope {
  return launch;
}

const REDACTION_STATUSES: readonly RedactionStatus[] = [
  'scheduled',
  'processing',
  'retryable',
  'redacted',
  'not_applicable',
  'dead_letter',
];

function toRedactionStatus(value: string | undefined): RedactionStatus {
  if (value === 'failed') return 'dead_letter';
  if (value && (REDACTION_STATUSES as readonly string[]).includes(value)) return value as RedactionStatus;
  return 'retryable';
}
