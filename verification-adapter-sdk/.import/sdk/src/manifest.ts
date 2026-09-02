import { Ajv2020 } from 'ajv/dist/2020.js';

import {
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  type ProviderConfigurationSchemaV2,
  type ProviderManifestV2,
  type VerificationAdapterV2,
  type VerificationPackageCode,
} from './contracts.ts';
import { ProviderError } from './errors.ts';
import { providerManifestV2JsonSchema } from './schema.ts';

const PACKAGE_CODES = new Set<VerificationPackageCode>([
  'human_idv',
  'ownership_review',
  'business_kyb',
  'associated_person_idv',
]);
const PRESENTATIONS = new Set(['embedded', 'hosted', 'qr', 'none']);
const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,127}$/;
const PROVIDER_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const manifestSchemaValidator = new Ajv2020({ allErrors: true, strict: true })
  .compile(providerManifestV2JsonSchema);
const REQUIRED_ADAPTER_METHODS = [
  'validateConfiguration',
  'capabilities',
  'createAttempt',
  'resumeAttempt',
  'retrieveAttempt',
  'reconcileAttempt',
  'requestRetry',
  'cancelAttempt',
  'redactSubject',
  'verifyWebhook',
  'normalizeWebhook',
] as const;

export type ProviderManifestInputV2 = Omit<ProviderManifestV2, 'configurationSchema'> & {
  configurationSchema?: ProviderConfigurationSchemaV2;
};

export function defineProviderManifest(input: ProviderManifestInputV2): Readonly<ProviderManifestV2> {
  const manifest: ProviderManifestV2 = {
    ...input,
    configurationSchema: input.configurationSchema ?? buildConfigurationSchema(
      input.requiredSecretNames,
      input.optionalSecretNames,
    ),
  };
  assertProviderManifest(manifest);
  // JSON-safe manifests are deliberately cloneable in Deno, Node and the
  // repository's older Jest VM without depending on structuredClone.
  return deepFreeze(JSON.parse(JSON.stringify(manifest)) as ProviderManifestV2);
}

export function assertProviderManifest(manifest: ProviderManifestV2): void {
  if (!manifestSchemaValidator(manifest)) {
    const first = manifestSchemaValidator.errors?.[0];
    invalid(
      `json_schema_${toSafeCode(first?.keyword ?? 'invalid')}`,
      `The provider adapter manifest does not satisfy ProviderManifestV2 JSON Schema at ${first?.instancePath || '/'}.`,
    );
  }
  if (manifest.contractVersion !== VERIFICATION_ADAPTER_CONTRACT_VERSION) invalid('contract_version');
  if (!PROVIDER_CODE.test(manifest.provider)) invalid('provider_code');
  if (!manifest.displayName.trim() || !SEMVER.test(manifest.adapterVersion)) invalid('identity');
  if (Number.parseInt(manifest.adapterVersion.split('.')[0] ?? '', 10) !== 2) {
    invalid('adapter_version_incompatible', 'Provider adapter major version must be compatible with contract V2.');
  }
  if (!manifest.supportedPackages.length || manifest.supportedPackages.some((value) => !PACKAGE_CODES.has(value))) {
    invalid('supported_packages');
  }
  if (!manifest.supportedCountries.length || manifest.supportedCountries.some((value) => !/^[A-Z]{2}$/.test(value))) {
    invalid('supported_countries');
  }
  if (!manifest.environments.length || manifest.environments.some((value) => value !== 'sandbox' && value !== 'production')) {
    invalid('environments');
  }
  if (!manifest.capabilities.presentations.length
    || manifest.capabilities.presentations.some((value) => !PRESENTATIONS.has(value))) {
    invalid('presentations');
  }
  if (!manifest.launcherKeys.length || manifest.launcherKeys.some((value) => !PROVIDER_CODE.test(value))) {
    invalid('launcher_keys');
  }
  if ([...manifest.requiredSecretNames, ...manifest.optionalSecretNames].some((value) => !SECRET_NAME.test(value))) {
    invalid('secret_names');
  }
  const requiredSecrets = new Set(manifest.requiredSecretNames);
  const optionalSecrets = new Set(manifest.optionalSecretNames);
  if (requiredSecrets.size !== manifest.requiredSecretNames.length
    || optionalSecrets.size !== manifest.optionalSecretNames.length
    || manifest.requiredSecretNames.some((name) => optionalSecrets.has(name))) {
    invalid('duplicate_secrets');
  }
  const schemaKeys = new Set(Object.keys(manifest.configurationSchema.properties));
  const requiredConfiguration = new Set(manifest.configurationSchema.required);
  if (manifest.configurationSchema.type !== 'object'
    || manifest.configurationSchema.additionalProperties !== false
    || requiredConfiguration.size !== manifest.configurationSchema.required.length
    || manifest.configurationSchema.required.some((name) => !schemaKeys.has(name))
    || Object.values(manifest.configurationSchema.properties).some((property) => (
      property.type !== 'string'
      || !Number.isSafeInteger(property.minLength)
      || property.minLength < 1
      || typeof property.sensitive !== 'boolean'
    ))) {
    invalid('configuration_schema');
  }
  for (const name of Array.from(requiredSecrets)) {
    if (!schemaKeys.has(name)
      || manifest.configurationSchema.properties[name]?.sensitive !== true
      || !requiredConfiguration.has(name)) {
      invalid('required_secret_schema');
    }
  }
  for (const name of Array.from(optionalSecrets)) {
    if (!schemaKeys.has(name)
      || manifest.configurationSchema.properties[name]?.sensitive !== true
      || requiredConfiguration.has(name)) {
      invalid('optional_secret_schema');
    }
  }
  if (manifest.dataPolicy.rawPayloadPersistence !== false || manifest.dataPolicy.browserSecretPersistence !== false) {
    invalid('data_policy');
  }
  const declared = new Set(manifest.capabilities.presentations);
  if (manifest.launcherKeys.includes('hosted') && !declared.has('hosted')) invalid('hosted_capability');
}

function buildConfigurationSchema(required: string[], optional: string[]): ProviderConfigurationSchemaV2 {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required],
    properties: Object.fromEntries(
      [...required, ...optional].map((name) => [name, { type: 'string' as const, minLength: 1, sensitive: true }]),
    ),
  };
}

export function assertAdapterConformsToManifest(adapter: VerificationAdapterV2): void {
  const candidate = adapter as unknown as Record<string, unknown>;
  const provider = typeof candidate.provider === 'string' && candidate.provider
    ? candidate.provider
    : 'unknown';
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof candidate[method] !== 'function') {
      invalid(
        `missing_method_${toSafeCode(method)}`,
        `Provider adapter "${provider}" is missing required method "${method}".`,
      );
    }
  }
  if (!candidate.manifest || typeof candidate.manifest !== 'object') {
    invalid('missing_manifest', `Provider adapter "${provider}" is missing its manifest.`);
  }
  assertProviderManifest(adapter.manifest);
  if (adapter.contractVersion !== VERIFICATION_ADAPTER_CONTRACT_VERSION
    || adapter.provider !== adapter.manifest.provider
    || !adapter.manifest.environments.includes(adapter.environment)) {
    invalid('adapter_identity', `Provider adapter "${provider}" does not match its manifest identity or environment.`);
  }
  const actual = adapter.capabilities();
  const expected = adapter.manifest.capabilities;
  if (!actual || !Array.isArray(actual.presentations)) {
    invalid('adapter_capabilities_shape', `Provider adapter "${provider}" returned an invalid capability description.`);
  }
  for (const capability of ['canResume', 'canRetry', 'canCancel', 'canRedact'] as const) {
    if (actual[capability] !== expected[capability]) {
      invalid(
        `adapter_capability_${toSafeCode(capability)}`,
        `Provider adapter "${provider}" capability "${capability}" is ${String(actual[capability])}; the manifest declares ${String(expected[capability])}.`,
      );
    }
  }
  const actualPresentations = Array.from(new Set(actual.presentations)).sort();
  const expectedPresentations = Array.from(new Set(expected.presentations)).sort();
  if (JSON.stringify(actualPresentations) !== JSON.stringify(expectedPresentations)) {
    invalid(
      'adapter_capability_presentations',
      `Provider adapter "${provider}" presentations do not match its manifest.`,
    );
  }
  adapter.validateConfiguration();
}

function invalid(safeCode: string, message = 'The provider adapter manifest is invalid.'): never {
  throw new ProviderError('INVALID_CONFIGURATION', message, { safeCode });
}

function toSafeCode(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
