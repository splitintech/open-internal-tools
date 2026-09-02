import { join } from 'node:path';

import { writeText } from './config.ts';

export const SCAFFOLD_PACKAGE = 'com.example.employee_check';
export const SCAFFOLD_PROVIDER = 'example_employee_check';

export function scaffoldProvider(cwd: string, directory = `adapters/${SCAFFOLD_PROVIDER}`): string {
  const root = join(cwd, directory);
  writeText(join(root, 'package.json'), `${JSON.stringify({
    name: `@example/${SCAFFOLD_PROVIDER}`,
    version: '0.1.0-beta.0',
    private: true,
    type: 'module',
    license: 'MIT',
    description: `Fourth-party verification adapter stub for ${SCAFFOLD_PACKAGE}.`,
    main: './src/index.ts',
    dependencies: {
      '@splitin/verification-adapter-sdk': '0.1.0-beta.0',
    },
  }, null, 2)}\n`);
  writeText(join(root, 'README.md'), `# Example employee-check adapter

Fourth-party adapter stub. Package code: \`${SCAFFOLD_PACKAGE}\`.

This adapter is sandbox-only. Production routes stay disabled until you run
\`splitin-verification provider conformance\` against a non-billable fake or
sandbox fixture.

\`\`\`ts
import { ExampleEmployeeCheckAdapter } from './src/index.ts';
\`\`\`
`);
  writeText(join(root, 'src/manifest.ts'), `import {
  defineProviderManifest,
  emptyConfigurationSchema,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
} from '@splitin/verification-adapter-sdk';

export const exampleEmployeeCheckManifest = defineProviderManifest({
  contractVersion: VERIFICATION_ADAPTER_CONTRACT_VERSION,
  adapterVersion: '1.0.0',
  engineCompatibility: '1.0.0',
  provider: '${SCAFFOLD_PROVIDER}',
  displayName: 'Example Employee Check',
  description: 'Fourth-party adapter stub. Replace the retrieve mapping before production.',
  supportedPackages: ['${SCAFFOLD_PACKAGE}'],
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
`);
  writeText(join(root, 'src/index.ts'), `import type {
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
import {
  ProviderError,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  createDefaultRuntime,
} from '@splitin/verification-adapter-sdk';
import { exampleEmployeeCheckManifest } from './manifest.ts';

export class ExampleEmployeeCheckAdapter implements VerificationAdapterV1<Record<string, never>> {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = exampleEmployeeCheckManifest;
  readonly provider = '${SCAFFOLD_PROVIDER}';
  readonly environment = 'sandbox' as const;
  readonly runtime: ProviderRuntimeContext<Record<string, never>>;

  constructor(runtime?: ProviderRuntimeContext<Record<string, never>>) {
    this.runtime = runtime ?? createDefaultRuntime('sandbox', {}, { allowedHosts: ['127.0.0.1'] });
  }

  validateConfiguration(): void {
    if (this.runtime.environment !== 'sandbox') {
      throw new ProviderError('INVALID_CONFIGURATION', 'The example adapter is sandbox-only.');
    }
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    if (command.packageCode !== '${SCAFFOLD_PACKAGE}') {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'This adapter only serves ${SCAFFOLD_PACKAGE}.');
    }
    const providerResourceId = \`eec_\${command.attemptId.replace(/[^a-zA-Z0-9]/g, '')}\`;
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
      safeMetadata: { package: '${SCAFFOLD_PACKAGE}' },
    };
  }

  async retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    return this.createAttempt({ ...command, attemptId: \`\${command.attemptId}_retry\` });
  }

  async cancelAttempt(): Promise<ProviderOperationResult> {
    return { accepted: true, providerStatus: 'canceled', canonicalStatus: 'canceled' };
  }

  async redactSubject(_command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    return { completed: true, retryable: false, disposition: 'redacted' };
  }

  async verifyWebhook(): Promise<VerifiedWebhookEnvelope> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'This stub does not receive webhooks.', {
      safeCode: 'webhooks_not_supported',
    });
  }

  async normalizeWebhook(_input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'This stub does not receive webhooks.', {
      safeCode: 'webhooks_not_supported',
    });
  }

  private launch(attemptId: string): ProviderLaunchEnvelope {
    return {
      attemptId,
      canonicalStatus: 'pending_user_input',
      launcherKey: 'hosted',
      presentation: 'hosted',
      hostedUrl: 'https://127.0.0.1/example-employee-check',
      continuationReference: \`cont_\${attemptId}\`,
    };
  }
}
`);
  return root;
}
