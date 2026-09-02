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
  VerificationCanonicalStatus,
  VerificationPackageCode,
  VerificationProviderCode,
  VerificationProviderEnvironment,
  WebhookClaimResult,
  WebhookEventRecord,
} from './types.ts';

export interface PolicyStore {
  getActivePolicy(
    tenantKey: string,
    environment: VerificationProviderEnvironment,
  ): Promise<PolicyVersionRecord | null>;
  getPolicyVersion(tenantKey: string, id: string): Promise<PolicyVersionRecord | null>;
  listPolicyVersions(tenantKey: string): Promise<PolicyVersionRecord[]>;
  savePolicyVersion(policy: PolicyVersionRecord): Promise<void>;
  listProtectedActionRequirements(
    tenantKey: string,
    action: string,
    policyVersionId: string,
  ): Promise<ProtectedActionRequirementRecord[]>;
  saveProtectedActionRequirement(requirement: ProtectedActionRequirementRecord): Promise<void>;
  getContinuationDestinations(tenantKey: string): Promise<string[]>;
}

export interface VerificationStore extends PolicyStore {
  now(): Date;
  hashSubject(tenantKey: string, subjectReference: string): Promise<string>;
  hashResource(tenantKey: string, resourceType: string, resourceReference: string): Promise<string>;
  transact<T>(fn: (store: VerificationStore) => Promise<T>): Promise<T>;

  getTenant(tenantKey: string): Promise<TenantRecord | null>;
  ensureTenant(tenantKey: string, displayName?: string): Promise<TenantRecord>;

  getConfigurationRevision(tenantKey: string, id: string): Promise<ConfigurationRevisionRecord | null>;
  listConfigurationRevisions(tenantKey: string): Promise<ConfigurationRevisionRecord[]>;
  saveConfigurationRevision(revision: ConfigurationRevisionRecord): Promise<void>;

  upsertProviderDefinition(definition: ProviderDefinitionRecord): Promise<void>;
  getProviderDefinition(
    tenantKey: string,
    provider: VerificationProviderCode,
    environment: VerificationProviderEnvironment,
  ): Promise<ProviderDefinitionRecord | null>;
  listProviderDefinitions(tenantKey: string): Promise<ProviderDefinitionRecord[]>;

  getRoute(tenantKey: string, routeId: string): Promise<RouteRecord | null>;
  listRoutes(tenantKey: string): Promise<RouteRecord[]>;
  listActiveRoutes(tenantKey: string, environment: VerificationProviderEnvironment): Promise<RouteRecord[]>;
  saveRoute(route: RouteRecord): Promise<void>;
  saveRouteChangeRequest(request: RouteChangeRequestRecord): Promise<void>;
  getRouteChangeRequest(tenantKey: string, id: string): Promise<RouteChangeRequestRecord | null>;
  listRouteChangeRequests(tenantKey: string): Promise<RouteChangeRequestRecord[]>;

  getAttempt(tenantKey: string, attemptId: string): Promise<AttemptRecord | null>;
  getAttemptByIdempotencyKey(tenantKey: string, key: string): Promise<AttemptRecord | null>;
  findAttemptByProviderResource(
    tenantKey: string,
    provider: VerificationProviderCode,
    providerResourceId: string,
  ): Promise<AttemptRecord | null>;
  listAttempts(tenantKey: string): Promise<AttemptRecord[]>;
  listLiveAttempts(tenantKey: string, subjectHash: string, packageCode: VerificationPackageCode): Promise<AttemptRecord[]>;
  insertAttempt(attempt: AttemptRecord): Promise<AttemptRecord>;
  updateAttempt(attempt: AttemptRecord): Promise<void>;

  insertLineage(row: ProviderResourceLineageRecord): Promise<void>;
  listLineage(tenantKey: string, attemptId: string): Promise<ProviderResourceLineageRecord[]>;

  getValidDecision(
    tenantKey: string,
    subjectHash: string,
    packageCode: VerificationPackageCode,
    at: Date,
  ): Promise<DecisionRecord | null>;
  insertDecision(decision: DecisionRecord): Promise<void>;
  listDecisions(tenantKey: string, subjectHash?: string): Promise<DecisionRecord[]>;
  revokeDecision(tenantKey: string, decisionId: string, at: string): Promise<void>;

  claimIdempotency(claim: IdempotencyClaimRecord): Promise<{ disposition: 'claimed' | 'existing'; claim: IdempotencyClaimRecord }>;
  completeIdempotency(tenantKey: string, key: string, resultRef: string): Promise<void>;
  failIdempotency(tenantKey: string, key: string, errorCode: string): Promise<void>;
  getIdempotencyClaim(tenantKey: string, key: string): Promise<IdempotencyClaimRecord | null>;

  claimWebhookEvent(input: {
    tenantKey: string;
    provider: VerificationProviderCode;
    providerEventKey: string;
    providerResourceId: string;
    eventType: string;
    occurredAt: string;
    bodySha256: string;
    safeMetadata: Record<string, string | boolean | number | null>;
  }): Promise<WebhookClaimResult>;
  getWebhookEvent(tenantKey: string, provider: VerificationProviderCode, eventKey: string): Promise<WebhookEventRecord | null>;
  getWebhookEventById(tenantKey: string, eventId: string): Promise<WebhookEventRecord | null>;
  settleWebhookEvent(
    tenantKey: string,
    eventId: string,
    outcome: 'completed' | 'retryable' | 'dead_letter',
    errorCode?: string,
  ): Promise<void>;

  recordHealth(observation: HealthObservationRecord): Promise<void>;
  listHealth(tenantKey: string, provider?: VerificationProviderCode): Promise<HealthObservationRecord[]>;

  getCircuit(
    tenantKey: string,
    provider: VerificationProviderCode,
    environment: VerificationProviderEnvironment,
  ): Promise<CircuitRecord>;
  saveCircuit(circuit: CircuitRecord): Promise<void>;
  listCircuits(tenantKey: string): Promise<CircuitRecord[]>;

  saveAppeal(appeal: AppealRecord): Promise<void>;
  getAppeal(tenantKey: string, id: string): Promise<AppealRecord | null>;
  listAppeals(tenantKey: string): Promise<AppealRecord[]>;
  saveReviewCase(reviewCase: ReviewCaseRecord): Promise<void>;
  getReviewCase(tenantKey: string, id: string): Promise<ReviewCaseRecord | null>;
  listReviewCases(tenantKey: string): Promise<ReviewCaseRecord[]>;
  saveManualDecisionProposal(proposal: ManualDecisionProposalRecord): Promise<void>;
  getManualDecisionProposal(tenantKey: string, id: string): Promise<ManualDecisionProposalRecord | null>;
  listManualDecisionProposals(tenantKey: string): Promise<ManualDecisionProposalRecord[]>;

  saveContinuation(continuation: ContinuationRecord): Promise<void>;
  getContinuation(tenantKey: string, key: string): Promise<ContinuationRecord | null>;

  appendAudit(event: AuditEventRecord): Promise<void>;
  listAudit(tenantKey: string): Promise<AuditEventRecord[]>;

  saveJob(job: JobRecord): Promise<void>;
  getJob(tenantKey: string, id: string): Promise<JobRecord | null>;
  listJobs(tenantKey: string, kind?: QueueJobKind): Promise<JobRecord[]>;
  claimJobs(input: {
    tenantKey: string;
    kinds: QueueJobKind[];
    workerId: string;
    leaseSeconds: number;
    limit: number;
    now: Date;
  }): Promise<JobRecord[]>;
  updateJob(job: JobRecord): Promise<void>;
  updateRedactionStatus(tenantKey: string, jobId: string, status: RedactionStatus): Promise<void>;
}

export const TERMINAL_STATUS_RANK: Record<VerificationCanonicalStatus, number> = {
  created: 10,
  pending_user_input: 20,
  paused: 20,
  processing: 30,
  manual_review_required: 40,
  provider_unavailable: 25,
  verified: 100,
  declined: 100,
  failed: 100,
  expired: 100,
  canceled: 100,
  redacted: 200,
};
