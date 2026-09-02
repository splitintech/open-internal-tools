import type {
  NormalizedProviderSnapshot,
  ProviderAttemptCommand,
  ProviderAttemptResult,
  ProviderLaunchEnvelope,
  ProviderManifestV1,
  ProviderRedactionCommand,
  ProviderResourceCommand,
  ProviderRetryCommand,
  VerificationAdapterV1,
  VerificationCanonicalStatus,
  WebhookProtocolId,
} from '@splitin/verification-adapter-sdk';

/** Internal SplitIn V2 contract version. Public V1 remains 1.0.0. */
export const SPLITIN_V2_CONTRACT_VERSION = '2.0.0' as const;

export const V1_PROTECTED_ACTION_CODE = 'VERIFICATION_REQUIRED' as const;
export const V2_PROTECTED_ACTION_CONTRACT = 'splitin.verification.required.v2' as const;

export const METHOD_MAP = {
  requestRetry: 'retryAttempt',
  retryAttempt: 'requestRetry',
  reconcileAttempt: 'engineOwned',
  retrieveAttempt: 'retrieveAttempt',
} as const;

export const LAUNCH_ALIAS_MAP = {
  inquiryOrSessionId: 'continuationReference',
  environmentId: 'runtimeEnvironment',
  opaqueLaunchSecret: 'transientSecret',
  transientSecret: 'opaqueLaunchSecret',
  continuationReference: 'inquiryOrSessionId',
} as const;

export const WEBHOOK_PROTOCOL_MAP: Record<string, string> = {
  stripe_v1_hmac: 'stripe_v1_hmac',
  persona_hmac_sha256: 'persona_hmac_sha256',
  plaid_es256_jwk: 'plaid_es256_jwk',
  none: 'none',
};

export const PACKAGE_CODE_MAP: Record<string, string> = {
  human_idv: 'human_idv',
  business_kyb: 'business_kyb',
  associated_person_idv: 'associated_person_idv',
  ownership_review: 'ownership_review',
};

export type SplitInV2CanonicalStatus = Exclude<VerificationCanonicalStatus, 'redacted'>;

export function mapStatusV1ToV2(status: VerificationCanonicalStatus): SplitInV2CanonicalStatus {
  if (status === 'redacted') return 'canceled';
  return status;
}

export function mapStatusV2ToV1(status: SplitInV2CanonicalStatus, redacted = false): VerificationCanonicalStatus {
  return redacted ? 'redacted' : status;
}

export function mapWebhookProtocolV1ToV2(protocol: WebhookProtocolId): string {
  return WEBHOOK_PROTOCOL_MAP[protocol] ?? protocol;
}

export function mapWebhookProtocolV2ToV1(authentication: string): WebhookProtocolId {
  return (WEBHOOK_PROTOCOL_MAP[authentication] ?? authentication) as WebhookProtocolId;
}

export function toV2ProtectedActionContract(code: string): string {
  return code === V1_PROTECTED_ACTION_CODE ? V2_PROTECTED_ACTION_CONTRACT : code;
}

export function toV1ProtectedActionCode(contract: string): string {
  return contract === V2_PROTECTED_ACTION_CONTRACT ? V1_PROTECTED_ACTION_CODE : contract;
}

const SPLITIN_META = /^splitin_/;

export function metadataV2ToV1(metadata: Record<string, string | number | boolean | null> | undefined): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (key === 'splitin_attempt_id') {
      output.attempt_id = value;
      continue;
    }
    if (SPLITIN_META.test(key)) {
      output[key.replace(SPLITIN_META, '')] = value;
      continue;
    }
    output[key] = value;
  }
  return output;
}

export function metadataV1ToV2(
  metadata: Record<string, string | number | boolean | null> | undefined,
  attemptId?: string,
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = { ...(metadata ?? {}) };
  const opaqueAttempt = metadata?.attempt_id ?? attemptId ?? null;
  if (opaqueAttempt != null) output.splitin_attempt_id = opaqueAttempt;
  return output;
}

export interface SplitInV2LaunchEnvelope {
  presentation: ProviderLaunchEnvelope['presentation'];
  launcherKey: string;
  adapter?: string;
  inquiryOrSessionId?: string;
  environmentId?: string;
  transientSecret?: string;
  transientSecretExpiresAt?: string;
  opaqueLaunchSecret?: string;
  hostedUrl?: string;
  hostedFallbackExpiresAt?: string;
  expiresAt?: string;
  providerDisclosure?: string;
}

export function launchV1ToV2(launch: ProviderLaunchEnvelope, environment?: string): SplitInV2LaunchEnvelope {
  return {
    presentation: launch.presentation,
    launcherKey: launch.launcherKey,
    adapter: launch.launcherKey,
    inquiryOrSessionId: launch.continuationReference,
    environmentId: environment,
    transientSecret: launch.transientSecret,
    transientSecretExpiresAt: launch.transientSecretExpiresAt,
    opaqueLaunchSecret: launch.transientSecret,
    hostedUrl: launch.hostedUrl,
    hostedFallbackExpiresAt: launch.hostedFallbackExpiresAt,
    expiresAt: launch.transientSecretExpiresAt ?? launch.hostedFallbackExpiresAt,
    providerDisclosure: launch.providerDisclosure,
  };
}

export function launchV2ToV1(launch: SplitInV2LaunchEnvelope, attemptId: string): ProviderLaunchEnvelope {
  return {
    attemptId,
    canonicalStatus: 'pending_user_input',
    launcherKey: launch.launcherKey,
    presentation: launch.presentation,
    providerDisclosure: launch.providerDisclosure,
    transientSecret: launch.transientSecret ?? launch.opaqueLaunchSecret,
    transientSecretExpiresAt: launch.transientSecretExpiresAt ?? launch.expiresAt,
    hostedUrl: launch.hostedUrl,
    hostedFallbackExpiresAt: launch.hostedFallbackExpiresAt,
    continuationReference: launch.inquiryOrSessionId,
  };
}

export interface SplitInV2AttemptCommand {
  attemptId: string;
  humanSubjectReference: string;
  subjectReference?: string;
  packageCode: string;
  idempotencyKey: string;
  providerConfigReference: string;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  email?: string | null;
  requestOrigin?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export function attemptCommandV2ToV1(command: SplitInV2AttemptCommand, countryCode = 'US'): ProviderAttemptCommand {
  return {
    attemptId: command.attemptId,
    subjectReference: command.subjectReference ?? command.humanSubjectReference,
    packageCode: command.packageCode,
    countryCode,
    idempotencyKey: command.idempotencyKey,
    configurationRevision: command.providerConfigReference,
    legalFirstName: command.legalFirstName,
    legalLastName: command.legalLastName,
    email: command.email,
    requestOrigin: command.requestOrigin,
    metadata: metadataV2ToV1(command.metadata),
  };
}

export function attemptCommandV1ToV2(command: ProviderAttemptCommand): SplitInV2AttemptCommand {
  return {
    attemptId: command.attemptId,
    humanSubjectReference: command.subjectReference,
    subjectReference: command.subjectReference,
    packageCode: command.packageCode,
    idempotencyKey: command.idempotencyKey,
    providerConfigReference: command.configurationRevision,
    legalFirstName: command.legalFirstName,
    legalLastName: command.legalLastName,
    email: command.email,
    requestOrigin: command.requestOrigin,
    metadata: metadataV1ToV2(command.metadata, command.attemptId),
  };
}

export interface SplitInV2AdapterSurface {
  requestRetry(command: ProviderRetryCommand): Promise<ProviderAttemptResult>;
  reconcileAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot>;
  retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot>;
}

/**
 * Wrap a public V1 adapter so a V2-shaped engine can call requestRetry /
 * reconcileAttempt. Reconciliation remains engine-owned: this wrapper delegates
 * reconcileAttempt to retrieveAttempt and never asks the adapter to persist.
 */
export function wrapV1AdapterForSplitInV2(adapter: VerificationAdapterV1): SplitInV2AdapterSurface {
  return {
    requestRetry: (command) => adapter.retryAttempt(command),
    retrieveAttempt: (command) => adapter.retrieveAttempt(command),
    reconcileAttempt: async (command) => {
      const snapshot = await adapter.retrieveAttempt(command);
      return {
        ...snapshot,
        canonicalStatus: mapStatusV1ToV2(snapshot.canonicalStatus),
        safeMetadata: metadataV1ToV2(snapshot.safeMetadata, command.attemptId),
      };
    },
  };
}

export function mapManifestWebhookV1ToV2(manifest: ProviderManifestV1): {
  authentication: string;
  eventTypes: string[];
  toleranceSeconds?: number;
} {
  return {
    authentication: mapWebhookProtocolV1ToV2(manifest.webhook.protocol),
    eventTypes: manifest.webhook.eventFamilies,
    toleranceSeconds: manifest.webhook.toleranceSeconds,
  };
}

export function mapRedactionCommandV2ToV1(command: {
  subjectReference: string;
  providerResourceId?: string | null;
  providerResourceType?: string;
  requestReference: string;
}): ProviderRedactionCommand {
  return {
    subjectReference: command.subjectReference,
    providerResourceId: command.providerResourceId,
    providerResourceType: command.providerResourceType,
    requestReference: command.requestReference,
  };
}
