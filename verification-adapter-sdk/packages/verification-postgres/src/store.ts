import { hmacSha256Hex } from '@splitin/verification-engine';
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
  VerificationStore,
  WebhookEventRecord,
} from '@splitin/verification-engine';

import type { PostgresStoreOptions, SqlExecutor } from './executor.ts';

function iso(now: () => Date): string {
  return now().toISOString();
}

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export function createPostgresStore(executor: SqlExecutor, options: PostgresStoreOptions): VerificationStore {
  if (!options.hashSecret) {
    throw new Error('createPostgresStore requires an injected HMAC hash secret.');
  }
  const now = options.now ?? (() => new Date());

  const store: VerificationStore = {
    now,
    async hashSubject(tenantKey, subjectReference) {
      return hmacSha256Hex(options.hashSecret, `subject:${tenantKey}:${subjectReference}`);
    },
    async hashResource(tenantKey, resourceType, resourceReference) {
      return hmacSha256Hex(options.hashSecret, `resource:${tenantKey}:${resourceType}:${resourceReference}`);
    },
    async transact(fn) {
      await executor.query('BEGIN');
      try {
        const result = await fn(store);
        await executor.query('COMMIT');
        return result;
      } catch (error) {
        await executor.query('ROLLBACK');
        throw error;
      }
    },
    async getTenant(tenantKey) {
      const result = await executor.query(
        'SELECT tenant_key, display_name, continuation_destinations, created_at FROM verification.tenants WHERE tenant_key = $1',
        [tenantKey],
      );
      return mapTenant(first(result.rows));
    },
    async ensureTenant(tenantKey, displayName = tenantKey) {
      await executor.query(
        `INSERT INTO verification.tenants (tenant_key, display_name)
         VALUES ($1, $2) ON CONFLICT (tenant_key) DO NOTHING`,
        [tenantKey, displayName],
      );
      return (await store.getTenant(tenantKey)) ?? {
        tenantKey,
        displayName,
        continuationDestinations: ['verification.resume'],
        createdAt: iso(now),
      };
    },
    async getConfigurationRevision(tenantKey, id) {
      const result = await executor.query(
        'SELECT * FROM verification.configuration_revisions WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      return mapConfig(first(result.rows));
    },
    async listConfigurationRevisions(tenantKey) {
      const result = await executor.query(
        'SELECT * FROM verification.configuration_revisions WHERE tenant_key = $1',
        [tenantKey],
      );
      return result.rows.map((row) => mapConfig(row)!);
    },
    async saveConfigurationRevision(revision) {
      await executor.query(
        `INSERT INTO verification.configuration_revisions (
           tenant_key, id, provider, environment, revision, configuration_digest, lifecycle,
           proposed_by_actor_id, approved_by_actor_id, approved_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_key, id) DO UPDATE SET
           lifecycle = EXCLUDED.lifecycle,
           approved_by_actor_id = EXCLUDED.approved_by_actor_id,
           approved_at = EXCLUDED.approved_at`,
        [
          revision.tenantKey, revision.id, revision.provider, revision.environment, revision.revision,
          revision.configurationDigest, revision.lifecycle, revision.proposedByActorId,
          revision.approvedByActorId, revision.approvedAt, revision.createdAt,
        ],
      );
    },
    async upsertProviderDefinition(definition) {
      await executor.query(
        `INSERT INTO verification.provider_definitions (
           tenant_key, provider, environment, adapter_version, manifest_digest,
           compiled_in_registry, production_eligible, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_key, provider, environment) DO UPDATE SET
           adapter_version = EXCLUDED.adapter_version,
           manifest_digest = EXCLUDED.manifest_digest,
           updated_at = EXCLUDED.updated_at`,
        [
          definition.tenantKey, definition.provider, definition.environment, definition.adapterVersion,
          definition.manifestDigest, definition.compiledInRegistry, definition.productionEligible,
          definition.createdAt, definition.updatedAt,
        ],
      );
    },
    async getProviderDefinition(tenantKey, provider, environment) {
      const result = await executor.query(
        'SELECT * FROM verification.provider_definitions WHERE tenant_key = $1 AND provider = $2 AND environment = $3',
        [tenantKey, provider, environment],
      );
      return mapProviderDef(first(result.rows));
    },
    async listProviderDefinitions(tenantKey) {
      const result = await executor.query(
        'SELECT * FROM verification.provider_definitions WHERE tenant_key = $1',
        [tenantKey],
      );
      return result.rows.map((row) => mapProviderDef(row)!);
    },
    async getRoute(tenantKey, routeId) {
      const result = await executor.query(
        'SELECT * FROM verification.routes WHERE tenant_key = $1 AND id = $2',
        [tenantKey, routeId],
      );
      return mapRoute(first(result.rows));
    },
    async listRoutes(tenantKey) {
      const result = await executor.query('SELECT * FROM verification.routes WHERE tenant_key = $1', [tenantKey]);
      return result.rows.map((row) => mapRoute(row)!);
    },
    async listActiveRoutes(tenantKey, environment) {
      const result = await executor.query(
        `SELECT * FROM verification.routes
         WHERE tenant_key = $1 AND environment = $2 AND lifecycle = 'active'
         ORDER BY priority, id`,
        [tenantKey, environment],
      );
      return result.rows.map((row) => mapRoute(row)!);
    },
    async saveRoute(route) {
      await executor.query(
        `INSERT INTO verification.routes (
           tenant_key, id, provider, environment, package_code, country_code, required_capability,
           priority, cohort_min, cohort_max, window_start, window_end, allowlist_required,
           allowlisted_subject_hashes, configuration_revision_id, policy_version_id, lifecycle,
           proposed_by_actor_id, approved_by_actor_id, approved_at, activated_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (tenant_key, id) DO UPDATE SET
           lifecycle = EXCLUDED.lifecycle, priority = EXCLUDED.priority,
           approved_by_actor_id = EXCLUDED.approved_by_actor_id, approved_at = EXCLUDED.approved_at,
           activated_at = EXCLUDED.activated_at, updated_at = EXCLUDED.updated_at`,
        [
          route.tenantKey, route.id, route.provider, route.environment, route.packageCode, route.countryCode,
          route.requiredCapability, route.priority, route.cohortMin, route.cohortMax, route.windowStart,
          route.windowEnd, route.allowlistRequired, route.allowlistedSubjectHashes, route.configurationRevisionId,
          route.policyVersionId, route.lifecycle, route.proposedByActorId, route.approvedByActorId,
          route.approvedAt, route.activatedAt, route.createdAt, route.updatedAt,
        ],
      );
    },
    async saveRouteChangeRequest(request) {
      await executor.query(
        `INSERT INTO verification.route_change_requests (
           tenant_key, id, route_id, proposed_payload, status, reason, policy_version,
           proposed_by_actor_id, approved_by_actor_id, approved_at, expires_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_key, id) DO UPDATE SET
           status = EXCLUDED.status, approved_by_actor_id = EXCLUDED.approved_by_actor_id, approved_at = EXCLUDED.approved_at`,
        [
          request.tenantKey, request.id, request.routeId, request.proposedPayload, request.status, request.reason,
          request.policyVersion, request.proposedByActorId, request.approvedByActorId, request.approvedAt,
          request.expiresAt, request.createdAt,
        ],
      );
    },
    async getRouteChangeRequest(tenantKey, id) {
      const result = await executor.query(
        'SELECT * FROM verification.route_change_requests WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      return mapRouteChange(first(result.rows));
    },
    async listRouteChangeRequests(tenantKey) {
      const result = await executor.query(
        'SELECT * FROM verification.route_change_requests WHERE tenant_key = $1',
        [tenantKey],
      );
      return result.rows.map((row) => mapRouteChange(row)!);
    },
    async getActivePolicy(tenantKey, environment) {
      const result = await executor.query(
        `SELECT * FROM verification.policy_versions
         WHERE tenant_key = $1 AND environment = $2 AND lifecycle = 'active'`,
        [tenantKey, environment],
      );
      return mapPolicy(first(result.rows));
    },
    async getPolicyVersion(tenantKey, id) {
      const result = await executor.query(
        'SELECT * FROM verification.policy_versions WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      return mapPolicy(first(result.rows));
    },
    async listPolicyVersions(tenantKey) {
      const result = await executor.query(
        'SELECT * FROM verification.policy_versions WHERE tenant_key = $1',
        [tenantKey],
      );
      return result.rows.map((row) => mapPolicy(row)!);
    },
    async savePolicyVersion(policy) {
      await executor.query(
        `INSERT INTO verification.policy_versions (
           tenant_key, id, version, environment, lifecycle, reason, expires_at,
           proposed_by_actor_id, approved_by_actor_id, approved_at, activated_at, created_at,
           decision_retention_days, provider_redaction_delay_days, appeal_hold_days, legal_hold
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (tenant_key, id) DO UPDATE SET
           lifecycle = EXCLUDED.lifecycle, approved_by_actor_id = EXCLUDED.approved_by_actor_id,
           approved_at = EXCLUDED.approved_at, activated_at = EXCLUDED.activated_at, reason = EXCLUDED.reason,
           decision_retention_days = EXCLUDED.decision_retention_days,
           provider_redaction_delay_days = EXCLUDED.provider_redaction_delay_days,
           appeal_hold_days = EXCLUDED.appeal_hold_days,
           legal_hold = EXCLUDED.legal_hold`,
        [
          policy.tenantKey, policy.id, policy.version, policy.environment, policy.lifecycle, policy.reason,
          policy.expiresAt, policy.proposedByActorId, policy.approvedByActorId, policy.approvedAt,
          policy.activatedAt, policy.createdAt,
          policy.decisionRetentionDays, policy.providerRedactionDelayDays, policy.appealHoldDays, policy.legalHold,
        ],
      );
    },
    async listProtectedActionRequirements(tenantKey, action, policyVersionId) {
      const result = await executor.query(
        `SELECT * FROM verification.protected_action_requirements
         WHERE tenant_key = $1 AND action = $2 AND policy_version_id = $3`,
        [tenantKey, action, policyVersionId],
      );
      return result.rows.map((row) => mapRequirement(row)!);
    },
    async saveProtectedActionRequirement(requirement) {
      await executor.query(
        `INSERT INTO verification.protected_action_requirements (
           tenant_key, id, action, package_code, policy_version_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_key, id) DO NOTHING`,
        [
          requirement.tenantKey, requirement.id, requirement.action, requirement.packageCode,
          requirement.policyVersionId, requirement.createdAt,
        ],
      );
    },
    async getContinuationDestinations(tenantKey) {
      const tenant = await store.getTenant(tenantKey);
      return tenant?.continuationDestinations ?? ['verification.resume'];
    },
    async getAttempt(tenantKey, attemptId) {
      const result = await executor.query(
        'SELECT * FROM verification.attempts WHERE tenant_key = $1 AND id = $2',
        [tenantKey, attemptId],
      );
      return mapAttempt(first(result.rows));
    },
    async getAttemptByIdempotencyKey(tenantKey, key) {
      const result = await executor.query(
        'SELECT * FROM verification.attempts WHERE tenant_key = $1 AND idempotency_key = $2',
        [tenantKey, key],
      );
      return mapAttempt(first(result.rows));
    },
    async findAttemptByProviderResource(tenantKey, provider, providerResourceId) {
      const result = await executor.query(
        `SELECT * FROM verification.attempts
         WHERE tenant_key = $1 AND provider = $2 AND provider_resource_id = $3`,
        [tenantKey, provider, providerResourceId],
      );
      return mapAttempt(first(result.rows));
    },
    async listAttempts(tenantKey) {
      const result = await executor.query('SELECT * FROM verification.attempts WHERE tenant_key = $1', [tenantKey]);
      return result.rows.map((row) => mapAttempt(row)!);
    },
    async listLiveAttempts(tenantKey, subjectHash, packageCode) {
      const result = await executor.query(
        `SELECT * FROM verification.attempts
         WHERE tenant_key = $1 AND subject_hash = $2 AND package_code = $3
           AND canonical_status IN ('created','pending_user_input','paused','processing','manual_review_required')`,
        [tenantKey, subjectHash, packageCode],
      );
      return result.rows.map((row) => mapAttempt(row)!);
    },
    async insertAttempt(attempt) {
      await executor.query(
        `INSERT INTO verification.attempts (
           tenant_key, id, subject_hash, package_code, country_code, provider, environment,
           adapter_version, manifest_digest, configuration_revision, policy_version,
           provider_resource_id, provider_status, canonical_status, status_version, idempotency_key,
           parent_attempt_id, purpose_action, purpose_resource_hash, route_id, selection_reason,
           normalized_reason_codes, expires_at, create_claim_id, create_claim_expires_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [
          attempt.tenantKey, attempt.id, attempt.subjectHash, attempt.packageCode, attempt.countryCode,
          attempt.provider, attempt.environment, attempt.adapterVersion, attempt.manifestDigest,
          attempt.configurationRevision, attempt.policyVersion, attempt.providerResourceId, attempt.providerStatus,
          attempt.canonicalStatus, attempt.statusVersion, attempt.idempotencyKey, attempt.parentAttemptId,
          attempt.purposeAction, attempt.purposeResourceHash, attempt.routeId, attempt.selectionReason,
          attempt.normalizedReasonCodes, attempt.expiresAt, attempt.createClaimId, attempt.createClaimExpiresAt,
          attempt.createdAt, attempt.updatedAt,
        ],
      );
      return attempt;
    },
    async updateAttempt(attempt) {
      await executor.query(
        `UPDATE verification.attempts SET
           provider_resource_id = $3, provider_status = $4, canonical_status = $5, status_version = $6,
           normalized_reason_codes = $7, expires_at = $8, create_claim_id = $9, create_claim_expires_at = $10,
           parent_attempt_id = $11, selection_reason = $12, updated_at = $13
         WHERE tenant_key = $1 AND id = $2`,
        [
          attempt.tenantKey, attempt.id, attempt.providerResourceId, attempt.providerStatus, attempt.canonicalStatus,
          attempt.statusVersion, attempt.normalizedReasonCodes, attempt.expiresAt, attempt.createClaimId,
          attempt.createClaimExpiresAt, attempt.parentAttemptId, attempt.selectionReason, attempt.updatedAt,
        ],
      );
    },
    async insertLineage(row) {
      await executor.query(
        `INSERT INTO verification.provider_resource_lineage (
           tenant_key, id, attempt_id, resource_type, provider_resource_id, relationship_code, provider_status, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_key, provider_resource_id, resource_type) DO NOTHING`,
        [
          row.tenantKey, row.id, row.attemptId, row.resourceType, row.providerResourceId,
          row.relationshipCode, row.providerStatus, row.occurredAt,
        ],
      );
    },
    async listLineage(tenantKey, attemptId) {
      const result = await executor.query(
        'SELECT * FROM verification.provider_resource_lineage WHERE tenant_key = $1 AND attempt_id = $2',
        [tenantKey, attemptId],
      );
      return result.rows.map((row) => mapLineage(row)!);
    },
    async getValidDecision(tenantKey, subjectHash, packageCode, at) {
      const result = await executor.query(
        `SELECT * FROM verification.decisions
         WHERE tenant_key = $1 AND subject_hash = $2 AND package_code = $3
           AND status = 'verified' AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > $4)
         ORDER BY effective_at DESC LIMIT 1`,
        [tenantKey, subjectHash, packageCode, at.toISOString()],
      );
      return mapDecision(first(result.rows));
    },
    async insertDecision(decision) {
      await executor.query(
        `INSERT INTO verification.decisions (
           tenant_key, id, subject_hash, package_code, attempt_id, status, source, policy_version,
           reason_codes, effective_at, expires_at, revoked_at, proposer_actor_id, approver_actor_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          decision.tenantKey, decision.id, decision.subjectHash, decision.packageCode, decision.attemptId,
          decision.status, decision.source, decision.policyVersion, decision.reasonCodes, decision.effectiveAt,
          decision.expiresAt, decision.revokedAt, decision.proposerActorId, decision.approverActorId, decision.createdAt,
        ],
      );
    },
    async listDecisions(tenantKey, subjectHash) {
      const result = await executor.query(
        subjectHash
          ? 'SELECT * FROM verification.decisions WHERE tenant_key = $1 AND subject_hash = $2'
          : 'SELECT * FROM verification.decisions WHERE tenant_key = $1',
        subjectHash ? [tenantKey, subjectHash] : [tenantKey],
      );
      return result.rows.map((row) => mapDecision(row)!);
    },
    async revokeDecision(tenantKey, decisionId, at) {
      await executor.query(
        `UPDATE verification.decisions SET status = 'revoked', revoked_at = $3
         WHERE tenant_key = $1 AND id = $2`,
        [tenantKey, decisionId, at],
      );
    },
    async claimIdempotency(claim) {
      const inserted = await executor.query(
        `INSERT INTO verification.idempotency_claims (
           tenant_key, claim_key, operation, attempt_id, state, result_ref, error_code, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_key, claim_key) DO NOTHING
         RETURNING *`,
        [
          claim.tenantKey, claim.claimKey, claim.operation, claim.attemptId, claim.state,
          claim.resultRef, claim.errorCode, claim.createdAt,
        ],
      );
      if (inserted.rows[0]) return { disposition: 'claimed' as const, claim: mapIdempotency(inserted.rows[0])! };
      const existing = await executor.query(
        'SELECT * FROM verification.idempotency_claims WHERE tenant_key = $1 AND claim_key = $2',
        [claim.tenantKey, claim.claimKey],
      );
      return { disposition: 'existing' as const, claim: mapIdempotency(first(existing.rows)) ?? claim };
    },
    async completeIdempotency(tenantKey, key, resultRef) {
      await executor.query(
        `UPDATE verification.idempotency_claims
         SET state = 'completed', result_ref = $3, completed_at = $4
         WHERE tenant_key = $1 AND claim_key = $2`,
        [tenantKey, key, resultRef, iso(now)],
      );
    },
    async failIdempotency(tenantKey, key, errorCode) {
      await executor.query(
        `UPDATE verification.idempotency_claims
         SET state = 'failed', error_code = $3, completed_at = $4
         WHERE tenant_key = $1 AND claim_key = $2`,
        [tenantKey, key, errorCode, iso(now)],
      );
    },
    async getIdempotencyClaim(tenantKey, key) {
      const result = await executor.query(
        'SELECT * FROM verification.idempotency_claims WHERE tenant_key = $1 AND claim_key = $2',
        [tenantKey, key],
      );
      return mapIdempotency(first(result.rows));
    },
    async claimWebhookEvent(input) {
      const inserted = await executor.query(
        `INSERT INTO verification.webhook_events (
           tenant_key, id, provider, provider_event_key, provider_resource_id, event_type,
           occurred_at, body_sha256, safe_metadata, state, received_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',$10)
         ON CONFLICT (tenant_key, provider, provider_event_key) DO NOTHING
         RETURNING *`,
        [
          input.tenantKey, `wh_${input.providerEventKey}`.slice(0, 64), input.provider, input.providerEventKey,
          input.providerResourceId, input.eventType, input.occurredAt, input.bodySha256, input.safeMetadata, iso(now),
        ],
      );
      const row = inserted.rows[0] ?? first((await executor.query(
        `SELECT * FROM verification.webhook_events
         WHERE tenant_key = $1 AND provider = $2 AND provider_event_key = $3`,
        [input.tenantKey, input.provider, input.providerEventKey],
      )).rows);
      const event = mapWebhook(row);
      if (!event) {
        return { disposition: 'claimed', event: {
          tenantKey: input.tenantKey,
          id: `wh_${input.providerEventKey}`.slice(0, 64),
          provider: input.provider,
          providerEventKey: input.providerEventKey,
          providerResourceId: input.providerResourceId,
          eventType: input.eventType,
          occurredAt: input.occurredAt,
          bodySha256: input.bodySha256,
          safeMetadata: input.safeMetadata,
          state: 'accepted',
          receivedAt: iso(now),
        } satisfies WebhookEventRecord };
      }
      if (event.bodySha256 !== input.bodySha256) {
        await executor.query(
          `UPDATE verification.webhook_events SET state = 'dead_letter'
           WHERE tenant_key = $1 AND id = $2`,
          [input.tenantKey, event.id],
        );
        return { disposition: 'mismatch', event: { ...event, state: 'dead_letter' } };
      }
      if (!inserted.rows[0]) return { disposition: 'duplicate', event };
      return { disposition: 'claimed', event };
    },
    async getWebhookEvent(tenantKey, provider, eventKey) {
      const result = await executor.query(
        `SELECT * FROM verification.webhook_events
         WHERE tenant_key = $1 AND provider = $2 AND provider_event_key = $3`,
        [tenantKey, provider, eventKey],
      );
      return mapWebhook(first(result.rows));
    },
    async getWebhookEventById(tenantKey, eventId) {
      const result = await executor.query(
        'SELECT * FROM verification.webhook_events WHERE tenant_key = $1 AND id = $2',
        [tenantKey, eventId],
      );
      return mapWebhook(first(result.rows));
    },
    async settleWebhookEvent(tenantKey, eventId, outcome, errorCode) {
      await executor.query(
        `UPDATE verification.webhook_events SET state = $3
         WHERE tenant_key = $1 AND id = $2`,
        [tenantKey, eventId, outcome],
      );
      if (errorCode) {
        await executor.query(
          `UPDATE verification.webhook_leases SET last_error_code = $3
           WHERE tenant_key = $1 AND event_id = $2`,
          [tenantKey, eventId, errorCode],
        );
      }
    },
    async recordHealth(observation) {
      await executor.query(
        `INSERT INTO verification.provider_health_observations (
           tenant_key, id, provider, environment, operation, outcome, safe_code, observed_at, latency_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          observation.tenantKey, observation.id, observation.provider, observation.environment,
          observation.operation, observation.outcome, observation.safeCode, observation.observedAt, observation.latencyMs,
        ],
      );
    },
    async listHealth(tenantKey, provider) {
      const result = await executor.query(
        provider
          ? 'SELECT * FROM verification.provider_health_observations WHERE tenant_key = $1 AND provider = $2'
          : 'SELECT * FROM verification.provider_health_observations WHERE tenant_key = $1',
        provider ? [tenantKey, provider] : [tenantKey],
      );
      return result.rows.map((row) => mapHealth(row)!);
    },
    async getCircuit(tenantKey, provider, environment) {
      const result = await executor.query(
        'SELECT * FROM verification.circuits WHERE tenant_key = $1 AND provider = $2 AND environment = $3',
        [tenantKey, provider, environment],
      );
      return mapCircuit(first(result.rows)) ?? {
        tenantKey,
        provider,
        environment,
        state: 'closed',
        reasonCode: null,
        openUntil: null,
        consecutiveFailures: 0,
        drainedByActorId: null,
        updatedAt: iso(now),
      };
    },
    async saveCircuit(circuit) {
      await executor.query(
        `INSERT INTO verification.circuits (
           tenant_key, provider, environment, state, reason_code, open_until,
           consecutive_failures, drained_by_actor_id, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_key, provider, environment) DO UPDATE SET
           state = EXCLUDED.state, reason_code = EXCLUDED.reason_code, open_until = EXCLUDED.open_until,
           consecutive_failures = EXCLUDED.consecutive_failures, drained_by_actor_id = EXCLUDED.drained_by_actor_id,
           updated_at = EXCLUDED.updated_at`,
        [
          circuit.tenantKey, circuit.provider, circuit.environment, circuit.state, circuit.reasonCode,
          circuit.openUntil, circuit.consecutiveFailures, circuit.drainedByActorId, circuit.updatedAt,
        ],
      );
    },
    async listCircuits(tenantKey) {
      const result = await executor.query('SELECT * FROM verification.circuits WHERE tenant_key = $1', [tenantKey]);
      return result.rows.map((row) => mapCircuit(row)!);
    },
    async saveAppeal(appeal) {
      await executor.query(
        `INSERT INTO verification.appeals (
           tenant_key, id, attempt_id, subject_hash, status, reason, policy_version,
           proposed_by_actor_id, decided_by_actor_id, expires_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_key, id) DO UPDATE SET
           status = EXCLUDED.status, reason = EXCLUDED.reason, decided_by_actor_id = EXCLUDED.decided_by_actor_id,
           updated_at = EXCLUDED.updated_at`,
        [
          appeal.tenantKey, appeal.id, appeal.attemptId, appeal.subjectHash, appeal.status, appeal.reason,
          appeal.policyVersion, appeal.proposedByActorId, appeal.decidedByActorId, appeal.expiresAt,
          appeal.createdAt, appeal.updatedAt,
        ],
      );
    },
    async getAppeal(tenantKey, id) {
      const result = await executor.query(
        'SELECT * FROM verification.appeals WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      return mapAppeal(first(result.rows));
    },
    async listAppeals(tenantKey) {
      const result = await executor.query('SELECT * FROM verification.appeals WHERE tenant_key = $1', [tenantKey]);
      return result.rows.map((row) => mapAppeal(row)!);
    },
    async saveReviewCase(reviewCase) {
      await executor.query(
        `INSERT INTO verification.review_cases (
           tenant_key, id, attempt_id, subject_hash, status, reason, policy_version, assigned_actor_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (tenant_key, id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at`,
        [
          reviewCase.tenantKey, reviewCase.id, reviewCase.attemptId, reviewCase.subjectHash, reviewCase.status,
          reviewCase.reason, reviewCase.policyVersion, reviewCase.assignedActorId, reviewCase.createdAt, reviewCase.updatedAt,
        ],
      );
    },
    async getReviewCase(tenantKey, id) {
      const result = await executor.query(
        'SELECT * FROM verification.review_cases WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      return mapReview(first(result.rows));
    },
    async listReviewCases(tenantKey) {
      const result = await executor.query('SELECT * FROM verification.review_cases WHERE tenant_key = $1', [tenantKey]);
      return result.rows.map((row) => mapReview(row)!);
    },
    async saveManualDecisionProposal(proposal) {
      await executor.query(
        `INSERT INTO verification.manual_decision_proposals (
           tenant_key, id, review_case_id, attempt_id, proposed_status, reason, policy_version,
           expires_at, proposed_by_actor_id, approved_by_actor_id, status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_key, id) DO UPDATE SET
           status = EXCLUDED.status, approved_by_actor_id = EXCLUDED.approved_by_actor_id`,
        [
          proposal.tenantKey, proposal.id, proposal.reviewCaseId, proposal.attemptId, proposal.proposedStatus,
          proposal.reason, proposal.policyVersion, proposal.expiresAt, proposal.proposedByActorId,
          proposal.approvedByActorId, proposal.status, proposal.createdAt,
        ],
      );
    },
    async getManualDecisionProposal(tenantKey, id) {
      const result = await executor.query(
        'SELECT * FROM verification.manual_decision_proposals WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      return mapProposal(first(result.rows));
    },
    async listManualDecisionProposals(tenantKey) {
      const result = await executor.query(
        'SELECT * FROM verification.manual_decision_proposals WHERE tenant_key = $1',
        [tenantKey],
      );
      return result.rows.map((row) => mapProposal(row)!);
    },
    async saveContinuation(continuation: ContinuationRecord) {
      await executor.query(
        `INSERT INTO verification.continuations (
           tenant_key, key, token_hash, action, resource_hash, subject_hash, destination_key, expires_at, consumed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_key, key) DO UPDATE SET consumed_at = EXCLUDED.consumed_at`,
        [
          continuation.tenantKey, continuation.key, continuation.tokenHash, continuation.action,
          continuation.resourceHash, continuation.subjectHash, continuation.destinationKey,
          continuation.expiresAt, continuation.consumedAt,
        ],
      );
    },
    async getContinuation(tenantKey, key) {
      const result = await executor.query(
        'SELECT * FROM verification.continuations WHERE tenant_key = $1 AND key = $2',
        [tenantKey, key],
      );
      const row = first(result.rows);
      if (!row) return null;
      return {
        tenantKey: String(row.tenant_key),
        key: String(row.key),
        tokenHash: String(row.token_hash),
        action: String(row.action),
        resourceHash: String(row.resource_hash),
        subjectHash: String(row.subject_hash),
        destinationKey: String(row.destination_key),
        expiresAt: String(row.expires_at),
        consumedAt: row.consumed_at ? String(row.consumed_at) : null,
      };
    },
    async appendAudit(event) {
      await executor.query(
        `INSERT INTO verification.audit_events (
           tenant_key, id, actor_id, actor_type, operation, resource_type, resource_id, reason_code, safe_metadata, occurred_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          event.tenantKey, event.id, event.actorId, event.actorType, event.operation, event.resourceType,
          event.resourceId, event.reasonCode, event.safeMetadata, event.occurredAt,
        ],
      );
    },
    async listAudit(tenantKey) {
      const result = await executor.query(
        'SELECT * FROM verification.audit_events WHERE tenant_key = $1 ORDER BY occurred_at DESC',
        [tenantKey],
      );
      return result.rows.map((row) => mapAudit(row)!);
    },
    async saveJob(job) {
      if (job.kind === 'webhook') {
        await executor.query(
          `INSERT INTO verification.webhook_leases (
             tenant_key, event_id, next_attempt_at, attempt_count
           ) VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_key, event_id) DO NOTHING`,
          [job.tenantKey, job.eventId ?? job.id, job.nextAttemptAt, job.attemptCount],
        );
        return;
      }
      if (job.kind === 'redact') {
        await executor.query(
          `INSERT INTO verification.redaction_jobs (
             tenant_key, id, subject_hash, attempt_id, provider_resource_id, status,
             next_attempt_at, attempt_count, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_key, id) DO UPDATE SET status = EXCLUDED.status`,
          [
            job.tenantKey, job.id, job.subjectHash, job.attemptId, job.providerResourceId, job.state,
            job.nextAttemptAt, job.attemptCount, job.createdAt,
          ],
        );
        return;
      }
      await executor.query(
        `INSERT INTO verification.reconciliation_jobs (
           tenant_key, id, attempt_id, state, next_attempt_at, attempt_count, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_key, id) DO UPDATE SET state = EXCLUDED.state`,
        [job.tenantKey, job.id, job.attemptId, job.state, job.nextAttemptAt, job.attemptCount, job.createdAt],
      );
    },
    async getJob(tenantKey, id) {
      const redaction = await executor.query(
        'SELECT * FROM verification.redaction_jobs WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      if (redaction.rows[0]) return mapRedactionJob(redaction.rows[0]);
      const recon = await executor.query(
        'SELECT * FROM verification.reconciliation_jobs WHERE tenant_key = $1 AND id = $2',
        [tenantKey, id],
      );
      if (recon.rows[0]) return mapReconJob(recon.rows[0]);
      const lease = await executor.query(
        'SELECT * FROM verification.webhook_leases WHERE tenant_key = $1 AND event_id = $2',
        [tenantKey, id],
      );
      return lease.rows[0] ? mapWebhookJob(lease.rows[0]) : null;
    },
    async listJobs(tenantKey, kind?: QueueJobKind) {
      if (kind === 'redact') {
        const result = await executor.query(
          'SELECT * FROM verification.redaction_jobs WHERE tenant_key = $1',
          [tenantKey],
        );
        return result.rows.map((row) => mapRedactionJob(row)!);
      }
      if (kind === 'webhook') {
        const result = await executor.query(
          'SELECT * FROM verification.webhook_leases WHERE tenant_key = $1',
          [tenantKey],
        );
        return result.rows.map((row) => mapWebhookJob(row)!);
      }
      const result = await executor.query(
        'SELECT * FROM verification.reconciliation_jobs WHERE tenant_key = $1',
        [tenantKey],
      );
      return result.rows.map((row) => mapReconJob(row)!);
    },
    async claimJobs(input) {
      const claimed: JobRecord[] = [];
      if (input.kinds.includes('webhook')) {
        const result = await executor.query(
          `UPDATE verification.webhook_leases AS target
           SET lease_id = $3, worker_id = $4, expires_at = $5, attempt_count = target.attempt_count + 1
           WHERE (target.tenant_key, target.event_id) IN (
             SELECT tenant_key, event_id FROM verification.webhook_leases
             WHERE tenant_key = $1
               AND next_attempt_at <= $2
               AND (lease_id IS NULL OR expires_at < $2)
             ORDER BY next_attempt_at, event_id
             FOR UPDATE SKIP LOCKED
             LIMIT $6
           )
           RETURNING *`,
          [
            input.tenantKey, input.now.toISOString(), `lease_${input.workerId}`, input.workerId,
            new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString(), input.limit,
          ],
        );
        claimed.push(...result.rows.map((row) => mapWebhookJob(row)!));
      }
      if (input.kinds.includes('reconcile')) {
        const result = await executor.query(
          `UPDATE verification.reconciliation_jobs AS target
           SET state = 'processing', lease_id = $3, lease_expires_at = $4, attempt_count = target.attempt_count + 1
           WHERE (target.tenant_key, target.id) IN (
             SELECT tenant_key, id FROM verification.reconciliation_jobs
             WHERE tenant_key = $1
               AND state IN ('scheduled', 'retryable')
               AND next_attempt_at <= $2
             ORDER BY next_attempt_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $5
           )
           RETURNING *`,
          [
            input.tenantKey, input.now.toISOString(), `lease_${input.workerId}`,
            new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString(), input.limit,
          ],
        );
        claimed.push(...result.rows.map((row) => mapReconJob(row)!));
      }
      if (input.kinds.includes('redact')) {
        const result = await executor.query(
          `UPDATE verification.redaction_jobs AS target
           SET status = 'processing', lease_id = $3, lease_expires_at = $4, attempt_count = target.attempt_count + 1
           WHERE (target.tenant_key, target.id) IN (
             SELECT tenant_key, id FROM verification.redaction_jobs
             WHERE tenant_key = $1
               AND status IN ('scheduled', 'retryable')
               AND next_attempt_at <= $2
             ORDER BY next_attempt_at, id
             FOR UPDATE SKIP LOCKED
             LIMIT $5
           )
           RETURNING *`,
          [
            input.tenantKey, input.now.toISOString(), `lease_${input.workerId}`,
            new Date(input.now.getTime() + input.leaseSeconds * 1000).toISOString(), input.limit,
          ],
        );
        claimed.push(...result.rows.map((row) => mapRedactionJob(row)!));
      }
      return claimed.slice(0, input.limit);
    },
    async updateJob(job) {
      await store.saveJob(job);
      if (job.kind === 'webhook') {
        await executor.query(
          `UPDATE verification.webhook_leases
           SET lease_id = $3, expires_at = $4, next_attempt_at = $5, last_error_code = $6, attempt_count = $7
           WHERE tenant_key = $1 AND event_id = $2`,
          [job.tenantKey, job.eventId ?? job.id, job.leaseId, job.leaseExpiresAt, job.nextAttemptAt, job.lastErrorCode, job.attemptCount],
        );
      }
    },
    async updateRedactionStatus(tenantKey, jobId, status: RedactionStatus) {
      await executor.query(
        'UPDATE verification.redaction_jobs SET status = $3 WHERE tenant_key = $1 AND id = $2',
        [tenantKey, jobId, status],
      );
    },
  };

  return store;
}

type Row = Record<string, unknown>;

function str(row: Row | null, key: string): string {
  return String(row?.[key] ?? '');
}
function strNull(row: Row | null, key: string): string | null {
  const value = row?.[key];
  return value == null ? null : String(value);
}
function num(row: Row | null, key: string): number {
  return Number(row?.[key] ?? 0);
}
function bool(row: Row | null, key: string): boolean {
  return Boolean(row?.[key]);
}
function arr(row: Row | null, key: string): string[] {
  const value = row?.[key];
  return Array.isArray(value) ? value.map(String) : [];
}

function mapTenant(row: Row | null): TenantRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    displayName: str(row, 'display_name'),
    continuationDestinations: arr(row, 'continuation_destinations'),
    createdAt: str(row, 'created_at'),
  };
}
function mapConfig(row: Row | null): ConfigurationRevisionRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    provider: str(row, 'provider'),
    environment: str(row, 'environment') as ConfigurationRevisionRecord['environment'],
    revision: num(row, 'revision'),
    configurationDigest: str(row, 'configuration_digest'),
    lifecycle: str(row, 'lifecycle') as ConfigurationRevisionRecord['lifecycle'],
    proposedByActorId: strNull(row, 'proposed_by_actor_id'),
    approvedByActorId: strNull(row, 'approved_by_actor_id'),
    approvedAt: strNull(row, 'approved_at'),
    createdAt: str(row, 'created_at'),
  };
}
function mapProviderDef(row: Row | null): ProviderDefinitionRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    provider: str(row, 'provider'),
    environment: str(row, 'environment') as ProviderDefinitionRecord['environment'],
    adapterVersion: str(row, 'adapter_version'),
    manifestDigest: str(row, 'manifest_digest'),
    compiledInRegistry: bool(row, 'compiled_in_registry'),
    productionEligible: bool(row, 'production_eligible'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}
function mapRoute(row: Row | null): RouteRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    provider: str(row, 'provider'),
    environment: str(row, 'environment') as RouteRecord['environment'],
    packageCode: str(row, 'package_code'),
    countryCode: strNull(row, 'country_code'),
    requiredCapability: strNull(row, 'required_capability'),
    priority: num(row, 'priority'),
    cohortMin: num(row, 'cohort_min'),
    cohortMax: num(row, 'cohort_max'),
    windowStart: strNull(row, 'window_start'),
    windowEnd: strNull(row, 'window_end'),
    allowlistRequired: bool(row, 'allowlist_required'),
    allowlistedSubjectHashes: arr(row, 'allowlisted_subject_hashes'),
    configurationRevisionId: str(row, 'configuration_revision_id'),
    policyVersionId: str(row, 'policy_version_id'),
    lifecycle: str(row, 'lifecycle') as RouteRecord['lifecycle'],
    proposedByActorId: strNull(row, 'proposed_by_actor_id'),
    approvedByActorId: strNull(row, 'approved_by_actor_id'),
    approvedAt: strNull(row, 'approved_at'),
    activatedAt: strNull(row, 'activated_at'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}
function mapRouteChange(row: Row | null): RouteChangeRequestRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    routeId: strNull(row, 'route_id'),
    proposedPayload: (row.proposed_payload as RouteChangeRequestRecord['proposedPayload']) ?? {},
    status: str(row, 'status') as RouteChangeRequestRecord['status'],
    reason: str(row, 'reason'),
    policyVersion: str(row, 'policy_version'),
    proposedByActorId: str(row, 'proposed_by_actor_id'),
    approvedByActorId: strNull(row, 'approved_by_actor_id'),
    approvedAt: strNull(row, 'approved_at'),
    expiresAt: strNull(row, 'expires_at'),
    createdAt: str(row, 'created_at'),
  };
}
function mapPolicy(row: Row | null): PolicyVersionRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    version: str(row, 'version'),
    environment: str(row, 'environment') as PolicyVersionRecord['environment'],
    lifecycle: str(row, 'lifecycle') as PolicyVersionRecord['lifecycle'],
    reason: str(row, 'reason'),
    expiresAt: strNull(row, 'expires_at'),
    proposedByActorId: strNull(row, 'proposed_by_actor_id'),
    approvedByActorId: strNull(row, 'approved_by_actor_id'),
    approvedAt: strNull(row, 'approved_at'),
    activatedAt: strNull(row, 'activated_at'),
    createdAt: str(row, 'created_at'),
    decisionRetentionDays: row.decision_retention_days == null ? null : num(row, 'decision_retention_days'),
    providerRedactionDelayDays: row.provider_redaction_delay_days == null ? null : num(row, 'provider_redaction_delay_days'),
    appealHoldDays: row.appeal_hold_days == null ? null : num(row, 'appeal_hold_days'),
    legalHold: Boolean(row.legal_hold),
  };
}
function mapRequirement(row: Row | null): ProtectedActionRequirementRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    action: str(row, 'action'),
    packageCode: str(row, 'package_code'),
    policyVersionId: str(row, 'policy_version_id'),
    createdAt: str(row, 'created_at'),
  };
}
function mapAttempt(row: Row | null): AttemptRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    subjectHash: str(row, 'subject_hash'),
    packageCode: str(row, 'package_code'),
    countryCode: str(row, 'country_code'),
    provider: str(row, 'provider'),
    environment: str(row, 'environment') as AttemptRecord['environment'],
    adapterVersion: str(row, 'adapter_version'),
    manifestDigest: str(row, 'manifest_digest'),
    configurationRevision: str(row, 'configuration_revision'),
    policyVersion: str(row, 'policy_version'),
    providerResourceId: strNull(row, 'provider_resource_id'),
    providerStatus: strNull(row, 'provider_status'),
    canonicalStatus: str(row, 'canonical_status') as AttemptRecord['canonicalStatus'],
    statusVersion: num(row, 'status_version'),
    idempotencyKey: str(row, 'idempotency_key'),
    parentAttemptId: strNull(row, 'parent_attempt_id'),
    purposeAction: strNull(row, 'purpose_action'),
    purposeResourceHash: strNull(row, 'purpose_resource_hash'),
    routeId: str(row, 'route_id'),
    selectionReason: str(row, 'selection_reason'),
    normalizedReasonCodes: arr(row, 'normalized_reason_codes'),
    expiresAt: strNull(row, 'expires_at'),
    createClaimId: strNull(row, 'create_claim_id'),
    createClaimExpiresAt: strNull(row, 'create_claim_expires_at'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}
function mapLineage(row: Row | null): ProviderResourceLineageRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    attemptId: str(row, 'attempt_id'),
    resourceType: str(row, 'resource_type'),
    providerResourceId: str(row, 'provider_resource_id'),
    relationshipCode: str(row, 'relationship_code'),
    providerStatus: str(row, 'provider_status'),
    occurredAt: str(row, 'occurred_at'),
  };
}
function mapDecision(row: Row | null): DecisionRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    subjectHash: str(row, 'subject_hash'),
    packageCode: str(row, 'package_code'),
    attemptId: strNull(row, 'attempt_id'),
    status: str(row, 'status') as DecisionRecord['status'],
    source: str(row, 'source') as DecisionRecord['source'],
    policyVersion: str(row, 'policy_version'),
    reasonCodes: arr(row, 'reason_codes'),
    effectiveAt: str(row, 'effective_at'),
    expiresAt: strNull(row, 'expires_at'),
    revokedAt: strNull(row, 'revoked_at'),
    proposerActorId: strNull(row, 'proposer_actor_id'),
    approverActorId: strNull(row, 'approver_actor_id'),
    createdAt: str(row, 'created_at'),
  };
}
function mapIdempotency(row: Row | null): IdempotencyClaimRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    claimKey: str(row, 'claim_key'),
    operation: str(row, 'operation'),
    attemptId: strNull(row, 'attempt_id'),
    state: str(row, 'state') as IdempotencyClaimRecord['state'],
    resultRef: strNull(row, 'result_ref'),
    errorCode: strNull(row, 'error_code'),
    createdAt: str(row, 'created_at'),
    completedAt: strNull(row, 'completed_at'),
  };
}
function mapWebhook(row: Row | null): WebhookEventRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    provider: str(row, 'provider'),
    providerEventKey: str(row, 'provider_event_key'),
    providerResourceId: str(row, 'provider_resource_id'),
    eventType: str(row, 'event_type'),
    occurredAt: str(row, 'occurred_at'),
    bodySha256: str(row, 'body_sha256'),
    safeMetadata: (row.safe_metadata as WebhookEventRecord['safeMetadata']) ?? {},
    state: str(row, 'state') as WebhookEventRecord['state'],
    receivedAt: str(row, 'received_at'),
  };
}
function mapHealth(row: Row | null): HealthObservationRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    provider: str(row, 'provider'),
    environment: str(row, 'environment') as HealthObservationRecord['environment'],
    operation: str(row, 'operation'),
    outcome: str(row, 'outcome') as HealthObservationRecord['outcome'],
    safeCode: str(row, 'safe_code'),
    observedAt: str(row, 'observed_at'),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
  };
}
function mapCircuit(row: Row | null): CircuitRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    provider: str(row, 'provider'),
    environment: str(row, 'environment') as CircuitRecord['environment'],
    state: str(row, 'state') as CircuitRecord['state'],
    reasonCode: strNull(row, 'reason_code'),
    openUntil: strNull(row, 'open_until'),
    consecutiveFailures: num(row, 'consecutive_failures'),
    drainedByActorId: strNull(row, 'drained_by_actor_id'),
    updatedAt: str(row, 'updated_at'),
  };
}
function mapAppeal(row: Row | null): AppealRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    attemptId: str(row, 'attempt_id'),
    subjectHash: str(row, 'subject_hash'),
    status: str(row, 'status') as AppealRecord['status'],
    reason: str(row, 'reason'),
    policyVersion: str(row, 'policy_version'),
    proposedByActorId: str(row, 'proposed_by_actor_id'),
    decidedByActorId: strNull(row, 'decided_by_actor_id'),
    expiresAt: strNull(row, 'expires_at'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}
function mapReview(row: Row | null): ReviewCaseRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    attemptId: str(row, 'attempt_id'),
    subjectHash: str(row, 'subject_hash'),
    status: str(row, 'status') as ReviewCaseRecord['status'],
    reason: str(row, 'reason'),
    policyVersion: str(row, 'policy_version'),
    assignedActorId: strNull(row, 'assigned_actor_id'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
}
function mapProposal(row: Row | null): ManualDecisionProposalRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    reviewCaseId: strNull(row, 'review_case_id'),
    attemptId: str(row, 'attempt_id'),
    proposedStatus: str(row, 'proposed_status') as ManualDecisionProposalRecord['proposedStatus'],
    reason: str(row, 'reason'),
    policyVersion: str(row, 'policy_version'),
    expiresAt: strNull(row, 'expires_at'),
    proposedByActorId: str(row, 'proposed_by_actor_id'),
    approvedByActorId: strNull(row, 'approved_by_actor_id'),
    status: str(row, 'status') as ManualDecisionProposalRecord['status'],
    createdAt: str(row, 'created_at'),
  };
}
function mapAudit(row: Row | null): AuditEventRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    actorId: str(row, 'actor_id'),
    actorType: str(row, 'actor_type') as AuditEventRecord['actorType'],
    operation: str(row, 'operation'),
    resourceType: str(row, 'resource_type'),
    resourceId: strNull(row, 'resource_id'),
    reasonCode: strNull(row, 'reason_code'),
    safeMetadata: (row.safe_metadata as AuditEventRecord['safeMetadata']) ?? {},
    occurredAt: str(row, 'occurred_at'),
  };
}
function mapRedactionJob(row: Row | null): JobRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    kind: 'redact',
    attemptId: strNull(row, 'attempt_id'),
    eventId: null,
    subjectHash: strNull(row, 'subject_hash'),
    providerResourceId: strNull(row, 'provider_resource_id'),
    state: str(row, 'status') as JobRecord['state'],
    leaseId: strNull(row, 'lease_id'),
    leaseExpiresAt: strNull(row, 'lease_expires_at'),
    attemptCount: num(row, 'attempt_count'),
    nextAttemptAt: str(row, 'next_attempt_at'),
    lastErrorCode: strNull(row, 'last_error_code'),
    createdAt: str(row, 'created_at'),
  };
}
function mapReconJob(row: Row | null): JobRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'id'),
    kind: 'reconcile',
    attemptId: strNull(row, 'attempt_id'),
    eventId: null,
    subjectHash: null,
    providerResourceId: null,
    state: str(row, 'state') as JobRecord['state'],
    leaseId: strNull(row, 'lease_id'),
    leaseExpiresAt: strNull(row, 'lease_expires_at'),
    attemptCount: num(row, 'attempt_count'),
    nextAttemptAt: str(row, 'next_attempt_at'),
    lastErrorCode: strNull(row, 'last_error_code'),
    createdAt: str(row, 'created_at'),
  };
}
function mapWebhookJob(row: Row | null): JobRecord | null {
  if (!row) return null;
  return {
    tenantKey: str(row, 'tenant_key'),
    id: str(row, 'event_id'),
    kind: 'webhook',
    attemptId: null,
    eventId: str(row, 'event_id'),
    subjectHash: null,
    providerResourceId: null,
    state: 'processing',
    leaseId: strNull(row, 'lease_id'),
    leaseExpiresAt: strNull(row, 'expires_at'),
    attemptCount: num(row, 'attempt_count'),
    nextAttemptAt: str(row, 'next_attempt_at'),
    lastErrorCode: strNull(row, 'last_error_code'),
    createdAt: str(row, 'next_attempt_at'),
  };
}
