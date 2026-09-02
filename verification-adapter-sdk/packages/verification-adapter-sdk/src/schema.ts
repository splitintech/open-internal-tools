import type { ProviderConfigurationSchemaV1 } from './contracts.ts';
import { PROVIDER_MANIFEST_SCHEMA_URN } from './identifiers.ts';

export const providerManifestV1JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: PROVIDER_MANIFEST_SCHEMA_URN,
  title: 'Verification Provider Manifest V1',
  type: 'object',
  additionalProperties: false,
  required: [
    'contractVersion', 'adapterVersion', 'engineCompatibility', 'provider', 'displayName',
    'supportedPackages', 'supportedCountries', 'environments', 'capabilities', 'launcherKeys',
    'launchPresentations', 'configurationSchemaVersion', 'configurationSchema', 'webhook',
    'dataPolicy', 'retry', 'cancellation', 'redaction', 'apiHosts', 'testedApiVersions',
  ],
  properties: {
    contractVersion: { const: '1.0.0' },
    adapterVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
    engineCompatibility: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
    provider: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
    displayName: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    supportedPackages: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: {
        type: 'string',
        anyOf: [
          { enum: ['human_idv', 'business_kyb', 'associated_person_idv', 'ownership_review'] },
          { pattern: '^[a-z0-9][a-z0-9-]{0,32}(?:\\.[a-z0-9][a-z0-9_-]{0,63}){1,6}$' },
        ],
      },
    },
    supportedCountries: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^[A-Z]{2}$' } },
    environments: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['sandbox', 'production'] } },
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['presentations', 'canResume', 'canRetry', 'canCancel', 'canRedact'],
      properties: {
        presentations: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['embedded', 'hosted', 'qr', 'none'] } },
        canResume: { type: 'boolean' },
        canRetry: { type: 'boolean' },
        canCancel: { type: 'boolean' },
        canRedact: { type: 'boolean' },
      },
    },
    launcherKeys: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' } },
    launchPresentations: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['embedded', 'hosted', 'qr', 'none'] } },
    configurationSchemaVersion: { type: 'string', minLength: 1 },
    configurationSchema: { $ref: '#/$defs/jsonSchema2020' },
    webhook: {
      type: 'object',
      additionalProperties: false,
      required: ['protocol', 'eventFamilies'],
      properties: {
        protocol: { type: 'string', minLength: 1, maxLength: 128 },
        eventFamilies: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        toleranceSeconds: { type: 'integer', minimum: 1 },
      },
    },
    dataPolicy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'classifications', 'prohibitedPersistence', 'rawPayloadPersistence',
        'browserSecretPersistence', 'governmentIdentifierPersistence',
      ],
      properties: {
        classifications: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        prohibitedPersistence: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        rawPayloadPersistence: { const: false },
        browserSecretPersistence: { const: false },
        governmentIdentifierPersistence: { const: false },
      },
    },
    retry: {
      type: 'object',
      additionalProperties: false,
      required: ['sameResourceWhenResumable', 'newAttemptAfterTerminal'],
      properties: {
        sameResourceWhenResumable: { type: 'boolean' },
        newAttemptAfterTerminal: { type: 'boolean' },
      },
    },
    cancellation: {
      type: 'object',
      additionalProperties: false,
      required: ['supported', 'terminal'],
      properties: { supported: { type: 'boolean' }, terminal: { type: 'boolean' } },
    },
    redaction: {
      type: 'object',
      additionalProperties: false,
      required: ['supported', 'asynchronous'],
      properties: {
        supported: { type: 'boolean' },
        asynchronous: { type: 'boolean' },
        notApplicable: { type: 'boolean' },
      },
    },
    apiHosts: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z0-9.-]+$' },
    },
    testedApiVersions: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
  },
  $defs: {
    jsonSchema2020: {
      type: 'object',
      required: ['$schema', 'type', 'additionalProperties', 'required', 'properties'],
      properties: {
        $schema: { const: 'https://json-schema.org/draft/2020-12/schema' },
        type: { const: 'object' },
        additionalProperties: { const: false },
        required: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        properties: { type: 'object' },
      },
    },
  },
} as const;

export const emptyConfigurationSchema: ProviderConfigurationSchemaV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [],
  properties: {},
};

export function secretStringProperty(minLength = 1): import('./contracts.ts').JsonSchema2020 {
  return { type: 'string', minLength, 'x-secret': true };
}

export function plainStringProperty(minLength = 1): import('./contracts.ts').JsonSchema2020 {
  return { type: 'string', minLength, 'x-secret': false };
}
