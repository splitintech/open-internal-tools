import {
  assertAdapterConformsToManifest,
  type VerificationAdapterV1,
  type VerificationProviderCode,
  type VerificationProviderEnvironment,
} from '@splitin/verification-adapter-sdk';

import { EngineError } from './errors.ts';

export interface ProviderRegistry {
  get(provider: VerificationProviderCode, environment?: VerificationProviderEnvironment): VerificationAdapterV1;
  list(): VerificationAdapterV1[];
  has(provider: VerificationProviderCode): boolean;
}

/**
 * Explicit code imports only. Database rows cannot load packages.
 */
export function createProviderRegistry(input: { adapters: VerificationAdapterV1[] }): ProviderRegistry {
  if (!input.adapters.length) {
    throw new EngineError('INVALID_COMMAND', 'A verification provider registry requires at least one compiled-in adapter.');
  }
  const adapters = new Map<string, VerificationAdapterV1>();
  for (const adapter of input.adapters) {
    assertAdapterConformsToManifest(adapter);
    const key = registryKey(adapter.provider, adapter.environment);
    if (adapters.has(key)) {
      throw new EngineError('INVALID_COMMAND', `Duplicate compiled-in adapter for ${key}.`);
    }
    adapters.set(key, adapter);
  }
  return {
    get(provider, environment) {
      if (environment) {
        const exact = adapters.get(registryKey(provider, environment));
        if (exact) return exact;
      }
      const match = [...adapters.values()].find((adapter) => adapter.provider === provider
        && (!environment || adapter.environment === environment));
      if (!match) {
        throw new EngineError('NO_ELIGIBLE_ROUTE', `No compiled-in adapter is registered for provider "${provider}".`);
      }
      return match;
    },
    list: () => [...adapters.values()],
    has: (provider) => [...adapters.values()].some((adapter) => adapter.provider === provider),
  };
}

export function registryKey(provider: string, environment: string): string {
  return `${provider}:${environment}`;
}
