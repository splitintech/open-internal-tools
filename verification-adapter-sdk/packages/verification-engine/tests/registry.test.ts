import { describe, expect, it } from 'vitest';

import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';

import { createProviderRegistry } from '../src/registry.ts';

describe('provider registry', () => {
  it('registers only explicit compiled-in adapters', () => {
    const adapter = createFakeAdapterForScenario('input_required');
    const registry = createProviderRegistry({ adapters: [adapter] });
    expect(registry.has('test_fake')).toBe(true);
    expect(registry.has('stripe_identity')).toBe(false);
    expect(registry.get('test_fake').provider).toBe('test_fake');
    expect(() => registry.get('persona')).toThrow(/compiled-in adapter/i);
  });

  it('rejects an empty registry', () => {
    expect(() => createProviderRegistry({ adapters: [] })).toThrow(/at least one/i);
  });
});
