import type {
  ActorContext,
  ProtectedActionDenial,
  ProviderLaunchEnvelope,
  ProviderOrganizationInput,
  ProviderRelationshipInput,
  VerificationCanonicalStatus,
  VerificationPackageCode,
  VerificationProviderCode,
  VerificationProviderEnvironment,
} from '@splitin/verification-adapter-sdk';

export type {
  ActorContext,
  ProtectedActionDenial,
  VerificationCanonicalStatus,
  VerificationPackageCode,
  VerificationProviderCode,
  VerificationProviderEnvironment,
};

export const FORBIDDEN_CLIENT_ROUTE_KEYS = [
  'provider',
  'templateId',
  'template_id',
  'workflowId',
  'workflow_id',
  'apiOrigin',
  'api_origin',
  'configurationRevision',
  'configuration_revision',
  'adapterVersion',
  'manifestDigest',
  'policyVersion',
  'routeId',
] as const;

export const LIVE_ATTEMPT_STATUSES: VerificationCanonicalStatus[] = [
  'created',
  'pending_user_input',
  'paused',
  'processing',
  'manual_review_required',
];

export const GOVERNANCE_TRANSITIONS = [
  'approve',
  'deny',
  'request_more_information',
  'revoke',
  'expire',
] as const;

export type GovernanceTransition = (typeof GOVERNANCE_TRANSITIONS)[number];

export type CircuitState = 'closed' | 'open' | 'half_open';
export type RouteLifecycle = 'draft' | 'approved' | 'active' | 'retired';
export type PolicyLifecycle = 'draft' | 'approved' | 'active' | 'retired';
export type IdempotencyState = 'claimed' | 'completed' | 'failed';
export type WebhookEventState = 'accepted' | 'processing' | 'completed' | 'retryable' | 'dead_letter';
export type RedactionStatus =
  | 'scheduled'
  | 'processing'
  | 'retryable'
  | 'redacted'
  | 'not_applicable'
  | 'dead_letter';
export type QueueJobKind = 'webhook' | 'reconcile' | 'redact';
export type AppealStatus = 'open' | 'approved' | 'denied' | 'more_information_requested' | 'revoked' | 'expired';
export type ReviewStatus = AppealStatus | 'in_review';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected';
export type DecisionStatus = 'verified' | 'declined' | 'revoked' | 'expired';

/** Application-defined reason codes the SDK stores without interpreting housing or biometric policy. */
export const APPLICATION_REASON_CODES = [
  'underage',
  'unsupported_capability',
  'biometric_alternative_requested',
  'manual_review_required',
  'document_unreadable',
  'more_information_requested',
] as const;

export function isApplicationReasonCode(value: string): value is ApplicationReasonCode {
  return (APPLICATION_REASON_CODES as readonly string[]).includes(value);
}

export type ApplicationReasonCode = (typeof APPLICATION_REASON_CODES)[number];

export type EngineOperation =
  | 'start'
  | 'resume'
  | 'status'
  | 'retry'
  | 'pause'
  | 'cancel'
  | 'redact'
  | 'ingest_webhook'
  | 'process_webhook'
  | 'reconcile'
  | 'appeal'
  | 'review'
  | 'evaluate_protected_action'
  | 'admin.health'
  | 'admin.routes'
  | 'admin.circuits'
  | 'admin.attempts'
  | 'admin.audit'
  | 'admin.propose_route'
  | 'admin.approve_route'
  | 'admin.propose_policy'
  | 'admin.approve_policy'
  | 'admin.activate_policy'
  | 'admin.emergency_drain';

export interface AuthorizeFn {
  (actor: ActorContext, operation: EngineOperation, resource: { type: string; id?: string }): Promise<boolean> | boolean;
}

export interface EngineRuntime {
  now?: () => Date;
  crypto?: Crypto;
  productionEnabled?: boolean;
  seedSandboxExamples?: boolean;
  continuationTtlSeconds?: number;
  webhookLeaseSeconds?: number;
  maxWorkerAttempts?: number;
  workerConcurrency?: number;
  defaultDecisionTtlSeconds?: number;
  rateBudgetPerProvider?: number;
  random?: () => number;
}

export interface StartVerificationCommand {
  packageCode: VerificationPackageCode;
  countryCode: string;
  subjectReference: string;
  idempotencyKey: string;
  action?: string | null;
  resourceType?: string | null;
  resourceReference?: string | null;
  organization?: ProviderOrganizationInput | null;
  relationship?: ProviderRelationshipInput | null;
  associatedPerson?: ProviderAssociatedPersonLike | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  email?: string | null;
  requestOrigin?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  evidenceReferences?: string[];
}

interface ProviderAssociatedPersonLike {
  subjectReference: string;
  legalFirstName: string;
  legalLastName: string;
  email?: string | null;
  relationshipKind: string;
  claimedOwnershipPercentage?: number | null;
}

export interface ResumeVerificationCommand {
  attemptId: string;
  requestOrigin?: string | null;
}

export interface RetryVerificationCommand extends StartVerificationCommand {
  parentAttemptId: string;
}

export interface RedactCommand {
  subjectReference: string;
  attemptId?: string | null;
  requestReference?: string | null;
}

export interface ProtectedActionCommand {
  action: string;
  resourceType: string;
  resourceReference: string;
  subjectReference: string;
  destinationKey?: string;
}

export interface IngestWebhookCommand {
  provider: VerificationProviderCode;
  request: Request;
  tenantKey: string;
}

export interface AppealSubmitCommand {
  attemptId: string;
  reason: string;
  expiresAt?: string | null;
}

export interface AppealTransitionCommand {
  appealId: string;
  transition: GovernanceTransition;
  reason: string;
}

export interface ReviewProposeCommand {
  attemptId: string;
  proposedStatus: DecisionStatus;
  reason: string;
  expiresAt?: string | null;
}

export interface ReviewDecideCommand {
  proposalId: string;
  transition: Extract<GovernanceTransition, 'approve' | 'deny'>;
  reason: string;
}

export interface ReviewCaseTransitionCommand {
  reviewCaseId: string;
  transition: GovernanceTransition;
  reason: string;
}

export interface SafeAttemptView {
  attemptId: string;
  packageCode: VerificationPackageCode;
  status: VerificationCanonicalStatus;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  adapterVersion: string;
  manifestDigest: string;
  configurationRevision: string;
  policyVersion: string;
  canResume: boolean;
  canRetry: boolean;
  expiresAt: string | null;
  safeErrorCode: string | null;
  retryAfter: string | null;
  supportPath: string | null;
  launch: ProviderLaunchEnvelope | null;
}

export interface ProtectedActionAllow {
  allowed: true;
}

export type ProtectedActionResult = ProtectedActionAllow | ProtectedActionDenial;

export interface TenantRecord {
  tenantKey: string;
  displayName: string;
  continuationDestinations: string[];
  createdAt: string;
}

export interface ConfigurationRevisionRecord {
  tenantKey: string;
  id: string;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  revision: number;
  configurationDigest: string;
  lifecycle: 'draft' | 'approved' | 'retired';
  proposedByActorId: string | null;
  approvedByActorId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface ProviderDefinitionRecord {
  tenantKey: string;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  adapterVersion: string;
  manifestDigest: string;
  compiledInRegistry: boolean;
  productionEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RouteRecord {
  tenantKey: string;
  id: string;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  packageCode: VerificationPackageCode;
  countryCode: string | null;
  requiredCapability: string | null;
  priority: number;
  cohortMin: number;
  cohortMax: number;
  windowStart: string | null;
  windowEnd: string | null;
  allowlistRequired: boolean;
  allowlistedSubjectHashes: string[];
  configurationRevisionId: string;
  policyVersionId: string;
  lifecycle: RouteLifecycle;
  proposedByActorId: string | null;
  approvedByActorId: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RouteChangeRequestRecord {
  tenantKey: string;
  id: string;
  routeId: string | null;
  proposedPayload: Record<string, string | number | boolean | null>;
  status: ProposalStatus;
  reason: string;
  policyVersion: string;
  proposedByActorId: string;
  approvedByActorId: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PolicyVersionRecord {
  tenantKey: string;
  id: string;
  version: string;
  environment: VerificationProviderEnvironment;
  lifecycle: PolicyLifecycle;
  reason: string;
  expiresAt: string | null;
  proposedByActorId: string | null;
  approvedByActorId: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  decisionRetentionDays: number | null;
  providerRedactionDelayDays: number | null;
  appealHoldDays: number | null;
  legalHold: boolean;
}

export interface ProtectedActionRequirementRecord {
  tenantKey: string;
  id: string;
  action: string;
  packageCode: VerificationPackageCode;
  policyVersionId: string;
  createdAt: string;
}

export interface AttemptRecord {
  tenantKey: string;
  id: string;
  subjectHash: string;
  packageCode: VerificationPackageCode;
  countryCode: string;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  adapterVersion: string;
  manifestDigest: string;
  configurationRevision: string;
  policyVersion: string;
  providerResourceId: string | null;
  providerStatus: string | null;
  canonicalStatus: VerificationCanonicalStatus;
  statusVersion: number;
  idempotencyKey: string;
  parentAttemptId: string | null;
  purposeAction: string | null;
  purposeResourceHash: string | null;
  routeId: string;
  selectionReason: string;
  normalizedReasonCodes: string[];
  expiresAt: string | null;
  createClaimId: string | null;
  createClaimExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderResourceLineageRecord {
  tenantKey: string;
  id: string;
  attemptId: string;
  resourceType: string;
  providerResourceId: string;
  relationshipCode: string;
  providerStatus: string;
  occurredAt: string;
}

export interface DecisionRecord {
  tenantKey: string;
  id: string;
  subjectHash: string;
  packageCode: VerificationPackageCode;
  attemptId: string | null;
  status: DecisionStatus;
  source: 'provider' | 'manual';
  policyVersion: string;
  reasonCodes: string[];
  effectiveAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  proposerActorId: string | null;
  approverActorId: string | null;
  createdAt: string;
}

export interface IdempotencyClaimRecord {
  tenantKey: string;
  claimKey: string;
  operation: string;
  attemptId: string | null;
  state: IdempotencyState;
  resultRef: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WebhookEventRecord {
  tenantKey: string;
  id: string;
  provider: VerificationProviderCode;
  providerEventKey: string;
  providerResourceId: string;
  eventType: string;
  occurredAt: string;
  bodySha256: string;
  safeMetadata: Record<string, string | boolean | number | null>;
  state: WebhookEventState;
  receivedAt: string;
}

export interface WebhookLeaseRecord {
  tenantKey: string;
  eventId: string;
  leaseId: string | null;
  workerId: string | null;
  expiresAt: string | null;
  attemptCount: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
}

export interface JobRecord {
  tenantKey: string;
  id: string;
  kind: QueueJobKind;
  attemptId: string | null;
  eventId: string | null;
  subjectHash: string | null;
  providerResourceId: string | null;
  state: 'scheduled' | 'processing' | 'retryable' | 'completed' | 'dead_letter' | RedactionStatus;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  createdAt: string;
}

export interface HealthObservationRecord {
  tenantKey: string;
  id: string;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  operation: string;
  outcome: 'success' | 'retryable_failure' | 'terminal_failure' | 'unknown_status';
  safeCode: string;
  observedAt: string;
  latencyMs: number | null;
}

export interface CircuitRecord {
  tenantKey: string;
  provider: VerificationProviderCode;
  environment: VerificationProviderEnvironment;
  state: CircuitState;
  reasonCode: string | null;
  openUntil: string | null;
  consecutiveFailures: number;
  drainedByActorId: string | null;
  updatedAt: string;
}

export interface AppealRecord {
  tenantKey: string;
  id: string;
  attemptId: string;
  subjectHash: string;
  status: AppealStatus;
  reason: string;
  policyVersion: string;
  proposedByActorId: string;
  decidedByActorId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewCaseRecord {
  tenantKey: string;
  id: string;
  attemptId: string;
  subjectHash: string;
  status: ReviewStatus;
  reason: string;
  policyVersion: string;
  assignedActorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualDecisionProposalRecord {
  tenantKey: string;
  id: string;
  reviewCaseId: string | null;
  attemptId: string;
  proposedStatus: DecisionStatus;
  reason: string;
  policyVersion: string;
  expiresAt: string | null;
  proposedByActorId: string;
  approvedByActorId: string | null;
  status: ProposalStatus;
  createdAt: string;
}

export interface ContinuationRecord {
  tenantKey: string;
  key: string;
  tokenHash: string;
  action: string;
  resourceHash: string;
  subjectHash: string;
  destinationKey: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface AuditEventRecord {
  tenantKey: string;
  id: string;
  actorId: string;
  actorType: ActorContext['actorType'];
  operation: string;
  resourceType: string;
  resourceId: string | null;
  reasonCode: string | null;
  safeMetadata: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface WebhookClaimResult {
  disposition: 'claimed' | 'duplicate' | 'mismatch' | 'in_progress' | 'dead_letter';
  event: WebhookEventRecord;
}

export interface IngestWebhookResult {
  accepted: true;
  duplicate: boolean;
  eventId: string;
}

export type RateAcquireResult = { allowed: boolean; retryAfterSeconds?: number };
