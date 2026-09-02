import {
  ProviderError,
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
  type VerifiedWebhookEnvelope,
} from '@splitin/verification-adapter-sdk';

import {
  type PlaidIdvAdapterConfiguration,
  validatePlaidIdvConfiguration,
} from './configuration.ts';
import {
  PLAID_API_VERSION,
  PLAID_DISCLOSURE,
  PLAID_HOSTED_HOST,
  PLAID_IDV_WEBHOOK_CODES,
  PLAID_IDV_WEBHOOK_TYPE,
  PLAID_NORMALIZATION_VERSION,
  PLAID_PRODUCTION_HOST,
  PLAID_SANDBOX_HOST,
} from './constants.ts';
import { plaidIdvProviderManifest } from './manifest.ts';
import { normalizePlaidIdentityStatus } from './status.ts';
import { sha256Hex } from './webhook-crypto.ts';
import {
  PlaidVerificationKeyCache,
  type PlaidVerificationJwk,
} from './webhook-key-cache.ts';
import { verifyPlaidWebhook } from './webhook.ts';

interface PlaidIdentitySnapshot {
  id: string;
  client_user_id: string;
  status: string;
  created_at?: string;
  completed_at?: string | null;
  shareable_url?: string | null;
}

export class PlaidIdvVerificationAdapter implements VerificationAdapterV1<PlaidIdvAdapterConfiguration> {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = plaidIdvProviderManifest;
  readonly provider = 'plaid' as const;
  readonly environment: 'sandbox' | 'production';
  readonly runtime: ProviderRuntimeContext<PlaidIdvAdapterConfiguration>;
  private readonly verificationKeyCache: PlaidVerificationKeyCache;

  constructor(runtime: ProviderRuntimeContext<PlaidIdvAdapterConfiguration>) {
    this.runtime = runtime;
    this.environment = runtime.environment;
    this.verificationKeyCache = new PlaidVerificationKeyCache({
      now: () => this.runtime.now().getTime(),
    });
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    validatePlaidIdvConfiguration(this.runtime.configuration);
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    this.requireIdempotencyKey('create', command.attemptId, command.idempotencyKey);
    const identity = await this.call<PlaidIdentitySnapshot>('create', '/identity_verification/create', {
      client_user_id: command.subjectReference,
      template_id: this.runtime.configuration.templateId,
      is_shareable: true,
      gave_consent: false,
      is_idempotent: true,
    });
    return this.toAttemptResult(command.attemptId, identity, 'create');
  }

  async resumeAttempt(command: ProviderResumeCommand): Promise<ProviderLaunchEnvelope> {
    const identity = await this.getIdentity(command.providerResourceId, 'resume');
    this.assertSubject(identity.client_user_id);
    return this.createLaunch(command.attemptId, identity, 'resume');
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    return this.normalizeSnapshot(await this.getIdentity(command.providerResourceId, 'retrieve'));
  }

  async retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    this.requireIdempotencyKey('retry', command.attemptId, command.idempotencyKey);
    if (!command.previousProviderResourceId) {
      return this.createAttempt(command);
    }
    const previous = await this.getIdentity(command.previousProviderResourceId, 'retry');
    this.assertSubject(previous.client_user_id);
    if (previous.client_user_id !== command.subjectReference) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'The prior Plaid attempt does not match this subject.', {
        safeCode: 'plaid_subject_mismatch',
      });
    }
    const normalized = normalizePlaidIdentityStatus(previous.status);
    if (normalized.status === 'pending_user_input' || normalized.status === 'created') {
      return this.toAttemptResult(command.attemptId, previous, 'retry');
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
      client_user_id: command.subjectReference,
      template_id: this.runtime.configuration.templateId,
      strategy: 'reset',
    });
    const result = await this.toAttemptResult(command.attemptId, identity, 'retry');
    result.linkedResources = [{
      resourceType: 'identity_verification',
      resourceId: requiredProviderId(previous.id),
      relationshipCode: 'retried_from',
      providerStatus: requiredStatus(previous.status),
      occurredAt: safeDate(previous.created_at, this.runtime.now()),
    }];
    return result;
  }

  async cancelAttempt(_command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Plaid Identity Verification does not expose a cancel API.', {
      safeCode: 'plaid_cancel_unsupported',
    });
  }

  async redactSubject(_command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    return { completed: true, retryable: false, disposition: 'not_applicable' };
  }

  async verifyWebhook(request: Request): Promise<VerifiedWebhookEnvelope> {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.byteLength === 0 || rawBody.byteLength > 1_048_576) {
      throw new ProviderError('SIGNATURE_INVALID', 'Plaid webhook body size is invalid.', {
        safeCode: 'plaid_webhook_body_invalid',
      });
    }
    const verified = await verifyPlaidWebhook({
      rawBody,
      verificationHeader: request.headers.get('Plaid-Verification'),
      crypto: this.runtime.crypto,
      nowMs: this.runtime.now().getTime(),
      getKey: async (keyId) => this.verificationKeyCache.get(
        keyId,
        async (uncachedKeyId) => this.getVerificationKey(uncachedKeyId),
      ),
    });
    return {
      providerEventKey: `plaid_${verified.bodySha256}`,
      receivedAt: this.runtime.now().toISOString(),
      bodySha256: verified.bodySha256,
      signatureIssuedAt: new Date(verified.issuedAt * 1000).toISOString(),
      opaquePayload: rawBody,
    };
  }

  async normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    let webhook: Record<string, unknown>;
    try {
      webhook = JSON.parse(new TextDecoder().decode(input.opaquePayload)) as Record<string, unknown>;
    } catch {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Plaid webhook JSON is invalid.', {
        safeCode: 'plaid_webhook_payload_invalid',
      });
    }
    const webhookType = requiredText(webhook.webhook_type, 'webhook_type');
    const webhookCode = requiredText(webhook.webhook_code, 'webhook_code');
    if (webhookType !== PLAID_IDV_WEBHOOK_TYPE || !PLAID_IDV_WEBHOOK_CODES.has(webhookCode)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Plaid webhook is outside Identity Verification scope.', {
        safeCode: 'plaid_webhook_scope_denied',
      });
    }
    const providerResourceId = requiredProviderId(webhook.identity_verification_id);
    const webhookEnvironment = requiredText(webhook.environment, 'environment');
    if (webhookEnvironment !== this.environment) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Plaid webhook environment does not match the configured adapter.', {
        safeCode: 'plaid_environment_mismatch',
      });
    }
    const status = typeof webhook.status === 'string' ? normalizePlaidIdentityStatus(webhook.status) : null;
    const providerEventKey = `plaid_${await sha256Hex(this.runtime.crypto, [
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
        normalization_version: PLAID_NORMALIZATION_VERSION,
        provider_event_category: webhookCode.toLowerCase(),
        provider_environment: this.environment,
      },
    };
  }

  private assertCommand(command: ProviderAttemptCommand): void {
    if (command.packageCode !== 'human_idv') {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Plaid Identity Verification does not support this package.', {
        safeCode: 'unsupported_package',
      });
    }
    this.assertSubject(command.subjectReference);
    if (metadataContainsForbiddenIdentifier(command.metadata)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Attempt metadata contains a forbidden identifier.', {
        safeCode: 'forbidden_identifier',
      });
    }
  }

  private assertSubject(value: string): void {
    if (!isOpaqueSubjectReference(value)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'The subject reference is not an opaque identifier.', {
        safeCode: 'subject_reference_invalid',
      });
    }
  }

  private async getIdentity(providerResourceId: string, operation: ProviderOperation): Promise<PlaidIdentitySnapshot> {
    return this.call<PlaidIdentitySnapshot>(operation, '/identity_verification/get', {
      identity_verification_id: requiredProviderId(providerResourceId),
    });
  }

  private async toAttemptResult(
    attemptId: string,
    identity: PlaidIdentitySnapshot,
    operation: ProviderOperation,
  ): Promise<ProviderAttemptResult> {
    const normalized = normalizePlaidIdentityStatus(identity.status);
    return {
      attemptId,
      providerResourceId: requiredProviderId(identity.id),
      providerStatus: requiredStatus(identity.status),
      canonicalStatus: normalized.status,
      launch: await this.createLaunch(attemptId, identity, operation),
    };
  }

  private normalizeSnapshot(identity: PlaidIdentitySnapshot): NormalizedProviderSnapshot {
    const normalized = normalizePlaidIdentityStatus(identity.status);
    const unknownStatus = normalized.reasonCodes.includes('plaid_status_ambiguous');
    if (unknownStatus) {
      this.runtime.logger.error('verification_provider_status_unknown', {
        provider: this.provider,
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
        source: 'retrieve',
        adapter_version: this.manifest.adapterVersion,
        normalization_version: PLAID_NORMALIZATION_VERSION,
        ...(unknownStatus ? { unknown_reason: 'provider_status_not_allowlisted' } : {}),
      },
    };
  }

  private async createLaunch(
    attemptId: string,
    identity: PlaidIdentitySnapshot,
    operation: ProviderOperation,
  ): Promise<ProviderLaunchEnvelope> {
    this.assertSubject(identity.client_user_id);
    const payload: Record<string, unknown> = {
      user: { client_user_id: identity.client_user_id },
      client_name: this.runtime.configuration.clientName,
      products: ['identity_verification'],
      country_codes: ['US'],
      language: 'en',
      identity_verification: { template_id: this.runtime.configuration.templateId, gave_consent: false },
    };
    if (this.runtime.configuration.webhookUrl) payload.webhook = this.runtime.configuration.webhookUrl;
    const result = await this.call<{ link_token?: unknown; expiration?: unknown }>(operation, '/link/token/create', payload);
    if (typeof result.link_token !== 'string' || result.link_token.length < 8) {
      throw new ProviderUnavailableError('Plaid did not return launch material.', {
        safeCode: 'plaid_launch_material_missing',
      });
    }
    const canonical = normalizePlaidIdentityStatus(identity.status).status;
    const hostedUrl = safeHttpsUrl(identity.shareable_url, PLAID_HOSTED_HOST);
    return {
      attemptId,
      canonicalStatus: canonical,
      presentation: 'embedded',
      launcherKey: 'plaid_link',
      providerDisclosure: PLAID_DISCLOSURE,
      transientSecret: result.link_token,
      transientSecretExpiresAt: safeDate(result.expiration, new Date(this.runtime.now().getTime() + 30 * 60_000)),
      hostedUrl,
      hostedFallbackExpiresAt: hostedUrl
        ? safeDate(result.expiration, new Date(this.runtime.now().getTime() + 30 * 60_000))
        : undefined,
      continuationReference: requiredProviderId(identity.id),
    };
  }

  private async getVerificationKey(keyId: string): Promise<PlaidVerificationJwk> {
    const response = await this.call<{ key?: PlaidVerificationJwk }>(
      'webhook_verify',
      '/webhook_verification_key/get',
      { key_id: keyId },
    );
    if (!response.key || response.key.kid !== keyId) {
      throw new ProviderError('SIGNATURE_INVALID', 'Plaid returned an unknown webhook key.', {
        safeCode: 'plaid_webhook_invalid_key',
      });
    }
    return response.key;
  }

  private async call<T>(
    operation: ProviderOperation,
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (this.runtime.rateBudget) {
      const budget = await this.runtime.rateBudget.acquire(operation);
      if (!budget.allowed) {
        throw new ProviderError('RATE_LIMITED', 'Plaid rate budget is exhausted.', {
          retryable: true,
          retryAfterSeconds: budget.retryAfterSeconds,
          safeCode: 'plaid_rate_limited',
        });
      }
    }
    const startedAt = this.runtime.now().getTime();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    const host = this.environment === 'production' ? PLAID_PRODUCTION_HOST : PLAID_SANDBOX_HOST;
    try {
      const response = await this.runtime.http.fetch(`https://${host}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PLAID-CLIENT-ID': this.runtime.configuration.clientId,
          'PLAID-SECRET': this.runtime.configuration.secret,
          'Plaid-Version': PLAID_API_VERSION,
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
        throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Plaid returned a malformed response.', {
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
      const failure = error instanceof ProviderError
        ? error
        : error instanceof DOMException && error.name === 'AbortError'
          ? new ProviderError('TIMEOUT', 'Plaid request timed out.', {
            retryable: true, safeCode: 'plaid_timeout',
          })
          : new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Plaid Identity Verification is temporarily unavailable.', {
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
      throw new ProviderError('INVALID_CONFIGURATION', 'Plaid idempotency configuration is invalid.', {
        safeCode: 'plaid_idempotency_invalid',
      });
    }
    return key;
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
    try {
      await this.runtime.recordHealth({
        operation, outcome, safeCode, observedAt: observedAt.toISOString(), latencyMs,
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

function requiredProviderId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{3,256}$/.test(value)) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Plaid resource identifier is invalid.', {
      safeCode: 'malformed_provider_response',
    });
  }
  return value;
}

function requiredStatus(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Plaid status is invalid.', {
      safeCode: 'malformed_provider_response',
    });
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', `Plaid ${field} is invalid.`, {
      safeCode: 'plaid_webhook_payload_invalid',
    });
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

function safeHttpsUrl(value: unknown, hostedHost: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostedHost && !url.username && !url.password
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
