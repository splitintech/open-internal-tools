import { describe, expect, it } from 'vitest';

import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';

import {
  METHOD_MAP,
  PACKAGE_CODE_MAP,
  V1_PROTECTED_ACTION_CODE,
  V2_PROTECTED_ACTION_CONTRACT,
  WEBHOOK_PROTOCOL_MAP,
  attemptCommandV1ToV2,
  attemptCommandV2ToV1,
  launchV1ToV2,
  launchV2ToV1,
  mapStatusV1ToV2,
  mapStatusV2ToV1,
  mapWebhookProtocolV1ToV2,
  metadataV1ToV2,
  metadataV2ToV1,
  toV1ProtectedActionCode,
  toV2ProtectedActionContract,
  wrapV1AdapterForSplitInV2,
} from '../src/index.ts';
import {
  v1AttemptFixture,
  v1DenialFixture,
  v1LaunchFixture,
  v1MetadataFixture,
  v2DenialFixture,
  v2MetadataFixture,
} from './fixtures.ts';

describe('V1 ↔ SplitIn V2 parity', () => {
  it('maps requestRetry to retryAttempt and leaves reconcileAttempt engine-owned', () => {
    expect(METHOD_MAP.requestRetry).toBe('retryAttempt');
    expect(METHOD_MAP.retryAttempt).toBe('requestRetry');
    expect(METHOD_MAP.reconcileAttempt).toBe('engineOwned');
  });

  it('round-trips launch aliases without exposing extra secret names in V1', () => {
    const v2 = launchV1ToV2(v1LaunchFixture, 'sandbox');
    expect(v2.inquiryOrSessionId).toBe(v1LaunchFixture.continuationReference);
    expect(v2.opaqueLaunchSecret).toBe(v1LaunchFixture.transientSecret);
    expect(v2.environmentId).toBe('sandbox');
    const roundTrip = launchV2ToV1(v2, v1LaunchFixture.attemptId);
    expect(roundTrip.transientSecret).toBe(v1LaunchFixture.transientSecret);
    expect(roundTrip.continuationReference).toBe(v1LaunchFixture.continuationReference);
    expect(roundTrip).not.toHaveProperty('inquiryOrSessionId');
    expect(roundTrip).not.toHaveProperty('opaqueLaunchSecret');
    expect(roundTrip).not.toHaveProperty('environmentId');
  });

  it('maps splitin_* metadata onto opaque attempt_id', () => {
    expect(metadataV2ToV1(v2MetadataFixture).attempt_id).toBe('att_1234567890');
    expect(metadataV1ToV2(v1MetadataFixture, 'att_1234567890').splitin_attempt_id).toBe('att_1234567890');
  });

  it('maps the protected-action contract string', () => {
    expect(toV2ProtectedActionContract(v1DenialFixture.code)).toBe(V2_PROTECTED_ACTION_CONTRACT);
    expect(toV1ProtectedActionCode(v2DenialFixture.contract)).toBe(V1_PROTECTED_ACTION_CODE);
    expect(V1_PROTECTED_ACTION_CODE).toBe('VERIFICATION_REQUIRED');
  });

  it('maps packages, statuses, and webhook protocols', () => {
    expect(PACKAGE_CODE_MAP.human_idv).toBe('human_idv');
    expect(mapStatusV1ToV2('redacted')).toBe('canceled');
    expect(mapStatusV2ToV1('canceled', true)).toBe('redacted');
    expect(mapWebhookProtocolV1ToV2('stripe_v1_hmac')).toBe(WEBHOOK_PROTOCOL_MAP.stripe_v1_hmac);
    expect(mapWebhookProtocolV1ToV2('persona_hmac_sha256')).toBe('persona_hmac_sha256');
    expect(mapWebhookProtocolV1ToV2('plaid_es256_jwk')).toBe('plaid_es256_jwk');
  });

  it('round-trips attempt commands from non-sensitive fake behavior', () => {
    const v2 = attemptCommandV1ToV2({
      attemptId: v1AttemptFixture.attemptId,
      subjectReference: 'sub_opaque_9f3a2c1d',
      packageCode: 'human_idv',
      countryCode: 'US',
      idempotencyKey: 'idem_create_1',
      configurationRevision: 'cfg_1',
      metadata: v1MetadataFixture,
    });
    expect(v2.humanSubjectReference).toBe('sub_opaque_9f3a2c1d');
    expect(v2.metadata?.splitin_attempt_id).toBe('att_1234567890');
    const v1 = attemptCommandV2ToV1(v2);
    expect(v1.subjectReference).toBe('sub_opaque_9f3a2c1d');
    expect(v1.configurationRevision).toBe('cfg_1');
    expect(v1.metadata?.attempt_id).toBe('att_1234567890');
  });

  it('wraps a V1 fake adapter so V2 requestRetry and reconcileAttempt stay non-billable', async () => {
    const adapter = createFakeAdapterForScenario('input_required');
    const surface = wrapV1AdapterForSplitInV2(adapter);
    const command = {
      attemptId: 'att_compat_1',
      subjectReference: 'sub_opaque_compat',
      packageCode: 'human_idv' as const,
      countryCode: 'US',
      idempotencyKey: 'idem_compat_1',
      configurationRevision: 'cfg_1',
    };
    const created = await adapter.createAttempt(command);
    const retried = await surface.requestRetry({ ...command, previousProviderResourceId: created.providerResourceId });
    expect(retried.providerResourceId).toBeTruthy();
    const reconciled = await surface.reconcileAttempt({
      attemptId: command.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: 'cfg_1',
    });
    expect(reconciled.canonicalStatus).toBe('pending_user_input');
    expect(reconciled.safeMetadata.splitin_attempt_id).toBe('att_compat_1');
  });
});
