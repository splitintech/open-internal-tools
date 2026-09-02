import {
  PlaidVerificationKeyCache,
  PlaidWebhookVerificationError,
  type PlaidVerificationJwk,
} from '../plaid-webhook-key-cache.ts';
import { sha256Hex } from '../plaid-webhook-crypto.ts';
import {
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  ProviderError,
  ProviderUnavailableError,
  plaidProviderManifest,
  type NormalizedProviderEvent,
  type NormalizedProviderSnapshot,
  type ProviderAttemptCommand,
  type ProviderAttemptResult,
  type ProviderCapabilities,
  type ProviderLaunchResult,
  type ProviderOperation,
  type ProviderOperationResult,
  type ProviderRedactionCommand,
  type ProviderRedactionResult,
  type ProviderResourceCommand,
  type ProviderRetryCommand,
  type ProviderRuntimeContext,
  type ProviderSafeLogger,
  type VerificationCanonicalStatus,
  type VerificationProviderAdapter,
  type VerifiedWebhookEnvelope,
} from './contracts.ts';

export interface PlaidLegacyAdapterConfiguration {
  clientId: string;
  secret: string;
  templateId: string;
  /** Server-owned route pin. Defaults to the reviewed legacy revision. */
  configReference?: string;
  webhookUrl?: string;
  verificationKeyCache?: PlaidVerificationKeyCache;
}

export type PlaidLegacyProviderRuntimeContext = ProviderRuntimeContext<PlaidLegacyAdapterConfiguration>;

/** @deprecated Direct-constructor bridge for V1 tests. Production uses ProviderRuntimeContext. */
export interface PlaidLegacyAdapterConfig extends PlaidLegacyAdapterConfiguration {
  environment: 'sandbox' | 'production';
  fetch?: typeof fetch;
  now?: () => Date;
  idempotency?: PlaidLegacyProviderRuntimeContext['idempotency'];
  logger?: ProviderSafeLogger;
  recordHealth?: PlaidLegacyProviderRuntimeContext['recordHealth'];
}

export function createPlaidLegacyAdapterConfiguration(
  values: Readonly<Record<string, string | undefined>>,
  environment: 'sandbox' | 'production',
): PlaidLegacyAdapterConfiguration {
  const secret = environment === 'production'
    ? values.PLAID_PRODUCTION_SECRET ?? values.PLAID_SECRET
    : values.PLAID_SANDBOX_SECRET ?? values.PLAID_SECRET;
  const templateId = environment === 'production'
    ? values.PLAID_IDV_TEMPLATE_ID ?? values.PLAID_TEMPLATE_ID
    : values.PLAID_SANDBOX_TEMPLATE_ID ?? values.PLAID_IDV_TEMPLATE_ID ?? values.PLAID_TEMPLATE_ID;
  return Object.freeze({
    clientId: values.PLAID_CLIENT_ID ?? '',
    secret: secret ?? '',
    templateId: templateId ?? '',
    configReference: values.PLAID_CONFIG_REFERENCE ?? `plaid.legacy.${environment}.v1`,
    webhookUrl: values.PLAID_IDV_WEBHOOK_URL,
  });
}

interface PlaidIdentitySnapshot {
  id: string;
  client_user_id: string;
  status: string;
  created_at?: string;
  completed_at?: string | null;
  shareable_url?: string | null;
}

interface PlaidLegacyIdentitySnapshot extends PlaidIdentitySnapshot {
  identity_verification_id?: unknown;
  user?: { client_user_id?: unknown };
}

/**
 * Temporary Plaid Identity Verification adapter.
 *
 * Product code sees only the provider-neutral port. This leaf owns Plaid
 * request shapes, status strings, Link tokens, signed webhook verification,
 * and the exact legacy scope. It intentionally does not expose Monitor, Layer,
 * Auth, bank identity, or payout operations.
 */
export class PlaidLegacyVerificationAdapter implements VerificationProviderAdapter {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = plaidProviderManifest;
  readonly provider = 'plaid';
  readonly environment: 'sandbox' | 'production';
  private readonly runtime: PlaidLegacyProviderRuntimeContext;
  private readonly config: Readonly<PlaidLegacyAdapterConfiguration>;
  private readonly verificationKeyCache: PlaidVerificationKeyCache;

  constructor(runtime: PlaidLegacyProviderRuntimeContext | PlaidLegacyAdapterConfig) {
    this.runtime = isPlaidRuntimeContext(runtime) ? runtime : legacyPlaidRuntimeContext(runtime);
    this.config = this.runtime.configuration;
    if (!this.config.clientId || !this.config.secret || !this.config.templateId) {
      throw new ProviderUnavailableError('Plaid legacy verification is not configured.');
    }
    this.verificationKeyCache = this.config.verificationKeyCache ?? new PlaidVerificationKeyCache({
      now: () => this.runtime.now().getTime(),
    });
    this.environment = this.runtime.environment;
  }

  validateConfiguration(): void {
    if (!this.config.clientId || !this.config.secret || !this.config.templateId) {
      throw new ProviderUnavailableError('Plaid legacy verification is not configured.');
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      presentations: ['embedded', 'hosted'],
      canResume: true,
      canRetry: true,
      // Plaid IDV has no public cancel/redaction endpoint in the supported
      // legacy adapter scope. SplitIn can still terminally cancel its attempt.
      canCancel: true,
      canRedact: false,
    };
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertConfigReference(command.providerConfigReference);
    assertHumanReference(command.humanSubjectReference);
    this.requireIdempotencyKey('create', command.attemptId, command.idempotencyKey);
    const identity = await this.call<PlaidIdentitySnapshot>('create', '/identity_verification/create', {
      client_user_id: command.humanSubjectReference,
      template_id: this.config.templateId,
      is_shareable: true,
      gave_consent: false,
      is_idempotent: true,
    });
    return {
      providerResourceId: requiredProviderId(identity.id),
      providerStatus: requiredStatus(identity.status),
      launch: await this.createLaunch(command.humanSubjectReference, identity.shareable_url, 'create'),
    };
  }

  async resumeAttempt(command: ProviderResourceCommand): Promise<ProviderLaunchResult> {
    this.assertConfigReference(command.providerConfigReference);
    const identity = await this.getIdentity(command.providerResourceId, 'resume');
    assertHumanReference(identity.client_user_id);
    return this.createLaunch(identity.client_user_id, identity.shareable_url, 'resume');
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    this.assertConfigReference(command.providerConfigReference);
    const identity = await this.getIdentity(command.providerResourceId, 'retrieve');
    return this.normalizeSnapshot(identity);
  }

  async reconcileAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    this.assertConfigReference(command.providerConfigReference);
    const identity = await this.getIdentity(command.providerResourceId, 'reconcile');
    return this.normalizeSnapshot(identity);
  }

  /** Provider-operations fallback for list/get reconciliation. */
  async listSubjectAttempts(humanSubjectReference: string): Promise<NormalizedProviderSnapshot[]> {
    assertHumanReference(humanSubjectReference);
    const result = await this.call<{ identity_verifications?: unknown }>('retrieve', '/identity_verification/list', {
      client_user_id: humanSubjectReference,
      template_id: this.config.templateId,
    });
    if (!Array.isArray(result.identity_verifications)) {
      throw new ProviderUnavailableError('Plaid did not return a verification list.');
    }
    return result.identity_verifications.map((value) => {
      if (!value || typeof value !== 'object') {
        throw new ProviderUnavailableError('Plaid returned an invalid verification list.');
      }
      return this.normalizeSnapshot(value as PlaidIdentitySnapshot);
    });
  }

  /**
   * Compatibility leaf for the pre-neutral Link flow. Public-token semantics
   * remain Plaid-only and never enter VerificationProviderAdapter or browser
   * session responses. New neutral attempts do not use this operation.
   */
  async exchangeLegacyPublicToken(
    publicToken: string,
    expectedClientUserId: string,
  ): Promise<NormalizedProviderSnapshot> {
    if (!/^public-[A-Za-z0-9_-]{13,193}$/.test(publicToken)) {
      throw new ProviderUnavailableError('Plaid legacy launch material is invalid.');
    }
    if (!/^svh_[A-Z2-7]{26}$/.test(expectedClientUserId)
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedClientUserId)) {
      throw new ProviderUnavailableError('Plaid legacy subject reference is invalid.');
    }
    const created = await this.call<PlaidLegacyIdentitySnapshot>('create', '/identity_verification/create', {
      public_token: publicToken,
    });
    const providerResourceId = requiredProviderId(created.id ?? created.identity_verification_id);
    const current = await this.call<PlaidLegacyIdentitySnapshot>('retrieve', '/identity_verification/get', {
      identity_verification_id: providerResourceId,
    });
    const actualClientUserId = current.client_user_id ?? current.user?.client_user_id;
    if (actualClientUserId !== expectedClientUserId) {
      throw new ProviderUnavailableError('Plaid legacy verification ownership could not be confirmed.');
    }
    return this.normalizeSnapshot({
      ...current,
      id: providerResourceId,
      client_user_id: expectedClientUserId,
    });
  }

  async requestRetry(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    this.assertConfigReference(command.providerConfigReference);
    this.requireIdempotencyKey('retry', command.attemptId, command.idempotencyKey);
    if (!command.previousProviderResourceId) {
      // An approved rollback may route a new retry attempt from another
      // provider to Plaid. It is still a new, pinned attempt—not a mid-attempt
      // switch—and therefore uses Plaid's idempotent create operation.
      return this.createAttempt(command);
    }
    const previous = await this.getIdentity(command.previousProviderResourceId, 'retry');
    assertHumanReference(previous.client_user_id);
    if (previous.client_user_id !== command.humanSubjectReference) {
      throw new ProviderUnavailableError('The prior Plaid attempt does not match this subject.');
    }
    const normalized = normalizePlaidIdentityStatus(previous.status);
    if (normalized.status === 'pending_user_input' || normalized.status === 'created') {
      return {
        providerResourceId: requiredProviderId(previous.id),
        providerStatus: requiredStatus(previous.status),
        launch: await this.createLaunch(command.humanSubjectReference, previous.shareable_url, 'retry'),
      };
    }
    if (normalized.status === 'processing') {
      throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Plaid is still processing this attempt.', {
        retryable: true,
        retryAfterSeconds: 15,
        safeCode: 'plaid_attempt_processing',
      });
    }
    if (normalized.status === 'manual_review_required' || normalized.status === 'verified') {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Plaid review state cannot be retried.', {
        safeCode: normalized.status === 'verified'
          ? 'plaid_attempt_already_verified'
          : 'plaid_manual_review_pending',
      });
    }
    const identity = await this.call<PlaidIdentitySnapshot>('retry', '/identity_verification/retry', {
      client_user_id: command.humanSubjectReference,
      template_id: this.config.templateId,
      strategy: 'reset',
    });
    return {
      providerResourceId: requiredProviderId(identity.id),
      providerStatus: requiredStatus(identity.status),
      launch: await this.createLaunch(command.humanSubjectReference, identity.shareable_url, 'retry'),
    };
  }

  async cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    this.assertConfigReference(command.providerConfigReference);
    // Explicit SplitIn cancellation is authoritative for the neutral attempt.
    // A later Plaid delivery is retained as evidence but cannot revive it.
    return { accepted: true, providerStatus: 'splitin_canceled' };
  }

  async redactSubject(_command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    return { completed: false, retryable: false };
  }

  private assertConfigReference(value: string): void {
    const expected = this.config.configReference ?? `plaid.legacy.${this.environment}.v1`;
    if (value !== expected) {
      throw new ProviderUnavailableError('Plaid configuration does not match the pinned route.');
    }
  }

  async verifyWebhook(request: Request): Promise<VerifiedWebhookEnvelope> {
    // jose is loaded only on the public webhook path. This keeps unrelated
    // adapter operations compatible with CommonJS-based legacy test runners.
    const { verifyPlaidWebhook } = await import('../plaid-webhook-verification.ts');
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.byteLength === 0 || rawBody.byteLength > 1_048_576) {
      throw new PlaidWebhookVerificationError('INVALID_BODY_SIZE', 'Plaid webhook body size is invalid.');
    }
    const verified = await verifyPlaidWebhook({
      rawBody,
      verificationHeader: request.headers.get('Plaid-Verification'),
      getKey: async (keyId) => this.verificationKeyCache.get(
        keyId,
        async (uncachedKeyId) => this.getVerificationKey(uncachedKeyId),
      ),
      nowMs: this.runtime.now().getTime(),
    });
    return {
      providerEventKey: `plaid_${verified.bodySha256}`,
      receivedAt: this.runtime.now().toISOString(),
      bodySha256: verified.bodySha256,
      signatureIssuedAt: new Date(verified.issuedAt * 1000).toISOString(),
      // Transient only. Callers normalize then discard it before persistence.
      opaquePayload: rawBody,
    };
  }

  async normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    let webhook: Record<string, unknown>;
    try {
      webhook = JSON.parse(new TextDecoder().decode(input.opaquePayload)) as Record<string, unknown>;
    } catch {
      throw new ProviderUnavailableError('Plaid webhook JSON is invalid.');
    }
    const webhookType = requiredText(webhook.webhook_type, 'webhook_type');
    const webhookCode = requiredText(webhook.webhook_code, 'webhook_code');
    if (webhookType !== 'IDENTITY_VERIFICATION'
      || !['STATUS_UPDATED', 'STEP_UPDATED', 'RETRIED'].includes(webhookCode)) {
      throw new ProviderUnavailableError('Plaid webhook is outside the supported Identity Verification scope.');
    }
    const providerResourceId = requiredProviderId(webhook.identity_verification_id);
    const webhookEnvironment = requiredText(webhook.environment, 'environment');
    if (webhookEnvironment !== this.environment) {
      throw new ProviderUnavailableError('Plaid webhook environment does not match the configured adapter.');
    }
    const status = typeof webhook.status === 'string' ? normalizePlaidIdentityStatus(webhook.status) : null;
    const providerEventKey = `plaid_${await sha256Hex([
      this.environment,
      webhookType,
      webhookCode,
      providerResourceId,
      input.bodySha256,
    ].join(':'))}`;
    return {
      providerEventKey,
      providerResourceId,
      eventType: status ? `verification.provider_event.${status.status}` : 'verification.provider_event.processing',
      providerEventType: `${webhookType}.${webhookCode}`,
      canonicalStatus: status?.status,
      occurredAt: input.receivedAt,
      normalizedReasonCodes: status?.reasonCodes ?? ['plaid_webhook_requires_reconciliation'],
      safeMetadata: {
        adapter_version: this.manifest.adapterVersion,
        normalization_version: 'plaid-idv-v1',
        provider_event_category: webhookCode.toLowerCase(),
        provider_environment: this.environment,
      },
    };
  }

  private async getIdentity(providerResourceId: string, operation: ProviderOperation): Promise<PlaidIdentitySnapshot> {
    return this.call<PlaidIdentitySnapshot>(operation, '/identity_verification/get', {
      identity_verification_id: requiredProviderId(providerResourceId),
    });
  }

  private normalizeSnapshot(identity: PlaidIdentitySnapshot): NormalizedProviderSnapshot {
    const normalized = normalizePlaidIdentityStatus(identity.status);
    const unknownStatus = normalized.reasonCodes.includes('plaid_status_ambiguous');
    if (unknownStatus) {
      this.runtime.logger.error('verification_provider_status_unknown', {
        provider: 'plaid',
        environment: this.environment,
        safe_code: 'PLAID_STATUS_UNRECOGNIZED',
      });
    }
    return {
      providerResourceId: requiredProviderId(identity.id),
      providerStatus: requiredStatus(identity.status),
      canonicalStatus: normalized.status,
      occurredAt: safeDate(identity.completed_at ?? identity.created_at, this.runtime.now()),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        source: 'reconciliation',
        adapter_version: this.manifest.adapterVersion,
        normalization_version: 'plaid-idv-v1',
        ...(unknownStatus ? { unknown_reason: 'provider_status_not_allowlisted' } : {}),
      },
    };
  }

  private async createLaunch(
    clientUserId: string,
    shareableUrl: string | null | undefined,
    operation: ProviderOperation,
  ): Promise<ProviderLaunchResult> {
    const payload: Record<string, unknown> = {
      user: { client_user_id: clientUserId },
      client_name: 'SplitIn',
      products: ['identity_verification'],
      country_codes: ['US'],
      language: 'en',
      identity_verification: { template_id: this.config.templateId, gave_consent: false },
    };
    if (this.config.webhookUrl) payload.webhook = this.config.webhookUrl;
    const result = await this.call<{ link_token?: unknown; expiration?: unknown }>(operation, '/link/token/create', payload);
    if (typeof result.link_token !== 'string' || result.link_token.length < 8) {
      throw new ProviderUnavailableError('Plaid did not return launch material.');
    }
    return {
      presentation: 'embedded',
      launcherKey: 'plaid_link',
      adapter: 'plaid_link',
      transientSecret: result.link_token,
      opaqueLaunchSecret: result.link_token,
      hostedUrl: safeHttpsUrl(shareableUrl),
      expiresAt: safeDate(result.expiration, new Date(this.runtime.now().getTime() + 30 * 60_000)),
      providerDisclosure: 'Powered by Plaid',
    };
  }

  private async getVerificationKey(keyId: string): Promise<PlaidVerificationJwk> {
    const response = await this.call<{ key?: PlaidVerificationJwk }>(
      'webhook_verify', '/webhook_verification_key/get', { key_id: keyId },
    );
    if (!response.key || response.key.kid !== keyId) {
      throw new PlaidWebhookVerificationError('INVALID_KEY', 'Plaid returned an unknown webhook key.');
    }
    return response.key;
  }

  private async call<T>(
    operation: ProviderOperation,
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const startedAt = this.runtime.now().getTime();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.runtime.fetch(`${plaidBaseUrl(this.environment)}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PLAID-CLIENT-ID': this.config.clientId,
          'PLAID-SECRET': this.config.secret,
          'Plaid-Version': '2020-09-14',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const code = response.status === 401 || response.status === 403 ? 'AUTHENTICATION_FAILED'
          : response.status === 429 ? 'RATE_LIMITED'
            : response.status === 408 || response.status === 504 ? 'TIMEOUT'
              : response.status >= 500 ? 'RETRYABLE_PROVIDER_FAILURE' : 'TERMINAL_INPUT_FAILURE';
        throw new ProviderError(code, 'Plaid request failed.', {
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          retryAfterSeconds: retryAfter,
          safeCode: code === 'AUTHENTICATION_FAILED' ? 'plaid_authentication_failed'
            : code === 'RATE_LIMITED' ? 'plaid_rate_limited'
            : code === 'TIMEOUT' ? 'plaid_timeout'
            : code === 'RETRYABLE_PROVIDER_FAILURE' ? 'plaid_provider_failure'
            : 'plaid_terminal_input_failure',
        });
      }
      const result = await response.json().catch(() => {
        throw new ProviderError('UNKNOWN_PROVIDER_STATUS', 'Plaid returned a malformed response.', {
          safeCode: 'malformed_provider_response',
        });
      }) as T;
      const unknown = isRecordWithStringStatus(result)
        && normalizePlaidIdentityStatus(result.status).reasonCodes.includes('plaid_status_ambiguous');
      await this.recordObservation(
        operation,
        unknown ? 'unknown_status' : 'success',
        unknown ? 'plaid_unknown_status' : `plaid_${operation}_ok`,
        startedAt,
      );
      return result;
    } catch (error) {
      const failure = error instanceof ProviderUnavailableError || error instanceof ProviderError
        ? error
        : error instanceof DOMException && error.name === 'AbortError'
          ? new ProviderError('TIMEOUT', 'Plaid request timed out.', {
            retryable: true, safeCode: 'plaid_timeout',
          })
          : new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Plaid legacy verification is temporarily unavailable.', {
            retryable: true, safeCode: 'plaid_provider_failure', cause: error,
          });
      await this.recordObservation(
        operation,
        failure.retryable ? 'retryable_failure' : 'terminal_failure',
        failure.safeCode,
        startedAt,
      );
      throw failure;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private requireIdempotencyKey(operation: ProviderOperation, attemptId: string, suppliedKey?: string): string {
    const key = this.runtime.idempotency.keyFor(operation, attemptId, suppliedKey);
    if (!key || key.length > 255) {
      throw new ProviderUnavailableError('Plaid idempotency configuration is invalid.');
    }
    this.runtime.logger.info('verification_provider_idempotency_resolved', {
      provider: this.provider,
      environment: this.environment,
      operation,
    });
    return key;
  }

  private async recordObservation(
    operation: ProviderOperation,
    outcome: 'success' | 'retryable_failure' | 'terminal_failure' | 'unknown_status',
    safeCode: string,
    startedAt: number,
  ): Promise<void> {
    const observedAt = this.runtime.now();
    const metadata = {
      provider: this.provider,
      environment: this.environment,
      operation,
      outcome,
      safe_code: safeCode,
      latency_ms: Math.max(0, observedAt.getTime() - startedAt),
    };
    try {
      await this.runtime.recordHealth({
        operation,
        outcome,
        safeCode,
        observedAt: observedAt.toISOString(),
        latencyMs: metadata.latency_ms,
      });
      if (outcome === 'success') this.runtime.logger.info('verification_provider_operation', metadata);
      else this.runtime.logger.warn('verification_provider_operation', metadata);
    } catch {
      this.runtime.logger.warn('verification_provider_health_record_failed', {
        provider: this.provider,
        environment: this.environment,
        operation,
      });
    }
  }
}

export function normalizePlaidIdentityStatus(value: unknown): {
  status: VerificationCanonicalStatus;
  reasonCodes: string[];
} {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'active':
    case 'pending': return { status: 'pending_user_input', reasonCodes: [] };
    case 'processing': return { status: 'processing', reasonCodes: [] };
    case 'success':
    case 'passed': return { status: 'verified', reasonCodes: [] };
    case 'pending_review':
    case 'review_needed': return { status: 'manual_review_required', reasonCodes: ['plaid_pending_review'] };
    case 'failed': return { status: 'failed', reasonCodes: ['plaid_verification_failed'] };
    case 'expired': return { status: 'expired', reasonCodes: ['plaid_attempt_expired'] };
    case 'canceled':
    case 'cancelled': return { status: 'canceled', reasonCodes: ['plaid_attempt_canceled'] };
    default: return { status: 'manual_review_required', reasonCodes: ['plaid_status_ambiguous'] };
  }
}

function plaidBaseUrl(environment: 'sandbox' | 'production'): string {
  return environment === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
}

function assertHumanReference(value: string): void {
  if (!/^svh_[A-Z2-7]{26}$/.test(value)) {
    throw new ProviderUnavailableError('SplitIn subject reference is invalid.');
  }
}

function requiredProviderId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{3,256}$/.test(value)) {
    throw new ProviderUnavailableError('Plaid resource identifier is invalid.');
  }
  return value;
}

function requiredStatus(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new ProviderUnavailableError('Plaid status is invalid.');
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new ProviderUnavailableError(`Plaid ${field} is invalid.`);
  }
  return value;
}

function safeDate(value: unknown, fallback: Date): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback.toISOString();
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'verify.plaid.com' && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Math.min(Number(value), 3600);
}

function isRecordWithStringStatus(value: unknown): value is Record<string, unknown> & { status: string } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).status === 'string';
}

function isPlaidRuntimeContext(
  value: PlaidLegacyProviderRuntimeContext | PlaidLegacyAdapterConfig,
): value is PlaidLegacyProviderRuntimeContext {
  return 'configuration' in value
    && typeof value.fetch === 'function'
    && typeof value.now === 'function'
    && typeof value.idempotency?.keyFor === 'function'
    && typeof value.logger?.info === 'function'
    && typeof value.recordHealth === 'function';
}

function legacyPlaidRuntimeContext(config: PlaidLegacyAdapterConfig): PlaidLegacyProviderRuntimeContext {
  const {
    environment,
    fetch: runtimeFetch,
    now,
    idempotency,
    logger,
    recordHealth,
    ...configuration
  } = config;
  return {
    environment,
    configuration: Object.freeze(configuration),
    fetch: runtimeFetch ?? unavailablePlaidFetch,
    now: now ?? fixedLegacyClock,
    idempotency: idempotency ?? defaultPlaidIdempotency,
    logger: logger ?? NOOP_PROVIDER_LOGGER,
    recordHealth: recordHealth ?? NOOP_HEALTH_RECORDER,
  };
}

const unavailablePlaidFetch = (async () => {
  throw new ProviderUnavailableError('Plaid runtime networking is unavailable.');
}) as typeof fetch;

const fixedLegacyClock = (): Date => new Date(0);

const defaultPlaidIdempotency = Object.freeze({
  keyFor(operation: ProviderOperation, attemptId: string, suppliedKey?: string): string {
    return suppliedKey ?? `plaid:${operation}:${attemptId}`;
  },
});

const NOOP_PROVIDER_LOGGER: ProviderSafeLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

const NOOP_HEALTH_RECORDER: PlaidLegacyProviderRuntimeContext['recordHealth'] = async () => undefined;
