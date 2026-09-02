import { describe, expect, it } from 'vitest';

import {
  ProviderError,
  assertAdapterConformsToManifest,
  createAllowlistedHttp,
  createControlledFetch,
  createDefaultRuntime,
  validateManifestOnly,
} from '@splitin/verification-adapter-sdk';

import { StripeIdentityVerificationAdapter } from '../src/adapter.ts';
import { stripeIdentityBrowserPlugin } from '../src/browser.ts';
import {
  createStripeIdentityConfiguration,
  type StripeIdentityAdapterConfiguration,
} from '../src/configuration.ts';
import { STRIPE_IDENTITY_API_VERSION } from '../src/constants.ts';
import { stripeIdentityProviderManifest } from '../src/manifest.ts';
import { normalizeStripeIdentityStatus } from '../src/status.ts';
import {
  attemptCommand,
  createStripeRuntime,
  stripeSession,
  validConfig,
} from './helpers.ts';

describe('Stripe Identity configuration and manifest', () => {
  it('freezes a valid V1 manifest', () => {
    expect(validateManifestOnly(stripeIdentityProviderManifest).passed).toBe(true);
    expect(Object.isFrozen(stripeIdentityProviderManifest)).toBe(true);
    expect(stripeIdentityProviderManifest.apiHosts).toEqual(['api.stripe.com']);
    expect(stripeIdentityProviderManifest.testedApiVersions).toEqual([STRIPE_IDENTITY_API_VERSION]);
    expect(stripeIdentityProviderManifest.redaction.asynchronous).toBe(true);
  });

  it('maps conventional CLI keys without reading env', () => {
    const config = createStripeIdentityConfiguration({
      STRIPE_IDENTITY_RESTRICTED_KEY: 'rk_test_bbbbbbbbbbbbbbbb',
      STRIPE_IDENTITY_ACCOUNT_ID: 'acct_87654321',
      STRIPE_IDENTITY_WEBHOOK_SECRET: 'whsec_cli_current',
      STRIPE_IDENTITY_WEBHOOK_SECRET_PREVIOUS: 'whsec_cli_previous',
      STRIPE_IDENTITY_API_VERSION: STRIPE_IDENTITY_API_VERSION,
      STRIPE_IDENTITY_REQUIRE_MATCHING_SELFIE: 'true',
    });
    expect(config.restrictedKey).toBe('rk_test_bbbbbbbbbbbbbbbb');
    expect(config.webhookSecretPrevious).toBe('whsec_cli_previous');
    expect(config.requireMatchingSelfie).toBe(true);
  });

  it('rejects sandbox credentials in production and live keys in sandbox', () => {
    expect(() => new StripeIdentityVerificationAdapter(createDefaultRuntime('production', validConfig, {
      allowedHosts: ['api.stripe.com'],
    }))).toThrow(ProviderError);

    const live: StripeIdentityAdapterConfiguration = {
      ...validConfig,
      restrictedKey: 'rk_live_aaaaaaaaaaaaaaaa',
    };
    expect(() => new StripeIdentityVerificationAdapter(createDefaultRuntime('sandbox', live, {
      allowedHosts: ['api.stripe.com'],
    }))).toThrow(/credentials do not match/i);
  });

  it('rejects a non-pinned API version and missing webhook secrets', () => {
    expect(() => new StripeIdentityVerificationAdapter(createDefaultRuntime('sandbox', {
      ...validConfig,
      apiVersion: '2024-01-01',
    }, { allowedHosts: ['api.stripe.com'] }))).toThrow(/API version/);

    expect(() => new StripeIdentityVerificationAdapter(createDefaultRuntime('sandbox', {
      ...validConfig,
      webhookSecret: 'not-a-stripe-secret',
      webhookSecretPrevious: undefined,
    }, { allowedHosts: ['api.stripe.com'] }))).toThrow(/webhook authentication/);
  });

  it('does not allow an arbitrary production API origin in configuration', () => {
    const config = createStripeIdentityConfiguration({
      ...Object.fromEntries(Object.entries(validConfig).map(([key, value]) => [key, String(value ?? '')])),
      apiHost: 'evil.example',
    });
    expect(config).not.toHaveProperty('apiHost');
    expect(stripeIdentityProviderManifest.apiHosts).not.toContain('evil.example');
  });
});

describe('Stripe Identity status mapping', () => {
  it('maps requires_input to pending, declined, or manual review', () => {
    expect(normalizeStripeIdentityStatus('requires_input', null).canonicalStatus).toBe('pending_user_input');
    expect(normalizeStripeIdentityStatus('requires_input', 'under_supported_age').canonicalStatus).toBe('declined');
    expect(normalizeStripeIdentityStatus('requires_input', 'selfie_face_mismatch').canonicalStatus).toBe('manual_review_required');
    expect(normalizeStripeIdentityStatus('verified', null).canonicalStatus).toBe('verified');
    expect(normalizeStripeIdentityStatus('processing', null).canonicalStatus).toBe('processing');
    expect(normalizeStripeIdentityStatus('canceled', null).canonicalStatus).toBe('canceled');
    expect(normalizeStripeIdentityStatus('requires_input', null, 'identity.verification_session.redacted').canonicalStatus).toBe('redacted');
    expect(normalizeStripeIdentityStatus('verified', null, undefined, 'processing').canonicalStatus).toBe('processing');
    expect(normalizeStripeIdentityStatus('weird', null).reasonCodes).toContain('stripe_unknown_status');
  });
});

describe('Stripe Identity HTTP lifecycle', () => {
  it('creates a document session with opaque attempt metadata and selfie option', async () => {
    const { adapter, requests } = createStripeRuntime(async () => json(stripeSession()));
    const result = await adapter.createAttempt(attemptCommand);
    expect(result.attemptId).toBe(attemptCommand.attemptId);
    expect(result.providerResourceId).toBe('vs_identity1');
    expect(result.canonicalStatus).toBe('pending_user_input');
    expect(result.launch.launcherKey).toBe('stripe_identity');
    expect(result.launch.presentation).toBe('embedded');
    expect(result.launch.transientSecret).toMatch(/_secret_/);
    expect(result.launch).not.toHaveProperty('inquiryOrSessionId');
    expect(result.launch).not.toHaveProperty('opaqueLaunchSecret');
    expect(result.launch).not.toHaveProperty('adapter');
    expect(result.launch).not.toHaveProperty('client_secret');
    expect(result.launch).not.toHaveProperty('clientSecret');

    const request = requests[0]!;
    expect(new URL(request.url).hostname).toBe('api.stripe.com');
    expect(request.headers.get('Stripe-Version')).toBe(STRIPE_IDENTITY_API_VERSION);
    expect(request.headers.get('Idempotency-Key')).toBe(attemptCommand.idempotencyKey);
    const body = await request.clone().text();
    expect(body).toContain('metadata%5Battempt_id%5D=att_1234567890');
    expect(body).not.toContain('splitin');
    expect(decodeURIComponent(body)).toContain('options[document][require_matching_selfie]=true');
    expect(body).toContain('type=document');
  });

  it('omits matching selfie when the typed flag is false', async () => {
    const { adapter, requests } = createStripeRuntime(async () => json(stripeSession()), {
      ...validConfig,
      requireMatchingSelfie: false,
    });
    await adapter.createAttempt(attemptCommand);
    expect(decodeURIComponent(await requests[0]!.clone().text())).toContain('options[document][require_matching_selfie]=false');
  });

  it('resumes, retrieves, retries the same resource, cancels, and redacts', async () => {
    const store = new Map<string, ReturnType<typeof stripeSession>>();
    store.set('vs_identity1', stripeSession());
    const { adapter } = createStripeRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/cancel') && request.method === 'POST') {
        const current = stripeSession({ status: 'canceled', client_secret: null, url: null });
        store.set('vs_identity1', current);
        return json(current);
      }
      if (url.pathname.endsWith('/redact') && request.method === 'POST') {
        return json(stripeSession({ status: 'verified', redaction: { status: 'processing' } }));
      }
      if (request.method === 'POST' && url.pathname.endsWith('/verification_sessions')) {
        const created = stripeSession();
        store.set(created.id, created);
        return json(created);
      }
      return json(store.get('vs_identity1') ?? stripeSession());
    });

    assertAdapterConformsToManifest(adapter);
    const created = await adapter.createAttempt(attemptCommand);
    const resumed = await adapter.resumeAttempt({
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: attemptCommand.configurationRevision,
    });
    expect(resumed.transientSecret).toBeTruthy();
    const snapshot = await adapter.retrieveAttempt({
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: attemptCommand.configurationRevision,
    });
    expect(snapshot.canonicalStatus).toBe('pending_user_input');
    const retried = await adapter.retryAttempt({
      ...attemptCommand,
      previousProviderResourceId: created.providerResourceId,
    });
    expect(retried.providerResourceId).toBe(created.providerResourceId);
    const canceled = await adapter.cancelAttempt({
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      configurationRevision: attemptCommand.configurationRevision,
    });
    expect(canceled.accepted).toBe(true);
    expect(canceled.canonicalStatus).toBe('canceled');
    store.set('vs_identity1', stripeSession({ status: 'verified' }));
    const redaction = await adapter.redactSubject({
      subjectReference: attemptCommand.subjectReference,
      providerResourceId: created.providerResourceId,
      requestReference: 'redact_1',
    });
    expect(redaction.completed).toBe(false);
    expect(redaction.disposition).toBe('processing');
  });

  it('creates a new resource after a canceled previous attempt', async () => {
    let creates = 0;
    const { adapter } = createStripeRuntime(async (request) => {
      if (request.method === 'GET') return json(stripeSession({ status: 'canceled', client_secret: null }));
      creates += 1;
      return json(stripeSession({ id: `vs_identity${creates}${creates}` }));
    });
    const retried = await adapter.retryAttempt({
      ...attemptCommand,
      previousProviderResourceId: 'vs_identity1',
    });
    expect(retried.providerResourceId).toBe('vs_identity11');
  });

  it('never logs restricted keys or client secrets', async () => {
    const logs: string[] = [];
    const fetchImpl = createControlledFetch(async () => json(stripeSession()));
    const runtime = createDefaultRuntime('sandbox', validConfig, {
      http: createAllowlistedHttp(stripeIdentityProviderManifest.apiHosts, fetchImpl),
      crypto: globalThis.crypto,
      logger: {
        info: (event, metadata) => { logs.push(JSON.stringify({ event, metadata })); },
        warn: (event, metadata) => { logs.push(JSON.stringify({ event, metadata })); },
        error: (event, metadata) => { logs.push(JSON.stringify({ event, metadata })); },
      },
    });
    const adapter = new StripeIdentityVerificationAdapter(runtime);
    await adapter.createAttempt(attemptCommand);
    expect(logs.join(' ')).not.toMatch(/rk_test_|whsec_|secret_abc/);
  });
});

describe('Stripe Identity browser plugin', () => {
  it('exports the stripe_identity launcher key', () => {
    expect(stripeIdentityBrowserPlugin.launcherKey).toBe('stripe_identity');
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
