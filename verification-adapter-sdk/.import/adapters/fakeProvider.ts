import {
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  fakeProviderManifest,
  type NormalizedProviderEvent,
  type NormalizedProviderSnapshot,
  type ProviderAttemptCommand,
  type ProviderAttemptResult,
  type ProviderCapabilities,
  type ProviderLaunchResult,
  type ProviderOperation,
  type ProviderRedactionCommand,
  type ProviderRedactionResult,
  type ProviderResourceCommand,
  type ProviderOperationResult,
  type ProviderRetryCommand,
  type ProviderRuntimeContext,
  type ProviderSafeLogger,
  type VerificationProviderAdapter,
  type VerifiedWebhookEnvelope,
} from './contracts.ts';

/**
 * Deterministic adapter used only by contract tests and non-production local
 * environments. It deliberately has no network access, credentials, or
 * provider-specific semantics. Durable idempotency belongs in the database
 * orchestration layer; this adapter derives a stable opaque resource ID from
 * the SplitIn attempt ID so timeout retries are safe in tests.
 */
export class FakeVerificationProvider implements VerificationProviderAdapter {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = fakeProviderManifest;
  readonly provider = 'test_fake';
  readonly environment = 'sandbox' as const;
  private readonly runtime: ProviderRuntimeContext<Record<string, never>>;

  constructor(runtime: ProviderRuntimeContext<Record<string, never>> = defaultFakeRuntimeContext()) {
    this.runtime = runtime;
  }

  validateConfiguration(): void {
    if (this.runtime.environment !== 'sandbox'
      || Object.keys(this.runtime.configuration).length > 0
      || typeof this.runtime.fetch !== 'function') {
      throw new Error('The test provider runtime is invalid.');
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      presentations: ['embedded', 'hosted'],
      canResume: true,
      canRetry: true,
      canCancel: true,
      canRedact: true,
    };
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.runtime.idempotency.keyFor('create', command.attemptId, command.idempotencyKey);
    await this.recordObservation('create');
    return {
      providerResourceId: resourceId(command.attemptId),
      providerStatus: 'awaiting_user',
      launch: this.launch(command.attemptId),
    };
  }

  async resumeAttempt(command: ProviderResourceCommand): Promise<ProviderLaunchResult> {
    this.runtime.idempotency.keyFor('resume', command.attemptId);
    await this.recordObservation('resume');
    return this.launch(command.attemptId);
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    await this.recordObservation('retrieve');
    return {
      providerResourceId: command.providerResourceId,
      providerStatus: 'awaiting_user',
      canonicalStatus: 'pending_user_input',
      occurredAt: this.runtime.now().toISOString(),
      normalizedReasonCodes: [],
      safeMetadata: { source: 'reconciliation', adapter_version: 'test-fake-v1' },
    };
  }

  async reconcileAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    return this.retrieveAttempt(command);
  }

  async requestRetry(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    const idempotencyKey = this.runtime.idempotency.keyFor('retry', command.attemptId, command.idempotencyKey);
    await this.recordObservation('retry');
    return this.createAttempt({ ...command, idempotencyKey });
  }

  async cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    this.runtime.idempotency.keyFor('cancel', command.attemptId);
    await this.recordObservation('cancel');
    return { accepted: true, providerStatus: 'canceled' };
  }

  async redactSubject(command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    this.runtime.idempotency.keyFor('redact', command.requestReference, command.requestReference);
    await this.recordObservation('redact');
    return { completed: true, retryable: false };
  }

  async verifyWebhook(): Promise<VerifiedWebhookEnvelope> {
    throw new Error('The test provider does not receive webhooks. Use reconciliation in conformance tests.');
  }

  async normalizeWebhook(_input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    throw new Error('The test provider does not receive webhooks. Use reconciliation in conformance tests.');
  }

  private launch(attemptId: string): ProviderLaunchResult {
    return {
      presentation: 'embedded',
      launcherKey: 'test_embedded',
      adapter: 'test_embedded',
      transientSecret: `test_launch_${attemptId.replace(/-/g, '')}`,
      opaqueLaunchSecret: `test_launch_${attemptId.replace(/-/g, '')}`,
      expiresAt: new Date(this.runtime.now().getTime() + 5 * 60_000).toISOString(),
    };
  }

  private async recordObservation(operation: ProviderOperation): Promise<void> {
    const observedAt = this.runtime.now();
    try {
      await this.runtime.recordHealth({
        operation,
        outcome: 'success',
        safeCode: `test_fake_${operation}_ok`,
        observedAt: observedAt.toISOString(),
        latencyMs: 0,
      });
      this.runtime.logger.info('verification_provider_operation', {
        provider: this.provider,
        environment: this.environment,
        operation,
        outcome: 'success',
      });
    } catch {
      this.runtime.logger.warn('verification_provider_health_record_failed', {
        provider: this.provider,
        environment: this.environment,
        operation,
      });
    }
  }
}

function resourceId(attemptId: string): string {
  return `tfr_${attemptId.replace(/-/g, '')}`;
}

function defaultFakeRuntimeContext(): ProviderRuntimeContext<Record<string, never>> {
  return {
    environment: 'sandbox',
    configuration: Object.freeze({}),
    fetch: unavailableFakeFetch,
    now: () => new Date(0),
    idempotency: {
      keyFor: (operation, attemptId, suppliedKey) => suppliedKey ?? `test_fake:${operation}:${attemptId}`,
    },
    logger: NOOP_PROVIDER_LOGGER,
    recordHealth: async () => undefined,
  };
}

const unavailableFakeFetch = (async () => {
  throw new Error('The test provider has no network access.');
}) as typeof fetch;

const NOOP_PROVIDER_LOGGER: ProviderSafeLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
