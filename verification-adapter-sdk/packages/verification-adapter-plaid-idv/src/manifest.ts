import {
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  defineProviderManifest,
  plainStringProperty,
  secretStringProperty,
  type ProviderManifestV1,
} from '@splitin/verification-adapter-sdk';

import { PLAID_API_VERSION, PLAID_PRODUCTION_HOST, PLAID_SANDBOX_HOST } from './constants.ts';

export const plaidIdvProviderManifest: Readonly<ProviderManifestV1> = defineProviderManifest({
  contractVersion: VERIFICATION_ADAPTER_CONTRACT_VERSION,
  adapterVersion: '1.0.0',
  engineCompatibility: '1.0.0',
  provider: 'plaid',
  displayName: 'Plaid Identity Verification',
  description: 'Plaid Identity Verification only. Auth, Identity (non-IDV), Monitor, and payments are out of scope. Redaction is not applicable; Plaid does not expose an IDV redaction API.',
  supportedPackages: ['human_idv'],
  supportedCountries: ['US'],
  environments: ['sandbox', 'production'],
  capabilities: {
    presentations: ['embedded', 'hosted'],
    canResume: true,
    canRetry: true,
    canCancel: false,
    canRedact: false,
  },
  launcherKeys: ['plaid_link', 'hosted'],
  launchPresentations: ['embedded', 'hosted'],
  configurationSchemaVersion: 'urn:splitin:verification:config:plaid-idv:v1',
  configurationSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['clientId', 'secret', 'templateId', 'clientName'],
    properties: {
      clientId: secretStringProperty(),
      secret: secretStringProperty(),
      templateId: plainStringProperty(),
      clientName: plainStringProperty(),
      webhookUrl: { type: 'string', format: 'uri', 'x-secret': false },
    },
  },
  webhook: {
    protocol: 'plaid_es256_jwk',
    eventFamilies: ['IDENTITY_VERIFICATION'],
    toleranceSeconds: 300,
  },
  dataPolicy: {
    classifications: ['provider_resource_id', 'normalized_status', 'reason_codes'],
    prohibitedPersistence: ['raw_webhook', 'launch_secret', 'document', 'selfie', 'link_token'],
    rawPayloadPersistence: false,
    browserSecretPersistence: false,
    governmentIdentifierPersistence: false,
  },
  retry: { sameResourceWhenResumable: true, newAttemptAfterTerminal: true },
  cancellation: { supported: false, terminal: true },
  redaction: { supported: false, asynchronous: false, notApplicable: true },
  apiHosts: [PLAID_SANDBOX_HOST, PLAID_PRODUCTION_HOST],
  testedApiVersions: [PLAID_API_VERSION],
});
