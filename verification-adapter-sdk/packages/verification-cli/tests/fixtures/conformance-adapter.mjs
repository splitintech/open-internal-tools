const manifest = Object.freeze({
  contractVersion: '1.0.0',
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
  configurationSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {},
  },
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

const SCENARIO_STATUS = {
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

class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.safeCode = options.safeCode ?? String(code).toLowerCase();
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

function createAdapter(scenario = 'input_required') {
  const resources = new Map();
  const now = () => new Date('2026-01-01T00:00:00.000Z');
  const launch = (attemptId, canonicalStatus) => ({
    attemptId,
    canonicalStatus,
    launcherKey: 'test_embedded',
    presentation: 'embedded',
    providerDisclosure: 'Test provider',
    transientSecret: `test_launch_${attemptId.replace(/-/g, '')}`,
    transientSecretExpiresAt: new Date(now().getTime() + 5 * 60_000).toISOString(),
    continuationReference: `cont_${attemptId}`,
  });
  const throwIfErrorScenario = () => {
    if (scenario === 'timeout') {
      throw new ProviderError('TIMEOUT', 'The fake provider timed out.', { retryable: true, safeCode: 'timeout' });
    }
    if (scenario === 'rate_limit') {
      throw new ProviderError('RATE_LIMITED', 'The fake provider is rate limited.', {
        retryable: true, safeCode: 'rate_limited', retryAfterSeconds: 30,
      });
    }
    if (scenario === 'retryable_provider_failure') {
      throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'The fake provider failed retryably.', {
        retryable: true, safeCode: 'retryable_provider_failure',
      });
    }
    if (scenario === 'malformed_response') {
      throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'The fake provider returned a malformed body.', {
        retryable: true, safeCode: 'malformed_provider_response',
      });
    }
    if (scenario === 'unknown_state') {
      throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'The fake provider returned an unknown state.', {
        retryable: false, safeCode: 'unknown_provider_status',
      });
    }
  };
  return {
    contractVersion: '1.0.0',
    manifest,
    provider: 'test_fake',
    environment: 'sandbox',
    validateConfiguration() {},
    async createAttempt(command) {
      const existing = resources.get(command.idempotencyKey);
      const providerResourceId = existing ?? `tfr_${String(command.attemptId).replace(/[^a-zA-Z0-9]/g, '')}`;
      resources.set(command.idempotencyKey, providerResourceId);
      const canonicalStatus = scenario === 'success' || scenario === 'verified' ? 'verified' : 'pending_user_input';
      return {
        attemptId: command.attemptId,
        providerResourceId,
        providerStatus: canonicalStatus,
        canonicalStatus,
        launch: launch(command.attemptId, canonicalStatus),
      };
    },
    async resumeAttempt(command) {
      return launch(command.attemptId, 'pending_user_input');
    },
    async retrieveAttempt(command) {
      throwIfErrorScenario();
      const canonicalStatus = SCENARIO_STATUS[scenario] ?? 'pending_user_input';
      return {
        providerResourceId: command.providerResourceId,
        providerStatus: canonicalStatus,
        canonicalStatus,
        occurredAt: now().toISOString(),
        normalizedReasonCodes: [],
        safeMetadata: { source: 'fake', scenario },
      };
    },
    async retryAttempt(command) {
      return this.createAttempt({ ...command, attemptId: `${command.attemptId}_retry` });
    },
    async cancelAttempt() {
      return { accepted: true, providerStatus: 'canceled', canonicalStatus: 'canceled' };
    },
    async redactSubject() {
      if (scenario === 'asynchronous_redaction') {
        return { completed: false, retryable: true, disposition: 'processing' };
      }
      return { completed: true, retryable: false, disposition: 'redacted' };
    },
    async verifyWebhook() {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'The fake provider does not receive webhooks.', {
        safeCode: 'webhooks_not_supported',
      });
    },
    async normalizeWebhook() {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'The fake provider does not receive webhooks.', {
        safeCode: 'webhooks_not_supported',
      });
    },
  };
}

export function createAdapterForScenario(scenario) {
  return createAdapter(scenario);
}

export { createAdapter };
export default createAdapter();
