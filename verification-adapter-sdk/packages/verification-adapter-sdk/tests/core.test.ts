import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  CANONICAL_STATUSES,
  IncompleteVerificationAdapter,
  assertAdapterConformsToManifest,
  assertPackageCode,
  canonicalStatusRank,
  createFakeAdapterForScenario,
  fakeProviderManifest,
  isCanonicalStatus,
  isCustomPackageCode,
  isOpaqueSubjectReference,
  isPackageCode,
  isStandardPackageCode,
  metadataContainsForbiddenIdentifier,
  providerConformanceScenarios,
  runAdapterConformance,
  runAdapterConformanceScenarios,
  validateManifestOnly,
} from '../src/index.ts';

const command = {
  attemptId: 'att_1234567890',
  subjectReference: 'sub_opaque_9f3a2c1d',
  packageCode: 'human_idv' as const,
  countryCode: 'US',
  idempotencyKey: 'idem_create_1',
  configurationRevision: 'cfg_1',
};

const fcOpts = { numRuns: 48, timeout: 1500 } as const;

describe('core SDK', () => {
  it('validates the fake manifest and custom packages without core edits', () => {
    expect(validateManifestOnly(fakeProviderManifest).passed).toBe(true);
    expect(isStandardPackageCode('human_idv')).toBe(true);
    expect(isCustomPackageCode('com.example.employee_check')).toBe(true);
    expect(isPackageCode('com.example.employee_check')).toBe(true);
    expect(() => assertPackageCode('not a package')).toThrow();
  });

  it('runs lifecycle conformance against the fake adapter', async () => {
    const adapter = createFakeAdapterForScenario('input_required');
    const results = await runAdapterConformance(adapter, command);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.some((result) => result.name === 'terminal_monotonicity')).toBe(true);
  });

  it('certifies every published fake scenario', async () => {
    const results = await runAdapterConformanceScenarios(
      (scenario) => createFakeAdapterForScenario(scenario),
      command,
    );
    expect(results.map((result) => result.name)).toEqual([...providerConformanceScenarios]);
    const failed = results.filter((result) => !result.passed);
    expect(failed).toEqual([]);
  });

  it('emits actionable diagnostics for an incomplete adapter', () => {
    expect(() => assertAdapterConformsToManifest(new IncompleteVerificationAdapter() as never)).toThrow(/missing/i);
  });

  it('forbids government identifiers in metadata', () => {
    expect(metadataContainsForbiddenIdentifier({ ssn: '111-22-3333' })).toBe(true);
    expect(metadataContainsForbiddenIdentifier({ locale: 'en-US' })).toBe(false);
  });

  it('ranks canonical statuses for terminal monotonicity', () => {
    expect(canonicalStatusRank('created')).toBe(10);
    expect(canonicalStatusRank('pending_user_input')).toBe(20);
    expect(canonicalStatusRank('paused')).toBe(20);
    expect(canonicalStatusRank('provider_unavailable')).toBe(25);
    expect(canonicalStatusRank('processing')).toBe(30);
    expect(canonicalStatusRank('manual_review_required')).toBe(40);
    expect(canonicalStatusRank('verified')).toBe(100);
    expect(canonicalStatusRank('declined')).toBe(100);
    expect(canonicalStatusRank('failed')).toBe(100);
    expect(canonicalStatusRank('expired')).toBe(100);
    expect(canonicalStatusRank('canceled')).toBe(100);
    expect(canonicalStatusRank('redacted')).toBe(200);
  });

  it('fails terminal_monotonicity when a terminal retrieve regresses', async () => {
    const base = createFakeAdapterForScenario('verified');
    let retrieves = 0;
    const adapter = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'retrieveAttempt') {
          return async (resource: Parameters<typeof base.retrieveAttempt>[0]) => {
            retrieves += 1;
            const snapshot = await target.retrieveAttempt(resource);
            if (retrieves > 1) {
              return { ...snapshot, canonicalStatus: 'pending_user_input', providerStatus: 'pending_user_input' };
            }
            return snapshot;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const results = await runAdapterConformance(adapter, command);
    expect(results.find((result) => result.name === 'terminal_monotonicity')?.passed).toBe(false);
  });

  it('accepts namespaced packages and rejects unsafe identifiers property-based', () => {
    fc.assert(fc.property(fc.constantFrom('human_idv', 'business_kyb', 'associated_person_idv', 'ownership_review'), (code) => {
      expect(isPackageCode(code)).toBe(true);
    }), fcOpts);
    fc.assert(fc.property(fc.stringMatching(/^[a-z]{2,8}\.[a-z]{2,12}\.[a-z][a-z0-9_]{1,19}$/), (code) => {
      expect(isCustomPackageCode(code)).toBe(true);
    }), fcOpts);
  });

  it('accepts only CANONICAL_STATUSES as canonical', () => {
    fc.assert(fc.property(fc.constantFrom(...CANONICAL_STATUSES), (status) => {
      expect(isCanonicalStatus(status)).toBe(true);
    }), fcOpts);
    fc.assert(fc.property(
      fc.string({ minLength: 0, maxLength: 24 }).filter((value) => !(CANONICAL_STATUSES as readonly string[]).includes(value)),
      (status) => {
        expect(isCanonicalStatus(status)).toBe(false);
      },
    ), fcOpts);
  });

  it('rejects SSN-like and empty opaque subject references', () => {
    expect(isOpaqueSubjectReference('')).toBe(false);
    expect(isOpaqueSubjectReference('111-22-3333')).toBe(false);
    expect(isOpaqueSubjectReference('ssn-opaque1')).toBe(false);
    expect(isOpaqueSubjectReference('sub_opaque_9f3a2c1d')).toBe(true);
    fc.assert(fc.property(fc.constantFrom('', '111-22-3333', 'ssn-12345678', 'passport-ab'), (value) => {
      expect(isOpaqueSubjectReference(value)).toBe(false);
    }), fcOpts);
    fc.assert(fc.property(
      fc.stringMatching(/^sub_[A-Za-z0-9]{12,24}$/),
      (value) => {
        expect(isOpaqueSubjectReference(value)).toBe(true);
      },
    ), fcOpts);
  });

  it('detects forbidden identifier keys and values', () => {
    fc.assert(fc.property(
      fc.constantFrom('ssn', 'passport', 'itin', 'national_id', 'national-id'),
      fc.constantFrom('ssn', 'passport', 'itin', 'national_id'),
      (key, token) => {
        expect(metadataContainsForbiddenIdentifier({ [key]: 'opaque' })).toBe(true);
        expect(metadataContainsForbiddenIdentifier({ note: `${token} present` })).toBe(true);
      },
    ), fcOpts);
    expect(metadataContainsForbiddenIdentifier({ locale: 'en-US', attempt: 'att_1' })).toBe(false);
  });

  it('rejects malformed package codes', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.constantFrom('not a package', 'Human_IDV', 'HUMAN_IDV', 'a', '', 'UPPER.CASE.CODE', 'com.', '.example.code'),
        fc.string({ minLength: 0, maxLength: 24 }).filter((value) => !isPackageCode(value)),
      ),
      (code) => {
        expect(isPackageCode(code)).toBe(false);
        expect(() => assertPackageCode(code)).toThrow();
      },
    ), fcOpts);
  });
});
