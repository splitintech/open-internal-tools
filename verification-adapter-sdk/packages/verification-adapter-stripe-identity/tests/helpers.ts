import {
  FakeClock,
  createAllowlistedHttp,
  createControlledFetch,
  createDefaultRuntime,
  type ProviderAttemptCommand,
  type ProviderRuntimeContext,
} from '@splitin/verification-adapter-sdk';

import { StripeIdentityVerificationAdapter } from '../src/adapter.ts';
import {
  createStripeIdentityConfiguration,
  type StripeIdentityAdapterConfiguration,
} from '../src/configuration.ts';
import { STRIPE_IDENTITY_API_VERSION } from '../src/constants.ts';
import { stripeIdentityProviderManifest } from '../src/manifest.ts';

export const FIXED_NOW = Date.parse('2026-01-01T00:00:00.000Z');

export const validConfig: StripeIdentityAdapterConfiguration = Object.freeze({
  restrictedKey: 'rk_test_aaaaaaaaaaaaaaaa',
  accountId: 'acct_12345678',
  webhookSecret: 'whsec_test_current_secret',
  webhookSecretPrevious: 'whsec_test_previous_secret',
  apiVersion: STRIPE_IDENTITY_API_VERSION,
  requireMatchingSelfie: true,
  webhookToleranceSeconds: 300,
});

export const attemptCommand: ProviderAttemptCommand = {
  attemptId: 'att_1234567890',
  subjectReference: 'sub_opaque_9f3a2c1d',
  packageCode: 'human_idv',
  countryCode: 'US',
  idempotencyKey: 'idem_create_1',
  configurationRevision: 'cfg_1',
  email: 'user@example.test',
};

export function stripeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vs_identity1',
    status: 'requires_input',
    created: Math.floor(FIXED_NOW / 1000),
    livemode: false,
    client_secret: 'vs_identity1_secret_abc',
    url: 'https://verify.stripe.com/start/test',
    last_error: null,
    redaction: null,
    ...overrides,
  };
}

export function stripeEvent(type: string, session: Record<string, unknown> = stripeSession()) {
  return {
    id: 'evt_identity1',
    type,
    created: Math.floor(FIXED_NOW / 1000),
    livemode: false,
    account: validConfig.accountId,
    data: { object: session },
  };
}

export function createStripeRuntime(
  handler: (request: Request) => Promise<Response> | Response,
  config: StripeIdentityAdapterConfiguration = validConfig,
  clock = new FakeClock(FIXED_NOW),
): {
  runtime: ProviderRuntimeContext<StripeIdentityAdapterConfiguration>;
  clock: FakeClock;
  adapter: StripeIdentityVerificationAdapter;
  requests: Request[];
} {
  const requests: Request[] = [];
  const fetchImpl = createControlledFetch(async (request) => {
    requests.push(request);
    return handler(request);
  });
  const runtime = createDefaultRuntime('sandbox', config, {
    now: clock.now,
    crypto: globalThis.crypto,
    http: createAllowlistedHttp(stripeIdentityProviderManifest.apiHosts, fetchImpl),
  });
  return {
    runtime,
    clock,
    adapter: new StripeIdentityVerificationAdapter(runtime),
    requests,
  };
}

export { createStripeIdentityConfiguration };
