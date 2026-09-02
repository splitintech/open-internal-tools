import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.80.0';
import { getStripeIdentityRuntimeAttestation, resolveProviderAdapter } from './providerRegistry.ts';
import {
  claimProviderRateBudget,
  createProviderObservationRecorder,
  getAttemptObservabilityContext,
  recordLoadRequestObservation,
  type LoadObservationContext,
} from './observability.ts';
import {
  ProviderOperationPendingError,
  ProviderUnavailableError,
  VerificationAttemptLimitError,
  type ProviderLaunchResult,
} from './contracts.ts';

export type SessionPackageCode = 'human_idv' | 'ownership_review' | 'business_kyb' | 'associated_person_idv';

export interface StartSessionCommand {
  userId: string;
  packageCode: SessionPackageCode;
  subjectSelector?: string | null;
  actionCode: string;
  resourceType: string;
  /** Never persisted; hashed before the database boundary. */
  resourceReference?: string;
  /** Used only for server-owned retry context after the raw reference is discarded. */
  resourceHash?: string;
  idempotencyKey: string;
  parentAttemptId?: string;
  reviewMode?: 'standard' | 'document_only_manual_review';
  sourceAppealId?: string;
}

const UUID_REFERENCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PreparedAttempt {
  attempt_id: string;
  attempt_status: string;
  is_new_attempt: boolean;
  provider: string;
  provider_environment: 'sandbox' | 'production';
  provider_resource_id: string | null;
  adapter_version: string;
  provider_config_reference: string;
  provider_template_reference: string | null;
  human_subject_reference: string;
  idempotency_key: string;
  expires_at: string | null;
}

interface ProviderLaunchContext {
  subject_reference: string;
  legal_first_name: string | null;
  legal_last_name: string | null;
  email: string | null;
  business_legal_name: string | null;
  business_tax_identification_number: string | null;
  business_registered_address: Record<string, unknown> | null;
  business_physical_address: Record<string, unknown> | null;
  business_jurisdiction_country_code: string | null;
  business_entity_type: string | null;
  approved_document_ids: string[];
  relationship_reference: string | null;
  relationship_kind: 'ubo' | 'director' | 'officer' | 'authorized_representative' | 'property_owner' | 'associated_person' | null;
  claimed_ownership_percentage: number | null;
}

interface ProviderCreateClaim {
  disposition: 'claimed' | 'bound' | 'in_progress';
  claim_id: string | null;
  provider_resource_id: string | null;
}

interface StripeSessionQuotaClaim {
  allowed: boolean;
  retry_after_seconds: number;
}

interface ResumableRuntimeAttempt {
  attempt_id: string;
  provider: string;
  provider_resource_id: string | null;
}

export interface SafeVerificationSession {
  contractVersion: '2.0.0';
  attemptId: string;
  packageCode: SessionPackageCode;
  status: string;
  presentation: 'embedded' | 'hosted' | 'qr' | 'none';
  launch: {
    launcherKey: string;
    /** @deprecated Present only for rolling V1 clients. */
    adapter?: string;
    inquiryOrSessionId?: string;
    environmentId?: string;
    ephemeralToken?: string;
    transientSecretExpiresAt?: string;
    hostedUrl?: string;
    hostedFallbackExpiresAt?: string;
    expiresAt?: string;
    providerDisclosure?: string;
  } | null;
  launcherKey: string | null;
  providerDisclosure: string | null;
  safeErrorCode: string | null;
  retryAfter: number | null;
  supportPath: '/support/verification';
  expiresAt: string | null;
  canResume: boolean;
  canRetry: boolean;
}

export interface ServerAttempt {
  attempt_id: string;
  status: string;
  package_code: SessionPackageCode;
  provider: string;
  provider_environment: 'sandbox' | 'production';
  provider_resource_id: string | null;
  adapter_version: string;
  provider_config_reference: string;
  provider_template_reference: string | null;
  human_subject_reference: string;
  purpose_action_code: string;
  purpose_resource_type: string;
  purpose_resource_hash: string;
  idempotency_key: string;
  expires_at: string | null;
}

export async function startOrResumeVerification(
  client: SupabaseClient,
  command: StartSessionCommand,
  runtime: {
    environment: string | undefined;
    enableFakeProvider: boolean;
    routerEnabled?: boolean;
    stripeIdentityEnabled?: boolean;
    requestOrigin?: string | null;
    loadObservation?: LoadObservationContext | null;
  },
): Promise<SafeVerificationSession> {
  const orchestrationStartedAt = performance.now();
  let routeSelectionMs = 0;
  let providerIoMs = 0;
  const measureProviderIo = async <T>(operation: () => Promise<T>): Promise<T> => {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      providerIoMs += performance.now() - startedAt;
    }
  };
  if (!runtime.routerEnabled) {
    throw new ProviderUnavailableError('The verification router is disabled in this runtime.');
  }
  const resourceHash = command.resourceHash
    ?? await sha256Hex(`${command.resourceType}:${command.resourceReference ?? ''}`);
  if (!/^[a-f0-9]{64}$/.test(resourceHash)) {
    throw new Error('Invalid server verification resource context.');
  }
  if (command.packageCode === 'human_idv' && !runtime.stripeIdentityEnabled) {
    const { data, error } = await client.rpc('verification_find_resumable_attempt_for_runtime', {
      p_user_id: command.userId,
      p_package_code: command.packageCode,
      p_idempotency_key: command.idempotencyKey,
    });
    if (error) throw mapRpcError(error);
    const resumable = (Array.isArray(data) ? data[0] : data) as ResumableRuntimeAttempt | null;
    // A drain may resume a provider-bound attempt (including a pinned legacy
    // Persona/Plaid attempt), but it must never create either a neutral attempt
    // or a new Stripe resource while the deployment key is off.
    if (!resumable || (resumable.provider === 'stripe_identity' && !resumable.provider_resource_id)) {
      throw new ProviderUnavailableError('Stripe Identity is disabled in this runtime.', {
        retryable: true,
        safeCode: 'stripe_identity_disabled',
      });
    }
  }
  // The database activation key is enforced inside the attempt-route insert
  // transaction by verification_attempt_route_v2_guard. Keeping it there
  // avoids a check-then-create race; this runtime flag remains the independent
  // deployment key.
  const routeSelectionStartedAt = performance.now();
  const prepared = await rpcSingle<PreparedAttempt>(client, 'verification_prepare_or_resume_attempt', {
    p_user_id: command.userId,
    p_package_code: command.packageCode,
    p_provider_environment: serverProviderEnvironment(runtime.environment),
    p_action_code: command.actionCode,
    p_resource_type: command.resourceType,
    // The validated UUID is used transiently for server-owned relationship and
    // location resolution. Attempts continue to persist only resourceHash.
    p_resource_id: command.resourceReference && UUID_REFERENCE_PATTERN.test(command.resourceReference)
      ? command.resourceReference
      : null,
    p_subject_selector: command.subjectSelector ?? null,
    p_resource_hash: resourceHash,
    p_idempotency_key: command.idempotencyKey,
    p_parent_attempt_id: command.parentAttemptId ?? null,
  });
  routeSelectionMs = performance.now() - routeSelectionStartedAt;

  if (command.reviewMode === 'document_only_manual_review') {
    if (!command.sourceAppealId || prepared.provider !== 'stripe_identity') {
      throw new ProviderUnavailableError('The approved non-biometric review context is invalid.');
    }
    await rpcVoid(client, 'verification_authorize_non_biometric_attempt', {
      p_user_id: command.userId,
      p_attempt_id: prepared.attempt_id,
      p_appeal_id: command.sourceAppealId,
    });
  }

  // The provider-specific deployment key blocks new Stripe resources while
  // allowing already-started attempts to resume and receive webhook/reconcile
  // updates during an emergency drain.
  if (prepared.provider === 'stripe_identity'
    && !prepared.provider_resource_id
    && !runtime.stripeIdentityEnabled) {
    throw new ProviderUnavailableError('Stripe Identity is disabled in this runtime.', {
      retryable: true,
      safeCode: 'stripe_identity_disabled',
    });
  }

  if (prepared.provider === 'stripe_identity') {
    await attestPinnedProviderRuntime(client, prepared.attempt_id, prepared.provider);
  }

  const finalize = async (session: SafeVerificationSession): Promise<SafeVerificationSession> => {
    if (runtime.loadObservation) {
      const requestDigest = await sha256Hex([
        runtime.loadObservation.runId,
        runtime.loadObservation.sequence,
        command.idempotencyKey,
      ].join(':'));
      await recordLoadRequestObservation(
        client,
        runtime.loadObservation,
        requestDigest,
        routeSelectionMs,
        Math.max(0, performance.now() - orchestrationStartedAt - providerIoMs),
      ).catch(() => undefined);
    }
    return session;
  };

  const observationContext = await getAttemptObservabilityContext(client, prepared.attempt_id);
  if (observationContext.provider !== prepared.provider
    || observationContext.provider_environment !== prepared.provider_environment) {
    throw new ProviderUnavailableError('The provider runtime does not match the pinned attempt.');
  }
  const adapter = resolveProviderAdapter(prepared.provider, {
    ...runtime,
    providerEnvironment: prepared.provider_environment,
    runtime: {
      recordHealth: createProviderObservationRecorder(client, observationContext),
    },
  });
  const providerContext = await rpcSingle<ProviderLaunchContext>(client, 'verification_get_provider_launch_context', {
    p_attempt_id: prepared.attempt_id,
  });
  let launch: ProviderLaunchResult;
  if (prepared.provider_resource_id) {
    const providerResourceId = prepared.provider_resource_id;
    await claimProviderRateBudget(client, observationContext, 'create_resume');
    launch = await measureProviderIo(() => adapter.resumeAttempt({
      attemptId: prepared.attempt_id,
      providerResourceId,
      providerConfigReference: prepared.provider_config_reference,
      requestOrigin: runtime.requestOrigin,
    }));
  } else {
    if (prepared.provider === 'stripe_identity') {
      const quota = await rpcSingle<StripeSessionQuotaClaim>(
        client,
        'verification_claim_stripe_session_quota',
        { p_attempt_id: prepared.attempt_id },
      );
      if (!quota.allowed) {
        await rpcVoid(client, 'verification_record_session_limit_rejection', {
          p_attempt_id: prepared.attempt_id,
        }).catch(() => undefined);
        throw new VerificationAttemptLimitError(Math.max(1, quota.retry_after_seconds));
      }
    }
    const claim = await rpcSingle<ProviderCreateClaim>(client, 'verification_claim_provider_create', {
      p_attempt_id: prepared.attempt_id,
      p_lease_seconds: 30,
    });
    if (claim.disposition === 'in_progress') {
      throw new ProviderOperationPendingError();
    }
    if (claim.disposition === 'bound' && claim.provider_resource_id) {
      const providerResourceId = claim.provider_resource_id;
      prepared.provider_resource_id = providerResourceId;
      await claimProviderRateBudget(client, observationContext, 'create_resume');
      launch = await measureProviderIo(() => adapter.resumeAttempt({
        attemptId: prepared.attempt_id,
        providerResourceId,
        providerConfigReference: prepared.provider_config_reference,
        requestOrigin: runtime.requestOrigin,
      }));
      prepared.attempt_status = launch.presentation === 'none' ? 'processing' : 'pending_user_input';
      return finalize(toSafeSession(prepared, launch, command.packageCode));
    }
    if (claim.disposition !== 'claimed' || !claim.claim_id) {
      throw new ProviderUnavailableError('The provider create claim was invalid.');
    }
    try {
      await claimProviderRateBudget(client, observationContext, 'create_resume');
      const parent = command.parentAttemptId
        ? await getAttemptForUser(client, command.userId, command.parentAttemptId)
        : null;
      const created = command.parentAttemptId
        ? await measureProviderIo(() => adapter.requestRetry({
          attemptId: prepared.attempt_id,
          humanSubjectReference: prepared.human_subject_reference,
          subjectReference: providerContext.subject_reference,
          packageCode: command.packageCode,
          idempotencyKey: prepared.idempotency_key,
          providerConfigReference: prepared.provider_config_reference,
          providerTemplateReference: prepared.provider_template_reference,
          previousProviderResourceId: parent?.provider === prepared.provider
            ? parent.provider_resource_id
            : null,
          legalFirstName: providerContext.legal_first_name,
          legalLastName: providerContext.legal_last_name,
          email: providerContext.email,
          business: businessInput(providerContext, prepared.human_subject_reference),
          relationship: relationshipInput(providerContext, prepared.human_subject_reference),
          requestOrigin: runtime.requestOrigin,
          reviewMode: command.reviewMode ?? 'standard',
        }))
        : await measureProviderIo(() => adapter.createAttempt({
          attemptId: prepared.attempt_id,
          humanSubjectReference: prepared.human_subject_reference,
          subjectReference: providerContext.subject_reference,
          packageCode: command.packageCode,
          idempotencyKey: prepared.idempotency_key,
          providerConfigReference: prepared.provider_config_reference,
          providerTemplateReference: prepared.provider_template_reference,
          legalFirstName: providerContext.legal_first_name,
          legalLastName: providerContext.legal_last_name,
          email: providerContext.email,
          business: businessInput(providerContext, prepared.human_subject_reference),
          relationship: relationshipInput(providerContext, prepared.human_subject_reference),
          requestOrigin: runtime.requestOrigin,
          reviewMode: command.reviewMode ?? 'standard',
        }));
      launch = created.launch;
      await rpcSingle(client, 'verification_bind_claimed_provider_attempt', {
        p_attempt_id: prepared.attempt_id,
        p_claim_id: claim.claim_id,
        p_provider_resource_id: created.providerResourceId,
        p_provider_status: created.providerStatus,
        p_expires_at: launch.expiresAt ?? null,
      });
      if (prepared.provider === 'persona' && created.providerAccountId) {
        await rpcVoid(client, 'verification_bind_persona_provider_account', {
          p_attempt_id: prepared.attempt_id,
          p_provider_account_id: created.providerAccountId,
        });
      }
      if (prepared.provider === 'persona' && created.linkedResources?.length) {
        for (const resource of created.linkedResources) {
          await rpcVoid(client, 'verification_upsert_persona_provider_object', {
            p_attempt_id: prepared.attempt_id,
            p_object_type: resource.resourceType,
            p_provider_object_id: resource.resourceId,
            p_normalized_status: safeProviderStatus(resource.providerStatus),
            p_relationship_code: resource.relationshipCode,
            p_provider_occurred_at: resource.occurredAt,
            p_redacted: false,
          });
          if (resource.resourceType === 'case') {
            await rpcVoid(client, 'verification_upsert_persona_review_case', {
              p_attempt_id: prepared.attempt_id,
              p_provider_case_id: resource.resourceId,
              p_status: safeProviderStatus(resource.providerStatus),
              p_resolution: null,
              p_provider_occurred_at: resource.occurredAt,
              p_redacted: false,
            });
          }
        }
        if (command.packageCode === 'business_kyb') {
          await rpcVoid(client, 'verification_mark_persona_kyb_discovery', {
            p_business_attempt_id: prepared.attempt_id,
            p_complete: false,
          });
        }
      }
      if (prepared.provider === 'plaid') {
        await rpcVoid(client, 'verification_sync_plaid_legacy_compatibility', {
          p_attempt_id: prepared.attempt_id,
        });
      }
      prepared.attempt_status = launch.presentation === 'none' ? 'processing' : 'pending_user_input';
      prepared.provider_resource_id = created.providerResourceId;
      prepared.expires_at = launch.expiresAt ?? prepared.expires_at;
    } catch (error) {
      await safeRecordCreateFailure(client, prepared.attempt_id, claim.claim_id);
      if (prepared.provider === 'stripe_identity') {
        await rpcVoid(client, 'verification_release_stripe_session_quota', {
          p_attempt_id: prepared.attempt_id,
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  return finalize(toSafeSession(prepared, launch, command.packageCode));
}

function businessInput(context: ProviderLaunchContext, humanSubjectReference: string) {
  if (!context.business_legal_name || !context.business_tax_identification_number
    || !context.business_registered_address || !context.business_jurisdiction_country_code) return null;
  const relationship = relationshipInput(context, humanSubjectReference);
  const associatedPeople = relationship && context.legal_first_name && context.legal_last_name
    ? [{
      accountReferenceId: humanSubjectReference,
      legalFirstName: context.legal_first_name,
      legalLastName: context.legal_last_name,
      email: context.email,
      relationshipKind: relationship.kind,
      claimedOwnershipPercentage: relationship.claimedOwnershipPercentage,
    }].filter((person) => person.accountReferenceId) : [];
  return {
    legalName: context.business_legal_name,
    taxIdentificationNumber: context.business_tax_identification_number,
    registeredAddress: addressInput(context.business_registered_address),
    physicalAddress: context.business_physical_address ? addressInput(context.business_physical_address) : null,
    jurisdictionCountryCode: context.business_jurisdiction_country_code,
    entityType: context.business_entity_type,
    approvedDocumentIds: context.approved_document_ids ?? [],
    associatedPeople,
  };
}

function relationshipInput(context: ProviderLaunchContext, humanReference: string) {
  if (!context.relationship_reference || !context.relationship_kind) return null;
  return {
    relationshipReference: context.relationship_reference,
    kind: context.relationship_kind,
    claimedOwnershipPercentage: context.claimed_ownership_percentage,
    accountReferenceId: humanReference,
  };
}

function addressInput(value: Record<string, unknown>) {
  return {
    street1: String(value.street1 ?? ''),
    street2: typeof value.street2 === 'string' ? value.street2 : null,
    city: String(value.city ?? ''),
    subdivision: typeof value.subdivision === 'string' ? value.subdivision : null,
    postalCode: String(value.postalCode ?? ''),
    countryCode: String(value.countryCode ?? ''),
  };
}

function safeProviderStatus(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'unknown';
}

export async function getAttemptForUser(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<ServerAttempt> {
  const result = await rpcSingle<ServerAttempt>(client, 'verification_get_attempt_for_user', {
    p_user_id: userId,
    p_attempt_id: attemptId,
  });
  return result;
}

export async function cancelVerification(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
  runtime: { environment: string | undefined; enableFakeProvider: boolean },
): Promise<{ canceled: boolean; status: string }> {
  const attempt = await getAttemptForUser(client, userId, attemptId);
  if (attempt.provider_resource_id) {
    const observationContext = await getAttemptObservabilityContext(client, attempt.attempt_id);
    if (observationContext.provider !== attempt.provider
      || observationContext.provider_environment !== attempt.provider_environment) {
      throw new ProviderUnavailableError('The provider runtime does not match the pinned attempt.');
    }
    await attestPinnedProviderRuntime(client, attempt.attempt_id, attempt.provider);
    const adapter = resolveProviderAdapter(attempt.provider, {
      ...runtime,
      providerEnvironment: attempt.provider_environment,
      runtime: {
        recordHealth: createProviderObservationRecorder(client, observationContext),
      },
    });
    await claimProviderRateBudget(client, observationContext, 'status_reconcile');
    const operation = await adapter.cancelAttempt({
      attemptId: attempt.attempt_id,
      providerResourceId: attempt.provider_resource_id,
      providerConfigReference: attempt.provider_config_reference,
    });
    if (!operation.accepted) {
      throw new ProviderUnavailableError('The provider did not accept cancellation.');
    }
    const canceled = await rpcSingle<boolean>(client, 'verification_cancel_attempt_for_user', {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_provider_status: operation.providerStatus ?? null,
    });
    return { canceled, status: canceled ? 'canceled' : attempt.status };
  }

  const canceled = await rpcSingle<boolean>(client, 'verification_cancel_attempt_for_user', {
    p_user_id: userId,
    p_attempt_id: attemptId,
    p_provider_status: null,
  });
  return { canceled, status: canceled ? 'canceled' : attempt.status };
}

export async function rpcSingle<T>(client: SupabaseClient, functionName: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw mapRpcError(error);
  const value = Array.isArray(data) ? data[0] : data;
  if (value === null || value === undefined) {
    throw new Error(`Verification RPC ${functionName} returned no data.`);
  }
  return value as T;
}

export async function rpcVoid(client: SupabaseClient, functionName: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await client.rpc(functionName, args);
  if (error) throw mapRpcError(error);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function attestPinnedProviderRuntime(
  client: SupabaseClient,
  attemptId: string,
  provider: string,
): Promise<void> {
  if (provider !== 'stripe_identity') return;
  const attestation = getStripeIdentityRuntimeAttestation();
  const attested = await rpcSingle<boolean>(client, 'verification_attest_stripe_runtime', {
    p_attempt_id: attemptId,
    p_provider_environment: attestation.providerEnvironment,
    p_api_version: attestation.apiVersion,
    p_configuration_reference: attestation.configurationReference,
    p_return_origin: attestation.returnOrigin,
    p_account_reference_hash: await sha256Hex(attestation.accountId),
    p_manifest_digest: attestation.manifestDigest,
  });
  if (!attested) {
    throw new ProviderUnavailableError('Stripe Identity configuration is not approved.');
  }
}

function toSafeSession(
  prepared: PreparedAttempt,
  launch: ProviderLaunchResult,
  packageCode: SessionPackageCode,
): SafeVerificationSession {
  const terminal = new Set(['verified', 'declined', 'failed', 'expired', 'canceled', 'provider_unavailable']);
  const safeStatus = safeAttemptStatus(prepared.attempt_status);
  return {
    contractVersion: '2.0.0',
    attemptId: prepared.attempt_id,
    packageCode,
    status: prepared.attempt_status,
    presentation: launch.presentation,
    launch: launch.launcherKey || launch.transientSecret || launch.opaqueLaunchSecret || launch.hostedUrl || launch.expiresAt
      || launch.inquiryOrSessionId || launch.environmentId || launch.providerDisclosure
      ? {
        launcherKey: launch.launcherKey,
        adapter: launch.adapter,
        inquiryOrSessionId: launch.inquiryOrSessionId,
        environmentId: launch.environmentId,
        ephemeralToken: launch.transientSecret ?? launch.opaqueLaunchSecret,
        transientSecretExpiresAt: launch.transientSecretExpiresAt,
        hostedUrl: launch.hostedUrl,
        hostedFallbackExpiresAt: launch.hostedFallbackExpiresAt,
        expiresAt: launch.expiresAt,
        providerDisclosure: launch.providerDisclosure,
      }
      : null,
    launcherKey: launch.launcherKey ?? null,
    providerDisclosure: launch.providerDisclosure ?? null,
    safeErrorCode: safeStatus.code,
    retryAfter: safeStatus.retryAfter,
    supportPath: '/support/verification',
    expiresAt: prepared.expires_at ?? launch.expiresAt ?? null,
    canResume: !terminal.has(prepared.attempt_status),
    canRetry: ['declined', 'failed', 'expired', 'canceled', 'provider_unavailable'].includes(prepared.attempt_status),
  };
}

function safeAttemptStatus(status: string): { code: string | null; retryAfter: number | null } {
  switch (status) {
    case 'processing':
      return { code: 'VERIFICATION_PROCESSING', retryAfter: 15 };
    case 'manual_review_required':
      return { code: 'VERIFICATION_MANUAL_REVIEW', retryAfter: null };
    case 'canceled':
      return { code: 'VERIFICATION_CANCELED', retryAfter: null };
    case 'provider_unavailable':
      return { code: 'VERIFICATION_PROVIDER_UNAVAILABLE', retryAfter: 30 };
    default:
      return { code: null, retryAfter: null };
  }
}

function mapRpcError(error: { message?: string }): Error {
  const message = error.message ?? 'Verification database operation failed.';
  if (message.includes('VERIFICATION_PROVIDER_UNAVAILABLE') || message.includes('VERIFICATION_ROUTER_DISABLED')) {
    return new ProviderUnavailableError();
  }
  if (message.includes('STRIPE_IDENTITY_RUNTIME_CONFIGURATION_MISMATCH')) {
    return new ProviderUnavailableError('Stripe Identity runtime configuration does not match the approved revision.', {
      retryable: false,
      safeCode: 'provider_configuration_invalid',
    });
  }
  return new Error(message);
}

function serverProviderEnvironment(environment: string | undefined): 'sandbox' | 'production' {
  return environment === 'production' ? 'production' : 'sandbox';
}

async function safeRecordCreateFailure(client: SupabaseClient, attemptId: string, claimId: string): Promise<void> {
  try {
    await rpcVoid(client, 'verification_fail_claimed_provider_create', {
      p_attempt_id: attemptId,
      p_claim_id: claimId,
      p_error_code: 'PROVIDER_CREATE_FAILED',
    });
  } catch {
    // A request may time out after the durable row is written. Never mask the
    // original provider failure or leak details by throwing a logging failure.
  }
}
