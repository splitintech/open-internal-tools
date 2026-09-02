import {
  ProviderError,
  ProviderRequiredInformationError,
  ProviderUnavailableError,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  isOpaqueSubjectReference,
  metadataContainsForbiddenIdentifier,
  type NormalizedProviderEvent,
  type NormalizedProviderSnapshot,
  type ProviderAttemptCommand,
  type ProviderAttemptResult,
  type ProviderLaunchEnvelope,
  type ProviderOperation,
  type ProviderOperationResult,
  type ProviderRedactionCommand,
  type ProviderRedactionResult,
  type ProviderResourceCommand,
  type ProviderResumeCommand,
  type ProviderRetryCommand,
  type ProviderRuntimeContext,
  type VerificationAdapterV1,
  type VerificationCanonicalStatus,
  type VerificationLaunchPresentation,
  type VerifiedWebhookEnvelope,
} from '@splitin/verification-adapter-sdk';

import {
  type StripeIdentityAdapterConfiguration,
  validateStripeIdentityConfiguration,
  webhookSecretsFromConfig,
} from './configuration.ts';
import {
  STRIPE_IDENTITY_API_HOST,
  STRIPE_IDENTITY_API_VERSION,
  STRIPE_IDENTITY_DISCLOSURE,
  STRIPE_IDENTITY_HOSTED_HOST,
} from './constants.ts';
import { stripeIdentityProviderManifest } from './manifest.ts';
import { normalizeStripeIdentityStatus } from './status.ts';
import type { StripeVerificationSession } from './types.ts';
import {
  encodeSessionId,
  isoExpiry,
  mapProviderHttpError,
  requireSession,
  safeClientSecret,
  safeEmail,
  safeStripeHostedUrl,
  sha256Hex,
} from './util.ts';
import {
  eventIsAllowlisted,
  normalizeAllowlistedEvent,
  parseStripeEvent,
  sessionFromEvent,
  verifyStripeIdentityWebhook,
} from './webhook.ts';

export class StripeIdentityVerificationAdapter implements VerificationAdapterV1<StripeIdentityAdapterConfiguration> {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = stripeIdentityProviderManifest;
  readonly provider = 'stripe_identity' as const;
  readonly environment: 'sandbox' | 'production';
  readonly runtime: ProviderRuntimeContext<StripeIdentityAdapterConfiguration>;

  constructor(runtime: ProviderRuntimeContext<StripeIdentityAdapterConfiguration>) {
    this.runtime = runtime;
    this.environment = runtime.environment;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    validateStripeIdentityConfiguration(this.runtime.configuration, this.environment);
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    const body = new URLSearchParams();
    body.set('type', 'document');
    body.set('client_reference_id', await sha256Hex(this.runtime.crypto, new TextEncoder().encode(command.subjectReference)));
    body.set('metadata[attempt_id]', command.attemptId);
    body.set('options[document][require_matching_selfie]', this.runtime.configuration.requireMatchingSelfie === true ? 'true' : 'false');
    if (command.email) body.set('provided_details[email]', safeEmail(command.email));
    if (this.runtime.configuration.returnUrl) body.set('return_url', this.runtime.configuration.returnUrl);
    const session = await this.call('/identity/verification_sessions', {
      method: 'POST',
      operation: 'create',
      idempotencyScope: command.attemptId,
      body,
      idempotencyKey: command.idempotencyKey,
    });
    return this.toAttemptResult(command.attemptId, session);
  }

  async resumeAttempt(command: ProviderResumeCommand): Promise<ProviderLaunchEnvelope> {
    const session = await this.getSession(command.providerResourceId, 'resume');
    return this.launchFor(command.attemptId, session);
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    return this.normalizeSnapshot(await this.getSession(command.providerResourceId, 'retrieve'));
  }

  async retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    if (command.previousProviderResourceId) {
      const previous = await this.getSession(command.previousProviderResourceId, 'retry');
      if (previous.status === 'requires_input') return this.toAttemptResult(command.attemptId, previous);
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
      throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Stripe Identity retry state is not recognized.', {
        safeCode: 'stripe_identity_retry_state_unknown',
      });
    }
    const idempotencyKey = this.runtime.idempotency.keyFor('retry', command.attemptId, command.idempotencyKey);
    return this.createAttempt({ ...command, idempotencyKey });
  }

  async cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    const current = await this.getSession(command.providerResourceId, 'cancel');
    if (current.status === 'canceled') return { accepted: true, providerStatus: current.status, canonicalStatus: 'canceled' };
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
      method: 'POST',
      operation: 'cancel',
      idempotencyScope: command.attemptId,
      body: new URLSearchParams(),
    });
    return {
      accepted: session.status === 'canceled',
      providerStatus: session.status,
      canonicalStatus: session.status === 'canceled' ? 'canceled' : undefined,
    };
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
      method: 'POST',
      operation: 'redact',
      idempotencyScope: command.requestReference,
      body: new URLSearchParams(),
      idempotencyKey: command.requestReference,
    });
    const status = session.redaction?.status ?? '';
    if (status === 'redacted') return { completed: true, retryable: false, disposition: 'redacted' };
    if (status === 'processing') return { completed: false, retryable: true, disposition: 'processing' };
    return { completed: false, retryable: false, disposition: 'failed' };
  }

  async verifyWebhook(request: Request): Promise<VerifiedWebhookEnvelope> {
    return verifyStripeIdentityWebhook(request, {
      secrets: webhookSecretsFromConfig(this.runtime.configuration),
      toleranceSeconds: this.runtime.configuration.webhookToleranceSeconds ?? this.manifest.webhook.toleranceSeconds ?? 300,
      now: this.runtime.now(),
      crypto: this.runtime.crypto,
      environment: this.environment,
    });
  }

  async normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    const event = parseStripeEvent(input.opaquePayload);
    if (event.id !== input.providerEventKey) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook event identity is inconsistent.', {
        safeCode: 'stripe_webhook_event_identity_mismatch',
      });
    }
    const session = sessionFromEvent(event);
    this.assertLivemode(event.livemode);
    this.assertLivemode(session.livemode);
    if (event.account && event.account !== this.runtime.configuration.accountId) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook account is inconsistent.', {
        safeCode: 'stripe_account_mismatch',
      });
    }
    if (event.livemode !== session.livemode) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Stripe Identity webhook mode is inconsistent.', {
        safeCode: 'stripe_environment_mismatch',
      });
    }
    const eventAllowlisted = eventIsAllowlisted(event.type);
    const normalized = normalizeAllowlistedEvent(event);
    return {
      providerEventKey: event.id,
      providerResourceId: session.id,
      eventType: `verification.provider_event.${normalized.canonicalStatus}`,
      providerEventType: event.type,
      canonicalStatus: normalized.canonicalStatus,
      occurredAt: new Date(event.created * 1000).toISOString(),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        livemode: event.livemode,
        adapter_version: this.manifest.adapterVersion,
        normalization_version: 'stripe-identity-v1',
        event_allowlisted: eventAllowlisted,
        reconcile_required: !eventAllowlisted || normalized.reasonCodes.includes('stripe_unknown_status'),
      },
    };
  }

  private assertCommand(command: ProviderAttemptCommand): void {
    if (command.packageCode !== 'human_idv') {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Stripe Identity does not support this verification package.', {
        safeCode: 'unsupported_package',
      });
    }
    if (!isOpaqueSubjectReference(command.subjectReference)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'The subject reference is not an opaque identifier.', {
        safeCode: 'subject_reference_invalid',
      });
    }
    if (metadataContainsForbiddenIdentifier(command.metadata)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Attempt metadata contains a forbidden identifier.', {
        safeCode: 'forbidden_identifier',
      });
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
    operation: ProviderOperation,
  ): Promise<StripeVerificationSession> {
    return this.call(`/identity/verification_sessions/${encodeSessionId(providerResourceId)}`, {
      method: 'GET',
      operation,
    });
  }

  private toAttemptResult(attemptId: string, session: StripeVerificationSession): ProviderAttemptResult {
    const normalized = normalizeStripeIdentityStatus(
      session.status,
      session.last_error?.code ?? null,
      undefined,
      session.redaction?.status ?? null,
    );
    return {
      attemptId,
      providerResourceId: session.id,
      providerStatus: session.status,
      canonicalStatus: normalized.canonicalStatus,
      launch: this.launchFor(attemptId, session, normalized.canonicalStatus),
    };
  }

  private launchFor(
    attemptId: string,
    session: StripeVerificationSession,
    canonicalStatus?: VerificationCanonicalStatus,
  ): ProviderLaunchEnvelope {
    const status = canonicalStatus ?? normalizeStripeIdentityStatus(
      session.status,
      session.last_error?.code ?? null,
      undefined,
      session.redaction?.status ?? null,
    ).canonicalStatus;
    if (session.status !== 'requires_input') {
      return {
        attemptId,
        canonicalStatus: status,
        presentation: 'none',
        launcherKey: 'hosted',
        providerDisclosure: STRIPE_IDENTITY_DISCLOSURE,
        continuationReference: session.id,
      };
    }
    const secret = safeClientSecret(session.client_secret);
    const hostedUrl = safeStripeHostedUrl(session.url, STRIPE_IDENTITY_HOSTED_HOST);
    const transientSecretExpiresAt = secret ? isoExpiry(this.runtime.now(), 86_400) : undefined;
    const hostedFallbackExpiresAt = hostedUrl ? isoExpiry(this.runtime.now(), 172_800) : undefined;
    if (!secret && !hostedUrl) {
      throw new ProviderUnavailableError('Stripe Identity did not return resumable launch material.', {
        safeCode: 'stripe_identity_launch_material_missing',
      });
    }
    const presentation: VerificationLaunchPresentation = secret ? 'embedded' : 'hosted';
    return {
      attemptId,
      canonicalStatus: status,
      presentation,
      launcherKey: secret ? 'stripe_identity' : 'hosted',
      providerDisclosure: STRIPE_IDENTITY_DISCLOSURE,
      transientSecret: secret,
      transientSecretExpiresAt,
      hostedUrl,
      hostedFallbackExpiresAt,
      continuationReference: session.id,
    };
  }

  private normalizeSnapshot(session: StripeVerificationSession): NormalizedProviderSnapshot {
    const normalized = normalizeStripeIdentityStatus(
      session.status,
      session.last_error?.code ?? null,
      undefined,
      session.redaction?.status ?? null,
    );
    return {
      providerResourceId: session.id,
      providerStatus: session.status,
      canonicalStatus: normalized.canonicalStatus,
      occurredAt: this.runtime.now().toISOString(),
      providerCreatedAt: new Date(session.created * 1000).toISOString(),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        source: 'retrieve',
        livemode: session.livemode,
        adapter_version: this.manifest.adapterVersion,
        normalization_version: 'stripe-identity-v1',
      },
    };
  }

  private async call(
    path: string,
    options: {
      method: 'GET' | 'POST';
      operation: ProviderOperation;
      idempotencyScope?: string;
      body?: URLSearchParams;
      idempotencyKey?: string;
    },
  ): Promise<StripeVerificationSession> {
    if (this.runtime.rateBudget) {
      const budget = await this.runtime.rateBudget.acquire(options.operation);
      if (!budget.allowed) {
        throw new ProviderError('RATE_LIMITED', 'Stripe Identity rate budget is exhausted.', {
          retryable: true,
          retryAfterSeconds: budget.retryAfterSeconds,
          safeCode: 'stripe_identity_rate_limited',
        });
      }
    }
    const startedAt = this.runtime.now().getTime();
    const idempotencyKey = options.method === 'GET'
      ? undefined
      : this.runtime.idempotency.keyFor(options.operation, options.idempotencyScope ?? path, options.idempotencyKey);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    const url = `https://${STRIPE_IDENTITY_API_HOST}/v1${path}`;
    try {
      const response = await this.runtime.http.fetch(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.runtime.configuration.restrictedKey}`,
          'Stripe-Version': this.runtime.configuration.apiVersion || STRIPE_IDENTITY_API_VERSION,
          ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw mapProviderHttpError(response.status, response.headers.get('retry-after'), 'stripe_identity');
      const result = requireSession(payload);
      this.assertLivemode(result.livemode);
      const normalized = normalizeStripeIdentityStatus(
        result.status,
        result.last_error?.code ?? null,
        undefined,
        result.redaction?.status ?? null,
      );
      const unknown = normalized.reasonCodes.includes('stripe_unknown_status');
      await this.recordObservation(
        options.operation,
        unknown ? 'unknown_status' : 'success',
        unknown ? 'stripe_unknown_status' : `stripe_identity_${options.operation}_ok`,
        startedAt,
      );
      return result;
    } catch (error) {
      const failure = error instanceof ProviderError
        ? error
        : error instanceof DOMException && error.name === 'AbortError'
          ? new ProviderError('TIMEOUT', 'Stripe Identity request timed out.', {
            retryable: true, safeCode: 'stripe_timeout',
          })
          : new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Stripe Identity request failed.', {
            retryable: true, safeCode: 'stripe_provider_failure', cause: error,
          });
      await this.recordObservation(
        options.operation,
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
    const latencyMs = Math.max(0, observedAt.getTime() - startedAt);
    const metadata = {
      provider: this.provider,
      environment: this.environment,
      operation,
      outcome,
      safe_code: safeCode,
      latency_ms: latencyMs,
    };
    this.runtime.telemetry?.histogram?.('verification.provider.latency_ms', latencyMs, {
      provider: this.provider,
      operation,
    });
    this.runtime.telemetry?.counter?.('verification.provider.calls', 1, {
      provider: this.provider,
      operation,
      outcome,
    });
    try {
      await this.runtime.recordHealth({
        operation,
        outcome,
        safeCode,
        observedAt: observedAt.toISOString(),
        latencyMs,
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
