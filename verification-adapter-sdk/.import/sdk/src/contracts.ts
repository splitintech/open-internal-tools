import type { ProviderErrorCode } from './errors.ts';

export const VERIFICATION_ADAPTER_CONTRACT_VERSION = '2.0.0' as const;

export type VerificationProviderCode = string;
export type VerificationProviderEnvironment = 'sandbox' | 'production';
export type VerificationLaunchPresentation = 'embedded' | 'hosted' | 'qr' | 'none';
export type VerificationLauncherAdapter = string;
export type VerificationPackageCode =
  | 'human_idv'
  | 'ownership_review'
  | 'business_kyb'
  | 'associated_person_idv';

export type VerificationCanonicalStatus =
  | 'created'
  | 'pending_user_input'
  | 'paused'
  | 'processing'
  | 'manual_review_required'
  | 'verified'
  | 'declined'
  | 'failed'
  | 'expired'
  | 'canceled'
  | 'provider_unavailable';

export type ProviderOperation =
  | 'create'
  | 'resume'
  | 'retrieve'
  | 'retry'
  | 'reconcile'
  | 'cancel'
  | 'redact'
  | 'webhook_verify'
  | 'webhook_normalize'
  | 'webhook_apply'
  | 'health';

export interface ProviderCapabilities {
  presentations: VerificationLaunchPresentation[];
  canResume: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canRedact: boolean;
}

export interface ProviderManifestV2 {
  contractVersion: typeof VERIFICATION_ADAPTER_CONTRACT_VERSION;
  provider: VerificationProviderCode;
  displayName: string;
  adapterVersion: string;
  supportedPackages: VerificationPackageCode[];
  supportedCountries: string[];
  environments: VerificationProviderEnvironment[];
  capabilities: ProviderCapabilities;
  launcherKeys: string[];
  requiredSecretNames: string[];
  optionalSecretNames: string[];
  configurationSchemaVersion: string;
  configurationSchema: ProviderConfigurationSchemaV2;
  webhook: {
    authentication: 'plaid_es256_jwk' | 'persona_hmac_sha256' | 'stripe_v1_hmac' | 'none';
    eventTypes: string[];
    toleranceSeconds?: number;
  };
  dataPolicy: {
    prefillAllowlist: string[];
    persistedDataClasses: string[];
    rawPayloadPersistence: false;
    browserSecretPersistence: false;
  };
  retry: {
    sameResourceWhenResumable: boolean;
    newAttemptAfterTerminal: boolean;
  };
}

export interface ProviderConfigurationSchemaV2 {
  type: 'object';
  additionalProperties: false;
  required: string[];
  properties: Record<string, {
    type: 'string';
    minLength: number;
    sensitive: boolean;
  }>;
}

export interface ProviderSafeLogger {
  info(event: string, metadata?: Record<string, string | number | boolean | null>): void;
  warn(event: string, metadata?: Record<string, string | number | boolean | null>): void;
  error(event: string, metadata?: Record<string, string | number | boolean | null>): void;
}

export interface ProviderHealthObservation {
  operation: ProviderOperation;
  outcome: 'success' | 'retryable_failure' | 'terminal_failure' | 'unknown_status';
  safeCode: string;
  observedAt: string;
  latencyMs?: number;
}

export interface ProviderRuntimeContext<TConfiguration extends object = Record<string, unknown>> {
  environment: VerificationProviderEnvironment;
  configuration: Readonly<TConfiguration>;
  fetch: typeof fetch;
  now: () => Date;
  idempotency: {
    /** Returns the server-owned key for a single provider operation. */
    keyFor(operation: ProviderOperation, attemptId: string, suppliedKey?: string): string;
  };
  logger: ProviderSafeLogger;
  recordHealth: (observation: ProviderHealthObservation) => Promise<void>;
}

export interface ProviderAttemptCommand {
  attemptId: string;
  humanSubjectReference: string;
  subjectReference?: string;
  packageCode: string;
  idempotencyKey: string;
  providerConfigReference: string;
  providerTemplateReference?: string | null;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  email?: string | null;
  business?: ProviderBusinessInput | null;
  relationship?: ProviderRelationshipInput | null;
  requestOrigin?: string | null;
  /** Server-authorized accessibility path. Browser callers cannot set this directly. */
  reviewMode?: 'standard' | 'document_only_manual_review';
}

export interface ProviderAddressInput {
  street1: string;
  street2?: string | null;
  city: string;
  subdivision?: string | null;
  postalCode: string;
  countryCode: string;
}

export interface ProviderBusinessInput {
  legalName: string;
  taxIdentificationNumber: string;
  registeredAddress: ProviderAddressInput;
  physicalAddress?: ProviderAddressInput | null;
  jurisdictionCountryCode: string;
  entityType?: string | null;
  approvedDocumentIds?: string[];
  associatedPeople?: ProviderAssociatedPersonInput[];
}

export type ProviderRelationshipKind =
  | 'ubo'
  | 'director'
  | 'officer'
  | 'authorized_representative'
  | 'property_owner'
  | 'associated_person';

export interface ProviderAssociatedPersonInput {
  accountReferenceId: string;
  legalFirstName: string;
  legalLastName: string;
  email?: string | null;
  relationshipKind: ProviderRelationshipKind;
  claimedOwnershipPercentage?: number | null;
}

export interface ProviderRelationshipInput {
  relationshipReference: string;
  kind: ProviderRelationshipKind;
  claimedOwnershipPercentage?: number | null;
  accountReferenceId?: string | null;
}

export interface ProviderResumeCommand {
  attemptId: string;
  providerResourceId: string;
  providerConfigReference: string;
  requestOrigin?: string | null;
}

export interface ProviderRetryCommand extends ProviderAttemptCommand {
  previousProviderResourceId?: string | null;
}

export interface ProviderResourceCommand {
  attemptId: string;
  providerResourceId: string;
  providerConfigReference: string;
  requestOrigin?: string | null;
}

export interface ProviderRedactionCommand {
  subjectReference: string;
  providerResourceId?: string | null;
  providerResourceType?: 'inquiry' | 'transaction' | 'account' | 'case' | 'report' | 'verification';
  requestReference: string;
}

export interface ProviderLaunchResult {
  presentation: VerificationLaunchPresentation;
  /** Generic compile-time launcher selector. Product code must not use it for authorization. */
  launcherKey: string;
  /** @deprecated Rolling compatibility until all V1 envelopes have expired. */
  adapter?: VerificationLauncherAdapter;
  inquiryOrSessionId?: string;
  environmentId?: string;
  /** One-time, memory-only launch credential. It must never be logged or persisted. */
  transientSecret?: string;
  /** Expiry of the transient embedded-launch credential. */
  transientSecretExpiresAt?: string;
  /** @deprecated V1 bridge alias; remove after all callers consume transientSecret. */
  opaqueLaunchSecret?: string;
  hostedUrl?: string;
  /** Expiry of the hosted fallback URL when it differs from the embedded credential. */
  hostedFallbackExpiresAt?: string;
  expiresAt?: string;
  providerDisclosure?: string;
}

export type ProviderLaunchEnvelope = ProviderLaunchResult;

export interface ProviderAttemptResult {
  providerResourceId: string;
  providerAccountId?: string;
  providerStatus: string;
  launch: ProviderLaunchResult;
  linkedResources?: Array<{
    resourceType: 'inquiry' | 'transaction' | 'case';
    resourceId: string;
    relationshipCode: 'primary_inquiry' | 'kyb_transaction' | 'initial_review_case' | 'associated_person_inquiry';
    providerStatus: string;
    occurredAt: string;
  }>;
}

export interface NormalizedProviderSnapshot {
  providerResourceId: string;
  providerStatus: string;
  canonicalStatus: VerificationCanonicalStatus;
  occurredAt: string;
  /** Provider object creation time, retained separately from observation time. */
  providerCreatedAt?: string;
  normalizedReasonCodes: string[];
  safeMetadata: Record<string, string | boolean | number | null>;
}

export interface ProviderOperationResult {
  accepted: boolean;
  providerStatus?: string;
}

export interface ProviderRedactionResult {
  completed: boolean;
  retryable: boolean;
  disposition?: 'redacted' | 'processing' | 'not_applicable' | 'failed';
}

export interface VerifiedWebhookEnvelope {
  providerEventKey: string;
  receivedAt: string;
  bodySha256: string;
  signatureIssuedAt?: string;
  opaquePayload: Uint8Array;
}

export interface NormalizedProviderEvent {
  providerEventKey: string;
  providerResourceId: string;
  eventType: string;
  providerEventType: string;
  canonicalStatus?: VerificationCanonicalStatus;
  occurredAt: string;
  normalizedReasonCodes: string[];
  safeMetadata: Record<string, string | boolean | number | null>;
}

export interface VerificationAdapterV2 {
  readonly contractVersion: typeof VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest: ProviderManifestV2;
  readonly provider: VerificationProviderCode;
  readonly environment: VerificationProviderEnvironment;
  validateConfiguration(): void;
  capabilities(): ProviderCapabilities;
  createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult>;
  resumeAttempt(command: ProviderResumeCommand): Promise<ProviderLaunchResult>;
  retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot>;
  reconcileAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot>;
  requestRetry(command: ProviderRetryCommand): Promise<ProviderAttemptResult>;
  cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult>;
  redactSubject(command: ProviderRedactionCommand): Promise<ProviderRedactionResult>;
  verifyWebhook(input: Request): Promise<VerifiedWebhookEnvelope>;
  normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent>;
}

/** @deprecated Source-compatible alias used while current tests migrate to the V2 name. */
export type VerificationProviderAdapter = VerificationAdapterV2;

export interface VerificationWebhookEventApplier {
  applyNormalizedEvent(normalizedEventId: string): Promise<void>;
}

export interface VerificationProviderHealthPort {
  record(provider: VerificationProviderCode, environment: VerificationProviderEnvironment, observation: ProviderHealthObservation): Promise<void>;
}

export interface SafeProviderFailure {
  code: ProviderErrorCode;
  safeCode: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}
