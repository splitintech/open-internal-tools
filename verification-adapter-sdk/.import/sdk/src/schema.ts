/** Machine-readable public shape used by CI and adapter authors. */
export const providerManifestV2JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://splitin.net/schemas/verification/provider-manifest-v2.json',
  title: 'SplitIn Verification Provider Manifest V2',
  type: 'object',
  additionalProperties: false,
  required: [
    'contractVersion', 'provider', 'displayName', 'adapterVersion', 'supportedPackages',
    'supportedCountries', 'environments', 'capabilities', 'launcherKeys',
    'requiredSecretNames', 'optionalSecretNames', 'configurationSchemaVersion',
    'configurationSchema', 'webhook', 'dataPolicy', 'retry',
  ],
  properties: {
    contractVersion: { const: '2.0.0' },
    provider: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
    displayName: { type: 'string', minLength: 1 },
    adapterVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
    supportedPackages: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['human_idv', 'ownership_review', 'business_kyb', 'associated_person_idv'] } },
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
    requiredSecretNames: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{2,127}$' } },
    optionalSecretNames: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{2,127}$' } },
    configurationSchemaVersion: { type: 'string', minLength: 1 },
    configurationSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'additionalProperties', 'required', 'properties'],
      properties: {
        type: { const: 'object' },
        additionalProperties: { const: false },
        required: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        properties: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'minLength', 'sensitive'],
            properties: {
              type: { const: 'string' },
              minLength: { type: 'integer', minimum: 1 },
              sensitive: { type: 'boolean' },
            },
          },
        },
      },
    },
    webhook: {
      type: 'object',
      additionalProperties: false,
      required: ['authentication', 'eventTypes'],
      properties: {
        authentication: { enum: ['plaid_es256_jwk', 'persona_hmac_sha256', 'stripe_v1_hmac', 'none'] },
        eventTypes: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        toleranceSeconds: { type: 'integer', minimum: 1 },
      },
    },
    dataPolicy: {
      type: 'object',
      additionalProperties: false,
      required: ['prefillAllowlist', 'persistedDataClasses', 'rawPayloadPersistence', 'browserSecretPersistence'],
      properties: {
        prefillAllowlist: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        persistedDataClasses: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        rawPayloadPersistence: { const: false },
        browserSecretPersistence: { const: false },
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
  },
} as const;
