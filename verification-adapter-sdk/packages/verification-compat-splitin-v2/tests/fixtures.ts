import type { ProviderAttemptResult, ProviderLaunchEnvelope } from '@splitin/verification-adapter-sdk';

/** Non-sensitive fake-provider behavior copied from the public V1 fake adapter. */
export const v1LaunchFixture: ProviderLaunchEnvelope = {
  attemptId: 'att_1234567890',
  canonicalStatus: 'pending_user_input',
  launcherKey: 'test_embedded',
  presentation: 'embedded',
  providerDisclosure: 'Test provider',
  transientSecret: 'test_launch_att1234567890',
  transientSecretExpiresAt: '2026-01-01T00:05:00.000Z',
  continuationReference: 'cont_att_1234567890',
};

export const v1AttemptFixture: ProviderAttemptResult = {
  attemptId: 'att_1234567890',
  providerResourceId: 'tfr_att1234567890',
  providerStatus: 'pending_user_input',
  canonicalStatus: 'pending_user_input',
  launch: v1LaunchFixture,
};

export const v1MetadataFixture = {
  attempt_id: 'att_1234567890',
  locale: 'en-US',
  source: 'fake',
};

export const v2MetadataFixture = {
  splitin_attempt_id: 'att_1234567890',
  attempt_id: 'att_1234567890',
  locale: 'en-US',
  source: 'fake',
};

export const v1DenialFixture = {
  code: 'VERIFICATION_REQUIRED' as const,
  action: 'payout.create',
  resourceHash: 'res_opaque_hash',
  requiredPackages: ['human_idv'],
};

export const v2DenialFixture = {
  contract: 'splitin.verification.required.v2' as const,
  actionKey: 'payout.create',
  resourceHash: 'res_opaque_hash',
  requiredPackages: ['human_idv'],
};
