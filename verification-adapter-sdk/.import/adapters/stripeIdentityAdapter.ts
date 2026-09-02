import {
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  ProviderError,
  ProviderRequiredInformationError,
  ProviderUnavailableError,
  stripeIdentityProviderManifest,
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

type StripeIdentityEnvironment = 'sandbox' | 'production';

export interface StripeIdentityAdapterConfiguration {
  restrictedKey: string;
  accountId: string;
  webhookSecrets: string[];
  apiVersion: string;
  configReference: string;
  returnUrl?: string;
  webhookToleranceSeconds?: number;
}

export type StripeIdentityProviderRuntimeContext = ProviderRuntimeContext<StripeIdentityAdapterConfiguration>;

/** @deprecated Direct-constructor bridge for V1 tests. Production uses ProviderRuntimeContext. */
export interface StripeIdentityAdapterConfig extends StripeIdentityAdapterConfiguration {
  environment: StripeIdentityEnvironment;
  fetch?: typeof fetch;
  now?: () => Date;
  idempotency?: StripeIdentityProviderRuntimeContext['idempotency'];
  logger?: ProviderSafeLogger;
  recordHealth?: StripeIdentityProviderRuntimeContext['recordHealth'];
}

interface StripeVerificationSession {
  id: string;
  client_secret?: string | null;
  created: number;
  livemode: boolean;
  status: string;
  url?: string | null;
  last_error?: { code?: string | null } | null;
  redaction?: { status?: string | null } | null;
}

interface StripeIdentityEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  account?: string | null;
  data: { object: StripeVerificationSession };
}

const STRIPE_IDENTITY_EVENTS = new Set(stripeIdentityProviderManifest.webhook.eventTypes);
const MANUAL_REVIEW_ERRORS = new Set([
  'consent_declined',
  'country_not_supported',
  'device_unsupported',
  'document_unverified_other',
  'selfie_document_missing_photo',
  'selfie_face_mismatch',
  'selfie_manipulated',
  'selfie_unverified_other',
]);
const TERMINAL_DECLINE_ERRORS = new Set(['under_supported_age']);
const STRIPE_IDENTITY_API_VERSION = '2025-08-27.basil';

export function createStripeIdentityAdapterConfiguration(
  values: Readonly<Record<string, string | undefined>>,
): StripeIdentityAdapterConfiguration {
  return Object.freeze({
    restrictedKey: values.STRIPE_IDENTITY_RESTRICTED_KEY ?? '',
    accountId: values.STRIPE_IDENTITY_ACCOUNT_ID ?? '',
    webhookSecrets: [
      values.STRIPE_IDENTITY_WEBHOOK_SECRET ?? '',
      values.STRIPE_IDENTITY_WEBHOOK_SECRET_PREVIOUS ?? '',
    ],
    apiVersion: values.STRIPE_IDENTITY_API_VERSION ?? '',
    configReference: values.STRIPE_IDENTITY_CONFIG_REFERENCE ?? '',
    returnUrl: values.STRIPE_IDENTITY_RETURN_URL,
    webhookToleranceSeconds: parseTolerance(values.STRIPE_IDENTITY_WEBHOOK_TOLERANCE_SECONDS),
  });
}

/** Human-IDV-only Stripe Identity leaf. Stripe Connect is intentionally absent. */
export class StripeIdentityVerificationAdapter implements VerificationProviderAdapter {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = stripeIdentityProviderManifest;
  readonly provider = 'stripe_identity';
  readonly environment: StripeIdentityEnvironment;
  private readonly runtime: StripeIdentityProviderRuntimeContext;
  private readonly config: Readonly<StripeIdentityAdapterConfiguration>;

  constructor(runtime: StripeIdentityProviderRuntimeContext | StripeIdentityAdapterConfig) {
    this.runtime = isStripeRuntimeContext(runtime) ? runtime : legacyStripeRuntimeContext(runtime);
    this.config = this.runtime.configuration;
    this.environment = this.runtime.environment;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    const expectedPrefix = this.environment === 'production' ? 'rk_live_' : 'rk_test_';
    if (!this.config.restrictedKey.startsWith(expectedPrefix)) {
      throw new ProviderUnavailableError('Stripe Identity credentials do not match the pinned environment.');
    }
    if (!this.config.webhookSecrets.some((value) => value.startsWith('whsec_'))) {
      throw new ProviderUnavailableError('Stripe Identity webhook authentication is not configured.');
    }
    if (this.config.apiVersion !== STRIPE_IDENTITY_API_VERSION) {
      throw new ProviderUnavailableError('Stripe Identity API version does not match the reviewed contract.');
    }
    if (!/^stripe_identity\.[a-z0-9._-]{3,96}$/.test(this.config.configReference)) {
      throw new ProviderUnavailableError('Stripe Identity configuration reference is invalid.');
    }
    if (!/^acct_[A-Za-z0-9]{8,252}$/.test(this.config.accountId)) {
      throw new ProviderUnavailableError('Stripe Identity account is invalid.');
    }
    if (this.config.returnUrl) assertStripeReturnUrl(this.config.returnUrl);
  }

  capabilities(): ProviderCapabilities {
    return this.manifest.capabilities;
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    const body = new URLSearchParams();
    body.set('type', 'document');
    body.set('client_reference_id', await sha256Hex(new TextEncoder().encode(command.humanSubjectReference)));
    body.set('metadata[splitin_attempt_id]', command.attemptId);
    const documentOnlyManualReview = command.reviewMode === 'document_only_manual_review';
    body.set('options[document][require_matching_selfie]', documentOnlyManualReview ? 'false' : 'true');
    body.set('metadata[splitin_review_mode]', documentOnlyManualReview ? 'document_only_manual_review' : 'standard');
    if (command.email) body.set('provided_details[email]', safeEmail(command.email));
    if (this.config.returnUrl) body.set('return_url', this.config.returnUrl);
    const session = await this.call('/identity/verification_sessions', {
      method: 'POST', operation: 'create', idempotencyScope: command.attemptId,
      body, idempotencyKey: command.idempotencyKey,
    });
    return this.toAttemptResult(session);
  }

  async resumeAttempt(command: ProviderResourceCommand): Promise<ProviderLaunchResult> {
    this.assertConfigReference(command.providerConfigReference);
    return this.launchFor(await this.getSession(command.providerResourceId, 'resume'));
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    this.assertConfigReference(command.providerConfigReference);
    return this.normalizeSnapshot(await this.getSession(command.providerResourceId, 'retrieve'));
  }

  async reconcileAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    this.assertConfigReference(command.providerConfigReference);
    return this.normalizeSnapshot(await this.getSession(command.providerResourceId, 'reconcile'));
  }

  async requestRetry(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    if (command.previousProviderResourceId) {
      const previous = await this.getSession(command.previousProviderResourceId, 'retry');
      if (previous.status === 'requires_input') return this.toAttemptResult(previous);
      if (previous.redaction?.status === 'redacted' || previous.status === 'canceled') {
        const idempotencyKey = this.runtime.idempotency.keyFor('retry', command.attemptId, command.idempotencyKey);
        return this.createAttempt({ ...command, idempotencyKey });
      }
      if (previous.status === 'processing') {
        throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Stripe Identity is still processing this attempt.', {
          retryable: true,
          retryAfterSeconds: 15,
          safeCode: 'stripe_identity_processing',
        });
      }
      if (previous.status === 'verified') {
        throw new ProviderError('TERMINAL_INPUT_FAILURE', 'A verified Stripe Identity attempt cannot be retried.', {
          safeCode: 'stripe_identity_already_verified',
        });
      }
      throw new ProviderError('UNKNOWN_PROVIDER_STATUS', 'Stripe Identity retry state is not recognized.', {
        safeCode: 'stripe_identity_retry_state_unknown',
      });
    }
    const idempotencyKey = this.runtime.idempotency.keyFor('retry', command.attemptId, command.idempotencyKey);
    return this.createAttempt({ ...command, idempotencyKey });
  }

  async cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    this.assertConfigReference(command.providerConfigReference);
    const current = await this.getSession(command.providerResourceId, 'cancel');
    if (current.status === 'canceled') return { accepted: true, providerStatus: current.status };
    if (current.status === 'processing') {
      throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Stripe Identity is already processing this attempt.', {
        retryable: true,
        retryAfterSeconds: 15,
        safeCode: 'stripe_identity_processing',
      });
    }
    if (current.status !== 'requires_input') {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity cannot cancel this attempt state.', {
        safeCode: current.status === 'verified'
          ? 'stripe_identity_already_verified'
          : 'stripe_identity_cancel_state_invalid',
      });
    }
    const session = await this.call(`/identity/verification_sessions/${encodeSessionId(command.providerResourceId)}/cancel`, {
      method: 'POST', operation: 'cancel', idempotencyScope: command.attemptId,
      body: new URLSearchParams(),
    });
    return { accepted: session.status === 'canceled', providerStatus: session.status };
  }

  async redactSubject(command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    if (!command.providerResourceId) throw new ProviderRequiredInformationError();
    const current = await this.getSession(command.providerResourceId, 'redact');
    if (current.redaction?.status === 'redacted') {
      return { completed: true, retryable: false, disposition: 'redacted' };
    }
    if (current.redaction?.status === 'processing' || current.status === 'processing') {
      return { completed: false, retryable: true, disposition: 'processing' };
    }
    if (current.status === 'canceled') {
      return { completed: true, retryable: false, disposition: 'not_applicable' };
    }
    if (current.status !== 'requires_input' && current.status !== 'verified') {
      return { completed: false, retryable: false, disposition: 'failed' };
    }
    const session = await this.call(`/identity/verification_sessions/${encodeSessionId(command.providerResourceId)}/redact`, {
      method: 'POST', operation: 'redact', idempotencyScope: command.requestReference,
      body: new URLSearchParams(), idempotencyKey: command.requestReference,
    });
    const status = session.redaction?.status ?? '';
    return {
      completed: status === 'redacted',
      retryable: status === 'processing',
      disposition: status === 'redacted' ? 'redacted' : status === 'processing' ? 'processing' : 'failed',
    };
  }

  async verifyWebhook(request: Request): Promise<VerifiedWebhookEnvelope> {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.byteLength === 0 || rawBody.byteLength > 1_048_576) {
      throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity webhook body is invalid.');
    }
    const signature = parseStripeSignature(request.headers.get('stripe-signature'));
    const nowSeconds = Math.floor(this.runtime.now().getTime() / 1000);
    const tolerance = this.config.webhookToleranceSeconds ?? 300;
    if (Math.abs(nowSeconds - signature.timestamp) > tolerance) {
      throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity webhook signature is stale.');
    }
    const prefix = new TextEncoder().encode(`${signature.timestamp}.`);
    const signedPayload = new Uint8Array(prefix.length + rawBody.length);
    signedPayload.set(prefix);
    signedPayload.set(rawBody, prefix.length);
    let matched = false;
    for (const secret of this.config.webhookSecrets.filter((value) => value.startsWith('whsec_'))) {
      const digest = await hmacSha256Hex(secret, signedPayload);
      if (signature.v1.some((candidate) => constantTimeEqual(digest, candidate))) matched = true;
    }
    if (!matched) throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity webhook signature is invalid.');
    const bodySha256 = await sha256Hex(rawBody);
    let providerEventKey = `stripe_${bodySha256}`;
    try {
      const parsed = parseEvent(rawBody);
      this.assertLivemode(parsed.livemode);
      providerEventKey = parsed.id;
    } catch (error) {
      if (!(error instanceof ProviderError)
        || error.safeCode !== 'stripe_webhook_payload_invalid') throw error;
    }
    return {
      providerEventKey,
      receivedAt: this.runtime.now().toISOString(),
      bodySha256,
      signatureIssuedAt: new Date(signature.timestamp * 1000).toISOString(),
      opaquePayload: rawBody,
    };
  }

  async normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    const event = parseEvent(input.opaquePayload);
    if (event.id !== input.providerEventKey) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook event identity is inconsistent.', {
        safeCode: 'stripe_webhook_event_identity_mismatch',
      });
    }
    const eventAllowlisted = STRIPE_IDENTITY_EVENTS.has(event.type);
    const session = requireSession(event.data.object);
    this.assertLivemode(event.livemode);
    this.assertLivemode(session.livemode);
    if (event.account && event.account !== this.config.accountId) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook account is inconsistent.', {
        safeCode: 'stripe_account_mismatch',
      });
    }
    if (event.livemode !== session.livemode) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook mode is inconsistent.', {
        safeCode: 'stripe_environment_mismatch',
      });
    }
    const normalized = eventAllowlisted
      ? normalizeStripeStatus(session.status, session.last_error?.code ?? null, event.type)
      : { canonicalStatus: 'manual_review_required' as const, reasonCodes: ['stripe_unknown_event'] };
    return {
      providerEventKey: event.id,
      providerResourceId: session.id,
      eventType: `verification.provider_event.${normalized.canonicalStatus ?? 'manual_review_required'}`,
      providerEventType: event.type,
      canonicalStatus: normalized.canonicalStatus,
      occurredAt: new Date(event.created * 1000).toISOString(),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        livemode: event.livemode,
        adapter_version: this.manifest.adapterVersion,
        normalization_version: 'stripe-identity-v2',
        event_allowlisted: eventAllowlisted,
        reconcile_required: !eventAllowlisted || normalized.reasonCodes.includes('stripe_unknown_status'),
      },
    };
  }

  private assertCommand(command: ProviderAttemptCommand): void {
    if (command.packageCode !== 'human_idv') {
      throw new ProviderError('UNSUPPORTED_PACKAGE', 'Stripe Identity does not support this verification package.');
    }
    this.assertConfigReference(command.providerConfigReference);
    if (!/^svh_[A-Z2-7]{26}$/.test(command.humanSubjectReference)) {
      throw new ProviderUnavailableError('SplitIn subject reference is invalid.');
    }
  }

  private assertConfigReference(value: string): void {
    if (value !== this.config.configReference) {
      throw new ProviderUnavailableError('Stripe Identity configuration does not match the pinned route.');
    }
  }

  private assertLivemode(livemode: boolean): void {
    if (livemode !== (this.environment === 'production')) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity mode does not match the pinned environment.', {
        safeCode: 'stripe_environment_mismatch',
      });
    }
  }

  private async getSession(
    providerResourceId: string,
    operation: ProviderOperation = 'retrieve',
  ): Promise<StripeVerificationSession> {
    return this.call(`/identity/verification_sessions/${encodeSessionId(providerResourceId)}`, {
      method: 'GET', operation,
    });
  }

  private toAttemptResult(session: StripeVerificationSession): ProviderAttemptResult {
    return {
      providerResourceId: session.id,
      providerStatus: session.status,
      launch: this.launchFor(session),
    };
  }

  private launchFor(session: StripeVerificationSession): ProviderLaunchResult {
    if (session.status !== 'requires_input') {
      return { presentation: 'none', launcherKey: 'hosted', adapter: 'hosted', providerDisclosure: 'Powered by Stripe' };
    }
    const secret = safeClientSecret(session.client_secret);
    const hostedUrl = safeStripeHostedUrl(session.url);
    const transientSecretExpiresAt = secret ? stripeExpiry(this.runtime.now(), 86_400) : undefined;
    const hostedFallbackExpiresAt = hostedUrl ? stripeExpiry(this.runtime.now(), 172_800) : undefined;
    if (!secret && !hostedUrl) throw new ProviderUnavailableError('Stripe Identity did not return resumable launch material.');
    return {
      presentation: secret ? 'embedded' : 'hosted',
      launcherKey: secret ? 'stripe_identity' : 'hosted',
      adapter: secret ? 'stripe_identity' : 'hosted',
      inquiryOrSessionId: session.id,
      transientSecret: secret,
      transientSecretExpiresAt,
      opaqueLaunchSecret: secret,
      hostedUrl,
      hostedFallbackExpiresAt,
      expiresAt: secret ? transientSecretExpiresAt : hostedFallbackExpiresAt,
      providerDisclosure: 'Powered by Stripe',
    };
  }

  private normalizeSnapshot(session: StripeVerificationSession): NormalizedProviderSnapshot {
    const normalized = normalizeStripeStatus(session.status, session.last_error?.code ?? null);
    return {
      providerResourceId: session.id,
      providerStatus: session.status,
      canonicalStatus: normalized.canonicalStatus ?? 'manual_review_required',
      occurredAt: this.runtime.now().toISOString(),
      providerCreatedAt: new Date(session.created * 1000).toISOString(),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        source: 'reconciliation',
        livemode: session.livemode,
        adapter_version: this.manifest.adapterVersion,
        normalization_version: 'stripe-identity-v2',
      },
    };
  }

  private async call(
    path: string,
    options: {
      method: 'GET' | 'POST';
      operation?: ProviderOperation;
      idempotencyScope?: string;
      body?: URLSearchParams;
      idempotencyKey?: string;
    },
  ): Promise<StripeVerificationSession> {
    const operation = options.operation ?? (options.method === 'GET' ? 'retrieve' : 'create');
    const startedAt = this.runtime.now().getTime();
    const idempotencyKey = options.method === 'GET'
      ? undefined
      : this.runtime.idempotency.keyFor(operation, options.idempotencyScope ?? path, options.idempotencyKey);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.runtime.fetch(`https://api.stripe.com/v1${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.config.restrictedKey}`,
          'Stripe-Version': this.config.apiVersion,
          ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const code = response.status === 401 || response.status === 403 ? 'AUTHENTICATION_FAILED'
          : response.status === 429 ? 'RATE_LIMITED'
            : response.status === 408 || response.status === 504 ? 'TIMEOUT'
            : response.status >= 500 ? 'RETRYABLE_PROVIDER_FAILURE' : 'TERMINAL_INPUT_FAILURE';
        throw new ProviderError(code, 'Stripe Identity request failed.', {
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          retryAfterSeconds: retryAfter,
          safeCode: code === 'AUTHENTICATION_FAILED' ? 'stripe_authentication_failed'
            : code === 'RATE_LIMITED' ? 'stripe_rate_limited'
            : code === 'TIMEOUT' ? 'stripe_timeout'
            : code === 'RETRYABLE_PROVIDER_FAILURE' ? 'stripe_provider_failure'
            : 'stripe_terminal_input_failure',
        });
      }
      const result = requireSession(payload);
      this.assertLivemode(result.livemode);
      const normalized = normalizeStripeStatus(result.status, result.last_error?.code ?? null);
      const unknown = normalized.reasonCodes.includes('stripe_unknown_status');
      await this.recordObservation(
        operation,
        unknown ? 'unknown_status' : 'success',
        unknown ? 'stripe_unknown_status' : `stripe_identity_${operation}_ok`,
        startedAt,
      );
      return result;
    } catch (error) {
      const failure = error instanceof ProviderError || error instanceof ProviderUnavailableError
        ? error
        : error instanceof DOMException && error.name === 'AbortError'
          ? new ProviderError('TIMEOUT', 'Stripe Identity request timed out.', {
            retryable: true, safeCode: 'stripe_timeout',
          })
          : new ProviderError(
            'RETRYABLE_PROVIDER_FAILURE', 'Stripe Identity request failed.', {
              retryable: true, safeCode: 'stripe_provider_failure', cause: error,
            },
          );
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

function normalizeStripeStatus(
  status: string,
  lastErrorCode: string | null,
  eventType?: string,
): { canonicalStatus?: VerificationCanonicalStatus; reasonCodes: string[] } {
  const reasonCodes = lastErrorCode && /^[a-z0-9_]{1,96}$/.test(lastErrorCode) ? [lastErrorCode] : [];
  if (eventType === 'identity.verification_session.redacted') return { reasonCodes: ['provider_redacted'] };
  if (status === 'verified') return { canonicalStatus: 'verified', reasonCodes };
  if (status === 'processing') return { canonicalStatus: 'processing', reasonCodes };
  if (status === 'canceled') return { canonicalStatus: 'canceled', reasonCodes };
  if (status === 'requires_input') {
    return {
      canonicalStatus: lastErrorCode && TERMINAL_DECLINE_ERRORS.has(lastErrorCode)
        ? 'declined'
        : lastErrorCode && MANUAL_REVIEW_ERRORS.has(lastErrorCode)
          ? 'manual_review_required'
          : 'pending_user_input',
      reasonCodes,
    };
  }
  return { canonicalStatus: 'manual_review_required', reasonCodes: ['stripe_unknown_status'] };
}

function requireSession(value: unknown): StripeVerificationSession {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^vs_[A-Za-z0-9_]{8,252}$/.test(value.id)
    || typeof value.status !== 'string'
    || typeof value.created !== 'number'
    || typeof value.livemode !== 'boolean') {
    throw new ProviderError('UNKNOWN_PROVIDER_STATUS', 'Stripe Identity returned an invalid session.');
  }
  return value as unknown as StripeVerificationSession;
}

function parseEvent(rawBody: Uint8Array): StripeIdentityEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook payload is invalid.', {
      safeCode: 'stripe_webhook_payload_invalid',
    });
  }
  if (!isRecord(parsed)
    || typeof parsed.id !== 'string'
    || !/^evt_[A-Za-z0-9_]{8,252}$/.test(parsed.id)
    || typeof parsed.type !== 'string'
    || typeof parsed.created !== 'number'
    || typeof parsed.livemode !== 'boolean'
    || !isRecord(parsed.data)
    || !isRecord(parsed.data.object)) {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook event is invalid.', {
      safeCode: 'stripe_webhook_payload_invalid',
    });
  }
  return parsed as unknown as StripeIdentityEvent;
}

function stripeExpiry(observedAt: Date, ttlSeconds: number): string {
  return new Date(observedAt.getTime() + ttlSeconds * 1000).toISOString();
}

function parseStripeSignature(value: string | null): { timestamp: number; v1: string[] } {
  if (!value || value.length > 4096) throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity signature is missing.');
  let timestamp: number | null = null;
  const v1: string[] = [];
  for (const part of value.split(',')) {
    const [key, candidate] = part.trim().split('=', 2);
    if (key === 't' && /^\d{1,16}$/.test(candidate ?? '')) timestamp = Number(candidate);
    if (key === 'v1' && /^[a-f0-9]{64}$/i.test(candidate ?? '')) v1.push(candidate.toLowerCase());
  }
  if (!timestamp || !Number.isSafeInteger(timestamp) || v1.length === 0) {
    throw new ProviderError('SIGNATURE_INVALID', 'Stripe Identity signature is invalid.');
  }
  return { timestamp, v1 };
}

async function hmacSha256Hex(secret: string, payload: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, payload)));
}

async function sha256Hex(payload: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', payload)));
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function encodeSessionId(value: string): string {
  if (!/^vs_[A-Za-z0-9_]{8,252}$/.test(value)) throw new ProviderRequiredInformationError();
  return encodeURIComponent(value);
}

function safeClientSecret(value: unknown): string | undefined {
  return typeof value === 'string' && /^vs_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(value) ? value : undefined;
}

function safeStripeHostedUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'verify.stripe.com' && !url.username && !url.password
      ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function assertStripeReturnUrl(value: string): void {
  const url = new URL(value);
  const allowedHosts = new Set([
    'app.splitin.net', 'splitin.net', 'www.splitin.net',
    'app.staging.splitin.net', 'www.staging.splitin.net',
  ]);
  if (url.protocol !== 'https:'
    || !allowedHosts.has(url.hostname)
    || Boolean(url.username || url.password)) {
    throw new ProviderUnavailableError('Stripe Identity return URL is invalid.');
  }
}

function safeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ProviderRequiredInformationError();
  return normalized;
}

function parseTolerance(value: string | undefined): number {
  const parsed = Number(value ?? '300');
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 900 ? parsed : 300;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Math.min(Number(value), 3600);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStripeRuntimeContext(
  value: StripeIdentityProviderRuntimeContext | StripeIdentityAdapterConfig,
): value is StripeIdentityProviderRuntimeContext {
  return 'configuration' in value
    && typeof value.fetch === 'function'
    && typeof value.now === 'function'
    && typeof value.idempotency?.keyFor === 'function'
    && typeof value.logger?.info === 'function'
    && typeof value.recordHealth === 'function';
}

function legacyStripeRuntimeContext(config: StripeIdentityAdapterConfig): StripeIdentityProviderRuntimeContext {
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
    fetch: runtimeFetch ?? unavailableStripeFetch,
    now: now ?? fixedLegacyClock,
    idempotency: idempotency ?? defaultStripeIdempotency,
    logger: logger ?? NOOP_PROVIDER_LOGGER,
    recordHealth: recordHealth ?? NOOP_HEALTH_RECORDER,
  };
}

const unavailableStripeFetch = (async () => {
  throw new ProviderUnavailableError('Stripe Identity runtime networking is unavailable.');
}) as typeof fetch;

const fixedLegacyClock = (): Date => new Date(0);

const defaultStripeIdempotency = Object.freeze({
  keyFor(operation: ProviderOperation, attemptId: string, suppliedKey?: string): string {
    return suppliedKey ?? `stripe_identity:${operation}:${attemptId}`;
  },
});

const NOOP_PROVIDER_LOGGER: ProviderSafeLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

const NOOP_HEALTH_RECORDER: StripeIdentityProviderRuntimeContext['recordHealth'] = async () => undefined;
