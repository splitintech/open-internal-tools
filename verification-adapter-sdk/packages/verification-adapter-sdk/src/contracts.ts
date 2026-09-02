import type { ProviderErrorCode } from './errors.ts';
import type {
  ProviderOperation,
  VerificationCanonicalStatus,
  VerificationLaunchPresentation,
  VerificationPackageCode,
  VerificationProviderCode,
  VerificationProviderEnvironment,
  WebhookProtocolId,
} from './identifiers.ts';

export type {
  ProviderOperation,
  StandardPackageCode,
  StandardRelationshipKind,
  StandardWebhookProtocol,
  TerminalVerificationStatus,
  VerificationCanonicalStatus,
  VerificationLaunchPresentation,
  VerificationPackageCode,
  VerificationProviderCode,
  VerificationProviderEnvironment,
  VerificationLauncherKey,
  WebhookProtocolId,
  ProviderResourceType,
} from './identifiers.ts';

export {
  CANONICAL_STATUSES,
  ENGINE_CONTRACT_VERSION,
  LAUNCH_PRESENTATIONS,
  PROVIDER_ENVIRONMENTS,
  PROVIDER_MANIFEST_SCHEMA_URN,
  PROVIDER_OPERATIONS,
  STANDARD_PACKAGE_CODES,
  STANDARD_RELATIONSHIP_KINDS,
  STANDARD_WEBHOOK_PROTOCOLS,
  TERMINAL_STATUSES,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  assertPackageCode,
  compareSemver,
  isCanonicalStatus,
  isCountryCode,
  isCustomPackageCode,
  isLauncherKey,
  isOpaqueSubjectReference,
  isPackageCode,
  isProviderCode,
  isResourceType,
  isSemver,
  isStandardPackageCode,
  isTerminalStatus,
  isWebhookProtocol,
  majorsCompatible,
  metadataContainsForbiddenIdentifier,
} from './identifiers.ts';

export interface ProviderCapabilities {
  presentations: VerificationLaunchPresentation[];
  canResume: boolean;
  canRetry: boolean;
  canCancel: boolean;
  canRedact: boolean;
}

export interface JsonSchema2020 {
  $schema?: string;
  $id?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  additionalProperties?: boolean | JsonSchema2020;
  properties?: Record<string, JsonSchema2020>;
  items?: JsonSchema2020 | JsonSchema2020[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  format?: string;
  'x-secret'?: boolean;
  [key: string]: unknown;
}

export interface ProviderConfigurationSchemaV1 extends JsonSchema2020 {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  type: 'object';
  additionalProperties: false;
  required: string[];
  properties: Record<string, JsonSchema2020>;
}

export interface ProviderManifestV1 {
  contractVersion: typeof import('./identifiers.ts').VERIFICATION_ADAPTER_CONTRACT_VERSION;
  adapterVersion: string;
  engineCompatibility: string;
  provider: VerificationProviderCode;
  displayName: string;
  description?: string;
  supportedPackages: VerificationPackageCode[];
  supportedCountries: string[];
  environments: VerificationProviderEnvironment[];
  capabilities: ProviderCapabilities;
  launcherKeys: string[];
  launchPresentations: VerificationLaunchPresentation[];
  configurationSchemaVersion: string;
  configurationSchema: ProviderConfigurationSchemaV1;
  webhook: {
    protocol: WebhookProtocolId;
    eventFamilies: string[];
    toleranceSeconds?: number;
  };
  dataPolicy: {
    classifications: string[];
    prohibitedPersistence: string[];
    rawPayloadPersistence: false;
    browserSecretPersistence: false;
    governmentIdentifierPersistence: false;
  };
  retry: {
    sameResourceWhenResumable: boolean;
    newAttemptAfterTerminal: boolean;
  };
  cancellation: {
    supported: boolean;
    terminal: boolean;
  };
  redaction: {
    supported: boolean;
    asynchronous: boolean;
    notApplicable?: boolean;
  };
  apiHosts: string[];
  testedApiVersions: string[];
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

export interface TraceSpan {
  name: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface OpenTelemetryHooks {
  counter?(name: string, value: number, attributes?: Record<string, string>): void;
  histogram?(name: string, value: number, attributes?: Record<string, string>): void;
  startSpan?(span: TraceSpan): { end(): void };
}

export interface ProviderRateBudget {
  acquire(operation: ProviderOperation): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

export interface ProviderHttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface ProviderRuntimeContext<TConfiguration extends object = Record<string, unknown>> {
  environment: VerificationProviderEnvironment;
  configuration: Readonly<TConfiguration>;
  http: ProviderHttpClient;
  now: () => Date;
  crypto: Crypto;
  idempotency: {
    keyFor(operation: ProviderOperation, attemptId: string, suppliedKey?: string): string;
  };
  logger: ProviderSafeLogger;
  telemetry?: OpenTelemetryHooks;
  recordHealth: (observation: ProviderHealthObservation) => Promise<void>;
  rateBudget?: ProviderRateBudget;
}

export interface ProviderAddressInput {
  street1: string;
  street2?: string | null;
  city: string;
  subdivision?: string | null;
  postalCode: string;
  countryCode: string;
}

export interface ProviderAssociatedPersonInput {
  subjectReference: string;
  legalFirstName: string;
  legalLastName: string;
  email?: string | null;
  relationshipKind: string;
  claimedOwnershipPercentage?: number | null;
}

export interface ProviderOrganizationInput {
  legalName: string;
  jurisdictionCountryCode: string;
  entityType?: string | null;
  registeredAddress?: ProviderAddressInput | null;
  physicalAddress?: ProviderAddressInput | null;
  associatedPeople?: ProviderAssociatedPersonInput[];
  evidenceReferences?: string[];
}

export interface ProviderRelationshipInput {
  relationshipReference: string;
  kind: string;
  claimedOwnershipPercentage?: number | null;
  subjectReference?: string | null;
}

export interface ProviderAttemptCommand {
  attemptId: string;
  subjectReference: string;
  organizationReference?: string | null;
  packageCode: VerificationPackageCode;
  countryCode: string;
  idempotencyKey: string;
  configurationRevision: string;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  email?: string | null;
  organization?: ProviderOrganizationInput | null;
  relationship?: ProviderRelationshipInput | null;
  associatedPerson?: ProviderAssociatedPersonInput | null;
  evidenceReferences?: string[];
  requestOrigin?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ProviderResumeCommand {
  attemptId: string;
  providerResourceId: string;
  configurationRevision: string;
  requestOrigin?: string | null;
}

export interface ProviderRetryCommand extends ProviderAttemptCommand {
  previousProviderResourceId?: string | null;
}

export interface ProviderResourceCommand {
  attemptId: string;
  providerResourceId: string;
  configurationRevision: string;
  requestOrigin?: string | null;
}

export interface ProviderRedactionCommand {
  subjectReference: string;
  providerResourceId?: string | null;
  providerResourceType?: string;
  requestReference: string;
}

export interface ProviderLaunchEnvelope {
  attemptId: string;
  canonicalStatus: VerificationCanonicalStatus;
  launcherKey: string;
  presentation: VerificationLaunchPresentation;
  providerDisclosure?: string;
  transientSecret?: string;
  transientSecretExpiresAt?: string;
  hostedUrl?: string;
  hostedFallbackExpiresAt?: string;
  safeErrorCode?: string | null;
  retryAfter?: string | null;
  supportPath?: string | null;
  continuationReference?: string;
}

export interface ProviderAttemptResult {
  attemptId: string;
  providerResourceId: string;
  providerStatus: string;
  canonicalStatus: VerificationCanonicalStatus;
  launch: ProviderLaunchEnvelope;
  linkedResources?: Array<{
    resourceType: string;
    resourceId: string;
    relationshipCode: string;
    providerStatus: string;
    occurredAt: string;
  }>;
}

export interface NormalizedProviderSnapshot {
  providerResourceId: string;
  providerStatus: string;
  canonicalStatus: VerificationCanonicalStatus;
  occurredAt: string;
  providerCreatedAt?: string;
  normalizedReasonCodes: string[];
  safeMetadata: Record<string, string | boolean | number | null>;
}

export interface ProviderOperationResult {
  accepted: boolean;
  providerStatus?: string;
  canonicalStatus?: VerificationCanonicalStatus;
}

export interface ProviderRedactionResult {
  completed: boolean;
  retryable: boolean;
  disposition?: 'scheduled' | 'processing' | 'retryable' | 'redacted' | 'not_applicable' | 'dead_letter' | 'failed';
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

/**
 * Provider-neutral verification adapter. The engine owns reconciliation,
 * queues, routing, attempts, decisions and protected-action enforcement.
 */
export interface VerificationAdapterV1<TConfig extends object = Record<string, unknown>> {
  readonly contractVersion: typeof import('./identifiers.ts').VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest: ProviderManifestV1;
  readonly provider: VerificationProviderCode;
  readonly environment: VerificationProviderEnvironment;
  readonly runtime: ProviderRuntimeContext<TConfig>;
  validateConfiguration(): void;
  createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult>;
  resumeAttempt(command: ProviderResumeCommand): Promise<ProviderLaunchEnvelope>;
  retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot>;
  retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult>;
  cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult>;
  redactSubject(command: ProviderRedactionCommand): Promise<ProviderRedactionResult>;
  verifyWebhook(input: Request): Promise<VerifiedWebhookEnvelope>;
  normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent>;
}

export interface ActorContext {
  tenantKey: string;
  actorId: string;
  actorType: 'user' | 'operator' | 'system';
  roles: string[];
  authorizedSubjectScope: string[];
}

export interface ProtectedActionDenial {
  code: 'VERIFICATION_REQUIRED';
  action: string;
  resourceHash: string;
  requiredPackages: VerificationPackageCode[];
  continuation: {
    key: string;
    token: string;
    expiresAt: string;
  };
  retryAfter: string | null;
  supportPath: string | null;
}

export interface SafeProviderFailureEnvelope {
  code: ProviderErrorCode;
  safeCode: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  supportPath?: string | null;
}
