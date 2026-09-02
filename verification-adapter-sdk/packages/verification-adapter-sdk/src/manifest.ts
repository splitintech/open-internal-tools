import { Ajv2020 } from 'ajv/dist/2020.js';

import type {
  ProviderManifestV1,
  ProviderRuntimeContext,
  VerificationAdapterV1,
} from './contracts.ts';
import { ProviderError } from './errors.ts';
import {
  ENGINE_CONTRACT_VERSION,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  isCountryCode,
  isCustomPackageCode,
  isLauncherKey,
  isPackageCode,
  isProviderCode,
  isSemver,
  isStandardPackageCode,
  isWebhookProtocol,
  majorsCompatible,
} from './identifiers.ts';
import { providerManifestV1JsonSchema } from './schema.ts';

const manifestValidator = new Ajv2020({ allErrors: true, strict: false }).compile(providerManifestV1JsonSchema);

export const REQUIRED_ADAPTER_METHODS = [
  'validateConfiguration',
  'createAttempt',
  'resumeAttempt',
  'retrieveAttempt',
  'retryAttempt',
  'cancelAttempt',
  'redactSubject',
  'verifyWebhook',
  'normalizeWebhook',
] as const;

export function defineProviderManifest(input: ProviderManifestV1): Readonly<ProviderManifestV1> {
  assertProviderManifest(input);
  return deepFreeze(JSON.parse(JSON.stringify(input)) as ProviderManifestV1);
}

export function assertProviderManifest(manifest: ProviderManifestV1): void {
  if (!manifestValidator(manifest)) {
    const first = manifestValidator.errors?.[0];
    invalid(
      `json_schema_${toSafeCode(first?.keyword ?? 'invalid')}`,
      `The provider adapter manifest does not satisfy ProviderManifestV1 JSON Schema at ${first?.instancePath || '/'}.`,
    );
  }
  if (manifest.contractVersion !== VERIFICATION_ADAPTER_CONTRACT_VERSION) invalid('contract_version');
  if (!isProviderCode(manifest.provider)) invalid('provider_code');
  if (!manifest.displayName.trim() || !isSemver(manifest.adapterVersion) || !isSemver(manifest.engineCompatibility)) {
    invalid('identity');
  }
  if (!majorsCompatible(manifest.adapterVersion, VERIFICATION_ADAPTER_CONTRACT_VERSION)) {
    invalid('adapter_version_incompatible', 'Provider adapter major version must be compatible with contract V1.');
  }
  if (!majorsCompatible(manifest.engineCompatibility, ENGINE_CONTRACT_VERSION)) {
    invalid('engine_incompatible', 'Provider adapter is not compatible with this engine major version.');
  }
  if (!manifest.supportedPackages.length || manifest.supportedPackages.some((value) => !isPackageCode(value))) {
    invalid('supported_packages');
  }
  if (manifest.supportedPackages.some((value) => !isStandardPackageCode(value) && !isCustomPackageCode(value))) {
    invalid('supported_packages');
  }
  if (!manifest.supportedCountries.length || manifest.supportedCountries.some((value) => !isCountryCode(value))) {
    invalid('supported_countries');
  }
  if (!manifest.launcherKeys.length || manifest.launcherKeys.some((value) => !isLauncherKey(value))) {
    invalid('launcher_keys');
  }
  if (!isWebhookProtocol(manifest.webhook.protocol)) invalid('webhook_protocol');
  if (!manifest.apiHosts.length || manifest.apiHosts.some((host) => host.includes('/') || host.includes(':'))) {
    invalid('api_hosts', 'Provider API hosts must be code-owned hostnames, not URLs or caller-supplied origins.');
  }
  if (manifest.dataPolicy.rawPayloadPersistence !== false
    || manifest.dataPolicy.browserSecretPersistence !== false
    || manifest.dataPolicy.governmentIdentifierPersistence !== false) {
    invalid('data_policy');
  }
  if (manifest.capabilities.canCancel !== manifest.cancellation.supported) invalid('cancellation_capability');
  if (manifest.capabilities.canRedact !== manifest.redaction.supported) invalid('redaction_capability');
  assertConfigurationSecrets(manifest);
}

function assertConfigurationSecrets(manifest: ProviderManifestV1): void {
  const properties = manifest.configurationSchema.properties ?? {};
  for (const [name, schema] of Object.entries(properties)) {
    if (schema['x-secret'] === true && schema.type !== 'string') {
      invalid('secret_schema', `Configuration field "${name}" marked x-secret must be a string.`);
    }
  }
}

export function assertAdapterConformsToManifest(adapter: VerificationAdapterV1): void {
  const candidate = adapter as unknown as Record<string, unknown>;
  const provider = typeof candidate.provider === 'string' && candidate.provider ? candidate.provider : 'unknown';
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
  if (adapter.manifest.capabilities.canResume === false && typeof candidate.resumeAttempt !== 'function') {
    invalid('resume_capability');
  }
  adapter.validateConfiguration();
}

export function createAllowlistedHttp(
  allowedHosts: readonly string[],
  fetchImpl: typeof fetch,
  timeoutMs = 10_000,
): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } {
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  return {
    async fetch(input, init) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        throw new ProviderError('INVALID_CONFIGURATION', 'Provider HTTP is limited to HTTPS or loopback.', {
          safeCode: 'http_origin_denied',
        });
      }
      if (!hosts.has(url.hostname.toLowerCase())) {
        throw new ProviderError('INVALID_CONFIGURATION', 'Provider HTTP origin is not allowlisted in the adapter manifest.', {
          safeCode: 'http_origin_denied',
        });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const parentSignal = init?.signal;
        if (parentSignal) {
          if (parentSignal.aborted) controller.abort();
          else parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return await fetchImpl(input, { ...init, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ProviderError('TIMEOUT', 'The provider HTTP request timed out.', { retryable: true, safeCode: 'timeout' });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createDefaultRuntime<T extends object>(
  environment: ProviderRuntimeContext<T>['environment'],
  configuration: T,
  options: Partial<ProviderRuntimeContext<T>> & { allowedHosts?: string[] } = {},
): ProviderRuntimeContext<T> {
  const fetchImpl = options.http?.fetch ?? fetch;
  return {
    environment,
    configuration: Object.freeze({ ...configuration }),
    http: options.http ?? createAllowlistedHttp(options.allowedHosts ?? ['127.0.0.1'], fetchImpl),
    now: options.now ?? (() => new Date()),
    crypto: options.crypto ?? globalThis.crypto,
    idempotency: options.idempotency ?? {
      keyFor: (operation, attemptId, suppliedKey) => suppliedKey ?? `${operation}:${attemptId}`,
    },
    logger: options.logger ?? silentLogger,
    telemetry: options.telemetry,
    recordHealth: options.recordHealth ?? (async () => undefined),
    rateBudget: options.rateBudget,
  };
}

export const silentLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

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
