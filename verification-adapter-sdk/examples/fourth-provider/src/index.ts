import {
  ProviderError,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  createDefaultRuntime,
  defineProviderManifest,
  emptyConfigurationSchema,
} from '@splitin/verification-adapter-sdk';
import type {
  NormalizedProviderEvent,
  NormalizedProviderSnapshot,
  ProviderAttemptCommand,
  ProviderAttemptResult,
  ProviderLaunchEnvelope,
  ProviderOperationResult,
  ProviderRedactionCommand,
  ProviderRedactionResult,
  ProviderResourceCommand,
  ProviderRetryCommand,
  ProviderRuntimeContext,
  VerificationAdapterV1,
  VerifiedWebhookEnvelope,
} from '@splitin/verification-adapter-sdk';

export const CUSTOM_PACKAGE = 'com.example.employee_check';

export const employeeCheckManifest = defineProviderManifest({
  contractVersion: VERIFICATION_ADAPTER_CONTRACT_VERSION,
  adapterVersion: '1.0.0',
  engineCompatibility: '1.0.0',
  provider: 'example_employee_check',
  displayName: 'Example Employee Check',
  supportedPackages: [CUSTOM_PACKAGE],
  supportedCountries: ['US'],
  environments: ['sandbox'],
  capabilities: {
    presentations: ['hosted'],
    canResume: true,
    canRetry: true,
    canCancel: true,
    canRedact: true,
  },
  launcherKeys: ['hosted'],
  launchPresentations: ['hosted'],
  configurationSchemaVersion: 'urn:example:employee-check:config:v1',
  configurationSchema: emptyConfigurationSchema,
  webhook: { protocol: 'none', eventFamilies: ['employee_check'] },
  dataPolicy: {
    classifications: ['normalized_status'],
    prohibitedPersistence: ['raw_webhook', 'launch_secret', 'document', 'selfie'],
    rawPayloadPersistence: false,
    browserSecretPersistence: false,
    governmentIdentifierPersistence: false,
  },
  retry: { sameResourceWhenResumable: true, newAttemptAfterTerminal: true },
  cancellation: { supported: true, terminal: true },
  redaction: { supported: true, asynchronous: false },
  apiHosts: ['127.0.0.1'],
  testedApiVersions: ['example-1'],
});

export class EmployeeCheckAdapter implements VerificationAdapterV1<Record<string, never>> {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = employeeCheckManifest;
  readonly provider = 'example_employee_check';
  readonly environment = 'sandbox' as const;
  readonly runtime: ProviderRuntimeContext<Record<string, never>>;

  constructor(runtime?: ProviderRuntimeContext<Record<string, never>>) {
    this.runtime = runtime ?? createDefaultRuntime('sandbox', {}, { allowedHosts: ['127.0.0.1'] });
  }

  validateConfiguration(): void {
    if (this.runtime.environment !== 'sandbox') {
      throw new ProviderError('INVALID_CONFIGURATION', 'This example plugin is sandbox-only.');
    }
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    if (command.packageCode !== CUSTOM_PACKAGE) {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Unsupported package for this plugin.');
    }
    const providerResourceId = `eec_${command.attemptId.replace(/[^a-zA-Z0-9]/g, '')}`;
    return {
      attemptId: command.attemptId,
      providerResourceId,
      providerStatus: 'pending_user_input',
      canonicalStatus: 'pending_user_input',
      launch: this.launch(command.attemptId),
    };
  }

  async resumeAttempt(command: ProviderResourceCommand): Promise<ProviderLaunchEnvelope> {
    return this.launch(command.attemptId);
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    return {
      providerResourceId: command.providerResourceId,
      providerStatus: 'pending_user_input',
      canonicalStatus: 'pending_user_input',
      occurredAt: this.runtime.now().toISOString(),
      normalizedReasonCodes: [],
      safeMetadata: { package: CUSTOM_PACKAGE },
    };
  }

  async retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    return this.createAttempt({ ...command, attemptId: `${command.attemptId}_retry` });
  }

  async cancelAttempt(): Promise<ProviderOperationResult> {
    return { accepted: true, providerStatus: 'canceled', canonicalStatus: 'canceled' };
  }

  async redactSubject(_command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    return { completed: true, retryable: false, disposition: 'redacted' };
  }

  async verifyWebhook(): Promise<VerifiedWebhookEnvelope> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'No webhooks.', { safeCode: 'webhooks_not_supported' });
  }

  async normalizeWebhook(_input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'No webhooks.', { safeCode: 'webhooks_not_supported' });
  }

  private launch(attemptId: string): ProviderLaunchEnvelope {
    return {
      attemptId,
      canonicalStatus: 'pending_user_input',
      launcherKey: 'hosted',
      presentation: 'hosted',
      hostedUrl: 'https://127.0.0.1/example-employee-check',
      continuationReference: `cont_${attemptId}`,
    };
  }
}

async function main(): Promise<void> {
  const adapter = new EmployeeCheckAdapter();
  adapter.validateConfiguration();
  const created = await adapter.createAttempt({
    attemptId: 'att_fourth_demo',
    subjectReference: 'sub_opaque_fourth',
    packageCode: CUSTOM_PACKAGE,
    countryCode: 'US',
    idempotencyKey: 'idem_fourth_demo',
    configurationRevision: 'cfg_sandbox',
  });
  process.stdout.write(`${created.canonicalStatus} ${created.providerResourceId}\n`);
}

if (process.argv[1]?.includes('fourth-provider') && !process.argv[1]?.includes('conformance')) {
  void main();
}
