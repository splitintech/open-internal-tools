import { describe, expect, it } from 'vitest';

import {
  assertAdapterConformsToManifest,
  createDefaultRuntime,
  validateManifestOnly,
} from '@splitin/verification-adapter-sdk';

import { PersonaVerificationAdapter } from '../src/adapter.ts';
import { personaBrowserPlugin } from '../src/browser.ts';
import { createPersonaConfiguration } from '../src/configuration.ts';
import { personaProviderManifest } from '../src/manifest.ts';
import { normalizePersonaStatus } from '../src/status.ts';
import {
  createPersonaRuntime,
  inquiryResource,
  json,
  personaAttempt,
  validPersonaConfig,
} from './helpers.ts';

describe('Persona configuration and manifest', () => {
  it('freezes a valid V1 manifest', () => {
    expect(validateManifestOnly(personaProviderManifest).passed).toBe(true);
    expect(personaProviderManifest.supportedPackages).toEqual([
      'human_idv', 'business_kyb', 'associated_person_idv', 'ownership_review',
    ]);
    expect(personaProviderManifest.apiHosts).toEqual(['api.withpersona.com']);
  });

  it('maps conventional CLI keys', () => {
    const config = createPersonaConfiguration({
      PERSONA_API_KEY: 'persona_sandbox_cli',
      PERSONA_ENVIRONMENT_ID: 'env_cli',
      PERSONA_IDV_TEMPLATE_ID: 'itmpl_cli',
      PERSONA_IDV_TEMPLATE_VERSION: 'itmplv_cli',
      PERSONA_ASSOCIATED_PERSON_TEMPLATE_ID: 'itmpl_ap',
      PERSONA_ASSOCIATED_PERSON_TEMPLATE_VERSION: 'itmplv_ap',
      PERSONA_KYB_TRANSACTION_TYPE_ID: 'trxn_cli',
      PERSONA_KYB_WORKFLOW_ID: 'wfl_cli',
      PERSONA_KYB_WORKFLOW_VERSION: 'wflv_cli',
      PERSONA_CASE_TEMPLATE_ID: 'casetmpl_cli',
      PERSONA_API_VERSION: '2023-01-05',
      PERSONA_WEBHOOK_SECRET_CURRENT: 'whsec_cli',
      PERSONA_ALLOWED_ORIGINS: 'https://app.example.test',
    });
    expect(config.apiKey).toBe('persona_sandbox_cli');
    expect(config.allowedOrigins).toEqual(['https://app.example.test']);
    expect(createPersonaConfiguration({
      PERSONA_API_KEY: 'persona_sandbox_cli',
      PERSONA_ENVIRONMENT_ID: 'env_cli',
      PERSONA_IDV_TEMPLATE_ID: 'itmpl_cli',
      PERSONA_IDV_TEMPLATE_VERSION: 'itmplv_cli',
      PERSONA_ASSOCIATED_PERSON_TEMPLATE_ID: 'itmpl_ap',
      PERSONA_ASSOCIATED_PERSON_TEMPLATE_VERSION: 'itmplv_ap',
      PERSONA_KYB_TRANSACTION_TYPE_ID: 'trxn_cli',
      PERSONA_KYB_WORKFLOW_ID: 'wfl_cli',
      PERSONA_KYB_WORKFLOW_VERSION: 'wflv_cli',
      PERSONA_CASE_TEMPLATE_ID: 'casetmpl_cli',
      PERSONA_OWNERSHIP_CASE_TYPE: 'ownership_review',
      PERSONA_API_VERSION: '2023-01-05',
      PERSONA_WEBHOOK_SECRET_CURRENT: 'whsec_cli',
    }).ownershipCaseType).toBe('ownership_review');
    expect(() => createPersonaConfiguration({
      PERSONA_API_KEY: 'persona_sandbox_cli',
      PERSONA_ENVIRONMENT_ID: 'env_cli',
      PERSONA_IDV_TEMPLATE_ID: 'itmpl_cli',
      PERSONA_IDV_TEMPLATE_VERSION: 'itmplv_cli',
      PERSONA_ASSOCIATED_PERSON_TEMPLATE_ID: 'itmpl_ap',
      PERSONA_ASSOCIATED_PERSON_TEMPLATE_VERSION: 'itmplv_ap',
      PERSONA_KYB_TRANSACTION_TYPE_ID: 'trxn_cli',
      PERSONA_KYB_WORKFLOW_ID: 'wfl_cli',
      PERSONA_KYB_WORKFLOW_VERSION: 'wflv_cli',
      PERSONA_CASE_TEMPLATE_ID: 'casetmpl_cli',
      PERSONA_KYB_CASE_MODE: 'splitin_managed',
      PERSONA_API_VERSION: '2023-01-05',
      PERSONA_WEBHOOK_SECRET_CURRENT: 'whsec_cli',
    })).toThrow(/case mode/i);
  });

  it('rejects unpublished template versions and environment key mismatch', () => {
    expect(() => new PersonaVerificationAdapter(createDefaultRuntime('sandbox', {
      ...validPersonaConfig,
      idvTemplateVersion: 'draft',
    }, { allowedHosts: ['api.withpersona.com'] }))).toThrow(/published version/i);

    expect(() => new PersonaVerificationAdapter(createDefaultRuntime('production', validPersonaConfig, {
      allowedHosts: ['api.withpersona.com'],
    }))).toThrow(/API key does not match/);
  });

  it('requires production embedding origins', () => {
    expect(() => new PersonaVerificationAdapter(createDefaultRuntime('production', {
      ...validPersonaConfig,
      apiKey: 'persona_production_livekey',
      allowedOrigins: [],
    }, { allowedHosts: ['api.withpersona.com'] }))).toThrow(/origin allowlist/);
  });
});

describe('Persona status mapping', () => {
  it('maps inquiry statuses onto canonical V1 statuses including redacted', () => {
    expect(normalizePersonaStatus('pending').status).toBe('pending_user_input');
    expect(normalizePersonaStatus('completed').status).toBe('processing');
    expect(normalizePersonaStatus('approved').status).toBe('verified');
    expect(normalizePersonaStatus('declined').status).toBe('declined');
    expect(normalizePersonaStatus('marked-for-review').status).toBe('manual_review_required');
    expect(normalizePersonaStatus('redacted').status).toBe('redacted');
    expect(normalizePersonaStatus('mystery').reasonCodes).toContain('persona_unknown_status');
  });
});

describe('Persona HTTP lifecycle', () => {
  it('creates an inquiry with published template version and V1 launch envelope', async () => {
    const { adapter, requests } = createPersonaRuntime(async () => json(inquiryResource()));
    assertAdapterConformsToManifest(adapter);
    const result = await adapter.createAttempt(personaAttempt);
    expect(result.providerResourceId).toBe('inq_persona1');
    expect(result.canonicalStatus).toBe('pending_user_input');
    expect(result.launch.launcherKey).toBe('persona_embedded');
    expect(result.launch.transientSecret).toBe('persona_session_token_1');
    expect(result.launch).not.toHaveProperty('environmentId');
    expect(result.launch).not.toHaveProperty('inquiryOrSessionId');
    expect(result.launch).not.toHaveProperty('opaqueLaunchSecret');
    const body = JSON.parse(await requests[0]!.clone().text()) as { data: { attributes: Record<string, unknown> } };
    expect(body.data.attributes['inquiry-template-version-id']).toBe(validPersonaConfig.idvTemplateVersion);
    expect(body.data.attributes['reference-id']).toBe(personaAttempt.subjectReference);
    expect(new URL(requests[0]!.url).hostname).toBe('api.withpersona.com');
  });

  it('creates a KYB transaction without government identifiers', async () => {
    const { adapter, requests } = createPersonaRuntime(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/transactions') && request.method === 'POST') {
        return json({
          data: {
            type: 'transaction',
            id: 'txn_kyb_1aaa',
            attributes: { status: 'created', 'created-at': new Date().toISOString() },
          },
        });
      }
      return json({
        data: {
          type: 'transaction',
          id: 'txn_kyb_1aaa',
          attributes: { status: 'created' },
        },
        included: [],
      });
    });
    const result = await adapter.createAttempt({
      ...personaAttempt,
      packageCode: 'business_kyb',
      organization: {
        legalName: 'Example LLC',
        jurisdictionCountryCode: 'US',
        registeredAddress: {
          street1: '1 Main',
          city: 'Austin',
          postalCode: '78701',
          countryCode: 'US',
        },
        evidenceReferences: ['evd_opaque_file_1'],
      },
    });
    expect(result.providerResourceId).toBe('txn_kyb_1aaa');
    expect(result.launch.presentation).toBe('none');
    const created = requests.find((request) => request.method === 'POST' && request.url.includes('/transactions'));
    const parsed = JSON.parse(await created!.clone().text()) as { data: { attributes: Record<string, unknown> } };
    const payload = JSON.stringify(parsed);
    expect(payload).not.toMatch(/ssn|tax|ein/i);
    expect(payload).toContain('evd_opaque_file_1');
    expect(parsed.data.attributes['workflow-id']).toBe(validPersonaConfig.kybWorkflowId);
    expect(parsed.data.attributes['workflow-version-id']).toBe(validPersonaConfig.kybWorkflowVersion);
    expect(parsed.data.attributes['transaction-type-id']).toBe(validPersonaConfig.kybTransactionTypeId);
  });

  it('expires inquiries and refuses non-interactive cancel', async () => {
    const { adapter, requests } = createPersonaRuntime(async (request) => {
      if (request.url.includes('/expire')) {
        return json(inquiryResource({ attributes: { status: 'expired' } }));
      }
      return json(inquiryResource());
    });
    const canceled = await adapter.cancelAttempt({
      attemptId: personaAttempt.attemptId,
      providerResourceId: 'inq_persona1',
      configurationRevision: personaAttempt.configurationRevision,
    });
    expect(canceled.accepted).toBe(true);
    expect(requests.some((request) => request.url.includes('/expire'))).toBe(true);

    await expect(adapter.cancelAttempt({
      attemptId: personaAttempt.attemptId,
      providerResourceId: 'txn_kyb_1aaa',
      configurationRevision: personaAttempt.configurationRevision,
    })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
      safeCode: 'persona_noninteractive_cancel_unsupported',
    });
    await expect(adapter.cancelAttempt({
      attemptId: personaAttempt.attemptId,
      providerResourceId: 'case_review1aa',
      configurationRevision: personaAttempt.configurationRevision,
    })).rejects.toMatchObject({
      safeCode: 'persona_noninteractive_cancel_unsupported',
    });
  });

  it('rejects a launch origin that is not allowlisted', async () => {
    const { adapter } = createPersonaRuntime(async () => json(inquiryResource()));
    await expect(adapter.createAttempt({
      ...personaAttempt,
      requestOrigin: 'https://evil.example',
    })).rejects.toMatchObject({ safeCode: 'persona_origin_denied' });
  });
});

describe('Persona browser plugin', () => {
  it('exports persona_embedded as a UX-only launcher', () => {
    expect(personaBrowserPlugin.launcherKey).toBe('persona_embedded');
  });
});
