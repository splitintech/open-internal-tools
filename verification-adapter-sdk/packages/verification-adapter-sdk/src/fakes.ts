import type {
  NormalizedProviderEvent,
  NormalizedProviderSnapshot,
  ProviderAttemptCommand,
  ProviderAttemptResult,
  ProviderLaunchEnvelope,
  ProviderManifestV1,
  ProviderOperationResult,
  ProviderRedactionCommand,
  ProviderRedactionResult,
  ProviderResourceCommand,
  ProviderRetryCommand,
  ProviderRuntimeContext,
  VerificationAdapterV1,
  VerificationCanonicalStatus,
  VerifiedWebhookEnvelope,
} from './contracts.ts';
import { ProviderError } from './errors.ts';
import { VERIFICATION_ADAPTER_CONTRACT_VERSION } from './identifiers.ts';
import { createDefaultRuntime, defineProviderManifest } from './manifest.ts';
import { emptyConfigurationSchema } from './schema.ts';

export type FakeScenario =
  | 'success'
  | 'input_required'
  | 'processing'
  | 'verified'
  | 'decline'
  | 'failure'
  | 'manual_review'
  | 'timeout'
  | 'rate_limit'
  | 'malformed_response'
  | 'unknown_state'
  | 'cancellation'
  | 'resume'
  | 'asynchronous_redaction'
  | 'retryable_provider_failure';

export const fakeProviderManifest: ProviderManifestV1 = defineProviderManifest({
  contractVersion: VERIFICATION_ADAPTER_CONTRACT_VERSION,
  adapterVersion: '1.0.0',
  engineCompatibility: '1.0.0',
  provider: 'test_fake',
  displayName: 'Conformance Fake Provider',
  supportedPackages: ['human_idv', 'com.example.employee_check'],
  supportedCountries: ['US'],
  environments: ['sandbox'],
  capabilities: { presentations: ['embedded', 'hosted'], canResume: true, canRetry: true, canCancel: true, canRedact: true },
  launcherKeys: ['test_embedded', 'hosted'],
  launchPresentations: ['embedded', 'hosted'],
  configurationSchemaVersion: 'urn:splitin:verification:config:test-fake:v1',
  configurationSchema: emptyConfigurationSchema,
  webhook: { protocol: 'none', eventFamilies: ['test'] },
  dataPolicy: {
    classifications: ['normalized_status'],
    prohibitedPersistence: ['raw_webhook', 'launch_secret', 'document', 'selfie'],
    rawPayloadPersistence: false,
    browserSecretPersistence: false,
    governmentIdentifierPersistence: false,
  },
  retry: { sameResourceWhenResumable: true, newAttemptAfterTerminal: true },
  cancellation: { supported: true, terminal: true },
  redaction: { supported: true, asynchronous: true },
  apiHosts: ['127.0.0.1'],
  testedApiVersions: ['fake-1'],
});

const SCENARIO_STATUS: Record<FakeScenario, VerificationCanonicalStatus> = {
  success: 'verified',
  verified: 'verified',
  input_required: 'pending_user_input',
  processing: 'processing',
  decline: 'declined',
  failure: 'failed',
  manual_review: 'manual_review_required',
  timeout: 'processing',
  rate_limit: 'processing',
  malformed_response: 'processing',
  unknown_state: 'processing',
  cancellation: 'canceled',
  resume: 'pending_user_input',
  asynchronous_redaction: 'processing',
  retryable_provider_failure: 'processing',
};

export class FakeVerificationAdapter implements VerificationAdapterV1<Record<string, never>> {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = fakeProviderManifest;
  readonly provider = 'test_fake';
  readonly environment = 'sandbox' as const;
  readonly runtime: ProviderRuntimeContext<Record<string, never>>;
  private readonly scenario: FakeScenario;
  private readonly resources = new Map<string, string>();

  constructor(scenario: FakeScenario = 'input_required', runtime?: ProviderRuntimeContext<Record<string, never>>) {
    this.scenario = scenario;
    this.runtime = runtime ?? createDefaultRuntime('sandbox', {}, { allowedHosts: ['127.0.0.1'] });
  }

  validateConfiguration(): void {
    if (this.runtime.environment !== 'sandbox') {
      throw new ProviderError('INVALID_CONFIGURATION', 'The fake provider is sandbox-only.');
    }
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.runtime.idempotency.keyFor('create', command.attemptId, command.idempotencyKey);
    const existing = this.resources.get(command.idempotencyKey);
    const providerResourceId = existing ?? `tfr_${command.attemptId.replace(/[^a-zA-Z0-9]/g, '')}`;
    this.resources.set(command.idempotencyKey, providerResourceId);
    const canonicalStatus = this.scenario === 'success' || this.scenario === 'verified' ? 'verified' : 'pending_user_input';
    return {
      attemptId: command.attemptId,
      providerResourceId,
      providerStatus: canonicalStatus,
      canonicalStatus,
      launch: this.launch(command.attemptId, canonicalStatus),
    };
  }

  async resumeAttempt(command: ProviderResourceCommand): Promise<ProviderLaunchEnvelope> {
    return this.launch(command.attemptId, 'pending_user_input');
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    this.throwIfErrorScenario();
    return {
      providerResourceId: command.providerResourceId,
      providerStatus: SCENARIO_STATUS[this.scenario],
      canonicalStatus: SCENARIO_STATUS[this.scenario],
      occurredAt: this.runtime.now().toISOString(),
      normalizedReasonCodes: [],
      safeMetadata: { source: 'fake', scenario: this.scenario },
    };
  }

  async retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    return this.createAttempt({ ...command, attemptId: `${command.attemptId}_retry` });
  }

  async cancelAttempt(_command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    return { accepted: true, providerStatus: 'canceled', canonicalStatus: 'canceled' };
  }

  async redactSubject(_command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    if (this.scenario === 'asynchronous_redaction') {
      return { completed: false, retryable: true, disposition: 'processing' };
    }
    return { completed: true, retryable: false, disposition: 'redacted' };
  }

  async verifyWebhook(): Promise<VerifiedWebhookEnvelope> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'The fake provider does not receive webhooks.', {
      safeCode: 'webhooks_not_supported',
    });
  }

  async normalizeWebhook(_input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'The fake provider does not receive webhooks.', {
      safeCode: 'webhooks_not_supported',
    });
  }

  private throwIfErrorScenario(): void {
    if (this.scenario === 'timeout') {
      throw new ProviderError('TIMEOUT', 'The fake provider timed out.', { retryable: true, safeCode: 'timeout' });
    }
    if (this.scenario === 'rate_limit') {
      throw new ProviderError('RATE_LIMITED', 'The fake provider is rate limited.', {
        retryable: true,
        safeCode: 'rate_limited',
        retryAfterSeconds: 30,
      });
    }
    if (this.scenario === 'retryable_provider_failure') {
      throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'The fake provider failed retryably.', {
        retryable: true,
        safeCode: 'retryable_provider_failure',
      });
    }
    if (this.scenario === 'malformed_response') {
      throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'The fake provider returned a malformed body.', {
        retryable: true,
        safeCode: 'malformed_provider_response',
      });
    }
    if (this.scenario === 'unknown_state') {
      throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'The fake provider returned an unknown state.', {
        retryable: false,
        safeCode: 'unknown_provider_status',
      });
    }
  }

  private launch(attemptId: string, canonicalStatus: VerificationCanonicalStatus): ProviderLaunchEnvelope {
    return {
      attemptId,
      canonicalStatus,
      launcherKey: 'test_embedded',
      presentation: 'embedded',
      providerDisclosure: 'Test provider',
      transientSecret: `test_launch_${attemptId.replace(/-/g, '')}`,
      transientSecretExpiresAt: new Date(this.runtime.now().getTime() + 5 * 60_000).toISOString(),
      continuationReference: `cont_${attemptId}`,
    };
  }
}

export function createFakeAdapterForScenario(scenario: FakeScenario): FakeVerificationAdapter {
  return new FakeVerificationAdapter(scenario);
}

/** Intentionally incomplete adapter used to assert diagnostic quality. */
export class IncompleteVerificationAdapter {
  readonly provider = 'incomplete_fixture';
  readonly environment = 'sandbox';
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = fakeProviderManifest;
  readonly runtime = createDefaultRuntime('sandbox', {}, { allowedHosts: ['127.0.0.1'] });

  validateConfiguration(): void {
    throw new ProviderError('INVALID_CONFIGURATION', 'Incomplete adapter is missing createAttempt, resumeAttempt, retrieveAttempt, retryAttempt, cancelAttempt, redactSubject, verifyWebhook, and normalizeWebhook.', {
      safeCode: 'missing_method_create_attempt',
    });
  }
}
