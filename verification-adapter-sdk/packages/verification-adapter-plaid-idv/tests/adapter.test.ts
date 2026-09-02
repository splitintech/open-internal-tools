import { describe, expect, it } from 'vitest';

import {
  assertAdapterConformsToManifest,
  createDefaultRuntime,
  validateManifestOnly,
} from '@splitin/verification-adapter-sdk';

import { PlaidIdvVerificationAdapter } from '../src/adapter.ts';
import { plaidIdvBrowserPlugin } from '../src/browser.ts';
import { createPlaidIdvConfiguration } from '../src/configuration.ts';
import { plaidIdvProviderManifest } from '../src/manifest.ts';
import { normalizePlaidIdentityStatus } from '../src/status.ts';
import {
  createPlaidRuntime,
  json,
  plaidAttempt,
  plaidIdentity,
} from './helpers.ts';

describe('Plaid IDV configuration and manifest', () => {
  it('freezes a valid V1 manifest that does not advertise redaction', () => {
    expect(validateManifestOnly(plaidIdvProviderManifest).passed).toBe(true);
    expect(plaidIdvProviderManifest.capabilities.canRedact).toBe(false);
    expect(plaidIdvProviderManifest.capabilities.canCancel).toBe(false);
    expect(plaidIdvProviderManifest.cancellation.supported).toBe(false);
    expect(plaidIdvProviderManifest.redaction.notApplicable).toBe(true);
    expect(plaidIdvProviderManifest.apiHosts).toEqual(['sandbox.plaid.com', 'production.plaid.com']);
    expect(plaidIdvProviderManifest.supportedPackages).toEqual(['human_idv']);
  });

  it('maps conventional CLI keys for the selected environment', () => {
    const sandbox = createPlaidIdvConfiguration({
      PLAID_CLIENT_ID: 'client',
      PLAID_SANDBOX_SECRET: 'sandbox-secret',
      PLAID_PRODUCTION_SECRET: 'prod-secret',
      PLAID_SANDBOX_TEMPLATE_ID: 'tmpl_sandbox',
      PLAID_CLIENT_NAME: 'Host',
    }, 'sandbox');
    expect(sandbox.secret).toBe('sandbox-secret');
    expect(sandbox.templateId).toBe('tmpl_sandbox');
    const production = createPlaidIdvConfiguration({
      PLAID_CLIENT_ID: 'client',
      PLAID_SANDBOX_SECRET: 'sandbox-secret',
      PLAID_PRODUCTION_SECRET: 'prod-secret',
      PLAID_IDV_TEMPLATE_ID: 'tmpl_prod',
      PLAID_CLIENT_NAME: 'Host',
    }, 'production');
    expect(production.secret).toBe('prod-secret');
  });

  it('rejects missing configuration', () => {
    expect(() => new PlaidIdvVerificationAdapter(createDefaultRuntime('sandbox', {
      clientId: '',
      secret: '',
      templateId: '',
      clientName: '',
    }, { allowedHosts: plaidIdvProviderManifest.apiHosts }))).toThrow(/not configured/i);
  });
});

describe('Plaid IDV status mapping', () => {
  it('maps Plaid IDV statuses onto canonical V1 statuses', () => {
    expect(normalizePlaidIdentityStatus('active').status).toBe('pending_user_input');
    expect(normalizePlaidIdentityStatus('success').status).toBe('verified');
    expect(normalizePlaidIdentityStatus('pending_review').status).toBe('manual_review_required');
    expect(normalizePlaidIdentityStatus('failed').status).toBe('failed');
    expect(normalizePlaidIdentityStatus('mystery').reasonCodes).toContain('plaid_status_ambiguous');
  });
});

describe('Plaid IDV HTTP lifecycle', () => {
  it('creates an idempotent IDV session and Link launch envelope', async () => {
    const { adapter, requests } = createPlaidRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/identity_verification/create') {
        const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
        expect(body.is_idempotent).toBe(true);
        expect(body.products).toBeUndefined();
        expect(JSON.stringify(body)).not.toMatch(/auth|monitor|payment/i);
        return json(plaidIdentity());
      }
      if (url.pathname === '/link/token/create') {
        const body = JSON.parse(await request.clone().text()) as { products: string[]; client_name: string };
        expect(body.products).toEqual(['identity_verification']);
        expect(body.client_name).toBe('Example Host');
        return json({ link_token: 'link-sandbox-token-1', expiration: new Date(Date.now() + 1800_000).toISOString() });
      }
      return json(plaidIdentity());
    });
    assertAdapterConformsToManifest(adapter);
    const result = await adapter.createAttempt(plaidAttempt);
    expect(result.providerResourceId).toBe('idv_plaid_1');
    expect(result.launch.launcherKey).toBe('plaid_link');
    expect(result.launch.transientSecret).toBe('link-sandbox-token-1');
    expect(result.launch).not.toHaveProperty('opaqueLaunchSecret');
    expect(result.launch).not.toHaveProperty('adapter');
    expect(requests[0]!.url).toContain('https://sandbox.plaid.com/');
  });

  it('preserves new-resource lineage on retry after failure', async () => {
    const { adapter } = createPlaidRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/identity_verification/get') return json(plaidIdentity({ status: 'failed' }));
      if (url.pathname === '/identity_verification/retry') return json(plaidIdentity({ id: 'idv_plaid_2', status: 'active' }));
      if (url.pathname === '/link/token/create') return json({ link_token: 'link-sandbox-retry', expiration: new Date().toISOString() });
      return json(plaidIdentity());
    });
    const retried = await adapter.retryAttempt({
      ...plaidAttempt,
      previousProviderResourceId: 'idv_plaid_1',
    });
    expect(retried.providerResourceId).toBe('idv_plaid_2');
    expect(retried.linkedResources?.[0]?.relationshipCode).toBe('retried_from');
    expect(retried.linkedResources?.[0]?.resourceId).toBe('idv_plaid_1');
  });

  it('treats redaction as not applicable without calling an unsupported API', async () => {
    const { adapter, requests } = createPlaidRuntime(async () => json(plaidIdentity()));
    const result = await adapter.redactSubject({
      subjectReference: plaidAttempt.subjectReference,
      providerResourceId: 'idv_plaid_1',
      requestReference: 'redact_1',
    });
    expect(result.disposition).toBe('not_applicable');
    expect(requests).toHaveLength(0);
  });

  it('refuses cancel because Plaid Identity Verification has no cancel API', async () => {
    const { adapter, requests } = createPlaidRuntime(async () => json(plaidIdentity()));
    await expect(adapter.cancelAttempt({
      attemptId: plaidAttempt.attemptId,
      providerResourceId: 'idv_plaid_1',
      configurationRevision: plaidAttempt.configurationRevision,
    })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      safeCode: 'plaid_cancel_unsupported',
    });
    expect(requests).toHaveLength(0);
  });
});

describe('Plaid IDV browser plugin', () => {
  it('exports the plaid_link launcher key', () => {
    expect(plaidIdvBrowserPlugin.launcherKey).toBe('plaid_link');
  });
});
