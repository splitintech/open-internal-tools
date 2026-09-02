import type {
  ActorContext,
  ProtectedActionDenial,
  ProviderAssociatedPersonInput,
  ProviderLaunchEnvelope,
  ProviderOrganizationInput,
  ProviderRelationshipInput,
  VerificationCanonicalStatus,
  VerificationLaunchPresentation,
  VerificationPackageCode,
} from '@splitin/verification-adapter-sdk';

export const SESSION_CONTRACT_VERSION = '1.0.0' as const;

export interface SessionContinuationV1 {
  key: string;
  token: string;
  expiresAt: string;
}

export interface SessionEnvelopeV1 {
  contractVersion: typeof SESSION_CONTRACT_VERSION;
  attemptId: string;
  packageCode: VerificationPackageCode;
  status: VerificationCanonicalStatus;
  presentation: VerificationLaunchPresentation;
  launch: ProviderLaunchEnvelope | null;
  launcherKey: string | null;
  providerDisclosure: string | null;
  safeErrorCode: string | null;
  retryAfter: string | null;
  supportPath: string | null;
  expiresAt: string | null;
  canResume: boolean;
  canRetry: boolean;
  continuation: SessionContinuationV1 | null;
}

export interface SessionMutationResult {
  attemptId: string;
  status: VerificationCanonicalStatus;
  paused?: boolean;
  canceled?: boolean;
  canResume?: boolean;
  canRetry?: boolean;
}

export interface StartSessionInput {
  packageCode: VerificationPackageCode;
  countryCode?: string;
  action?: string;
  resourceType?: string;
  resourceReference?: string;
  subjectReference?: string;
  continuationToken?: string;
  continuationKey?: string;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  email?: string | null;
  organization?: ProviderOrganizationInput | null;
  relationship?: ProviderRelationshipInput | null;
  associatedPerson?: ProviderAssociatedPersonInput | null;
  evidenceReferences?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SessionIdInput {
  attemptId: string;
  idempotencyKey: string;
}

export interface AppealInput {
  attemptId?: string;
  reasonCode: string;
  nonBiometricPathRequested?: boolean;
  details?: string;
}

export interface AppealResult {
  appealId: string;
  status: 'open' | 'in_review' | 'resolved' | 'rejected';
}

export interface SupportEscalationInput {
  attemptId?: string;
  appealId?: string;
  reasonCode: string;
  message?: string;
}

export interface SupportEscalationResult {
  escalationId: string;
  status: 'open';
}

export interface ProtectedActionInput {
  action: string;
  resourceType?: string;
  resourceReference?: string;
}

export type ProtectedActionDecision =
  | { allowed: true; enforcementActive: boolean; policyVersionId?: string | null }
  | ({ allowed: false } & ProtectedActionDenial);

export interface WebhookIngestResult {
  accepted: boolean;
  duplicate: boolean;
  providerEventKey?: string;
}

export interface SafeAdminRecord {
  id?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface AdminHealthSnapshot {
  generatedAt: string;
  runtime: SafeAdminRecord[];
  health: SafeAdminRecord[];
  alerts: SafeAdminRecord[];
}

export interface AdminRoutesSnapshot {
  generatedAt: string;
  routes: SafeAdminRecord[];
  routeChanges: SafeAdminRecord[];
}

export interface RouteChangeInput {
  operation: 'propose' | 'approve' | 'apply';
  targetRoutePolicyId?: string;
  requestId?: string;
  action?: 'activate' | 'drain' | 'rollback';
  reasonCode?: string;
}

export interface AdminCircuitsSnapshot {
  generatedAt: string;
  circuits: SafeAdminRecord[];
}

export interface CircuitInput {
  provider: string;
  providerEnvironment: 'sandbox' | 'production';
  status: 'healthy' | 'degraded' | 'unavailable' | 'circuit_open';
  errorCode?: string;
  circuitOpenUntil?: string;
}

export interface AdminAttemptsSnapshot {
  generatedAt: string;
  attempts: SafeAdminRecord[];
}

export interface AdminReviewSnapshot {
  generatedAt: string;
  appeals: SafeAdminRecord[];
  manualExceptions: SafeAdminRecord[];
  policyVersions: SafeAdminRecord[];
}

export interface ReviewInput {
  operation: 'begin_appeal_review' | 'propose_manual_exception' | 'approve_manual_exception' | 'apply_manual_exception';
  appealId?: string;
  requestId?: string;
  packageCode?: VerificationPackageCode;
  decision?: 'approve' | 'deny' | 'revoke' | 'request_more_information';
  reasonCode?: string;
  policyVersionId?: string;
  evidenceReferenceHash?: string;
  expiresAt?: string;
}

export interface AdminAuditSnapshot {
  generatedAt: string;
  audit: SafeAdminRecord[];
}

export interface AdminReconciliationSnapshot {
  generatedAt: string;
  jobs: SafeAdminRecord[];
  queues: Record<string, number>;
}

export interface ReconciliationInput {
  attemptId: string;
}

export interface AdminRedactionSnapshot {
  generatedAt: string;
  privacyRequests: SafeAdminRecord[];
  jobs: SafeAdminRecord[];
}

export interface RedactionInput {
  privacyRequestId: string;
}

export interface WorkerClaimInput {
  queue: 'webhook' | 'reconciliation' | 'redaction' | 'dead_letter';
  limit?: number;
}

export interface WorkerClaimResult {
  leases: Array<{ leaseId: string; jobId: string; queue: string }>;
}

export interface WorkerProcessInput {
  leaseId: string;
  jobId: string;
}

export interface WorkerProcessResult {
  processed: boolean;
  disposition: 'completed' | 'retryable' | 'dead_letter' | 'duplicate';
}

export interface VerificationServerPlatform {
  startSession(actor: ActorContext, input: StartSessionInput, idempotencyKey: string, request: Request): Promise<SessionEnvelopeV1>;
  resumeSession(actor: ActorContext, input: SessionIdInput, request: Request): Promise<SessionEnvelopeV1>;
  getSession(actor: ActorContext, attemptId: string): Promise<SessionEnvelopeV1>;
  retrySession(actor: ActorContext, input: SessionIdInput, request: Request): Promise<SessionEnvelopeV1>;
  pauseSession(actor: ActorContext, input: SessionIdInput): Promise<SessionMutationResult>;
  cancelSession(actor: ActorContext, input: SessionIdInput): Promise<SessionMutationResult>;
  createAppeal(actor: ActorContext, input: AppealInput, idempotencyKey: string): Promise<AppealResult>;
  createSupportEscalation(actor: ActorContext, input: SupportEscalationInput, idempotencyKey: string): Promise<SupportEscalationResult>;
  ingestWebhook(provider: string, request: Request): Promise<WebhookIngestResult>;
  evaluateProtectedAction(actor: ActorContext, input: ProtectedActionInput, idempotencyKey: string): Promise<ProtectedActionDecision>;
  admin: {
    health(actor: ActorContext): Promise<AdminHealthSnapshot>;
    routes(actor: ActorContext): Promise<AdminRoutesSnapshot>;
    mutateRoute(actor: ActorContext, input: RouteChangeInput, idempotencyKey: string): Promise<SafeAdminRecord>;
    circuits(actor: ActorContext): Promise<AdminCircuitsSnapshot>;
    setCircuit(actor: ActorContext, input: CircuitInput, idempotencyKey: string): Promise<SafeAdminRecord>;
    attempts(actor: ActorContext): Promise<AdminAttemptsSnapshot>;
    review(actor: ActorContext): Promise<AdminReviewSnapshot>;
    mutateReview(actor: ActorContext, input: ReviewInput, idempotencyKey: string): Promise<SafeAdminRecord>;
    audit(actor: ActorContext): Promise<AdminAuditSnapshot>;
    reconciliation(actor: ActorContext): Promise<AdminReconciliationSnapshot>;
    enqueueReconciliation(actor: ActorContext, input: ReconciliationInput, idempotencyKey: string): Promise<SafeAdminRecord>;
    redaction(actor: ActorContext): Promise<AdminRedactionSnapshot>;
    approveRedaction(actor: ActorContext, input: RedactionInput, idempotencyKey: string): Promise<SafeAdminRecord>;
  };
  workers: {
    claim(actor: ActorContext, input: WorkerClaimInput, idempotencyKey: string): Promise<WorkerClaimResult>;
    process(actor: ActorContext, input: WorkerProcessInput, idempotencyKey: string): Promise<WorkerProcessResult>;
  };
}

export interface VerificationFetchHandlerOptions {
  resolveActor(request: Request): Promise<ActorContext>;
  allowedOrigins?: string[];
  isCookieAuthenticated?(request: Request): boolean;
  basePath?: string;
  maxBodyBytes?: number;
  supportPath?: string;
  rateLimit?(actor: ActorContext, routeId: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

export const FORBIDDEN_CLIENT_FIELDS = [
  'provider',
  'launcherKey',
  'templateId',
  'workflowId',
  'apiOrigin',
  'environment',
  'configurationRevision',
  'adapter',
  'adapterVersion',
  'routePolicyId',
] as const;
