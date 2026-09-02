import {
  FakeClock,
  createAllowlistedHttp,
  createControlledFetch,
  createDefaultRuntime,
  createSignedWebhookFixture,
  type ProviderAttemptCommand,
  type ProviderRuntimeContext,
} from '@splitin/verification-adapter-sdk';

import { PersonaVerificationAdapter } from '../src/adapter.ts';
import {
  DEFAULT_KYB_FIELD_MAP,
  type PersonaAdapterConfiguration,
} from '../src/configuration.ts';
import { personaProviderManifest } from '../src/manifest.ts';

export const FIXED_NOW = Date.parse('2026-01-01T00:00:00.000Z');

export const validPersonaConfig: PersonaAdapterConfiguration = Object.freeze({
  apiKey: 'persona_sandbox_testkey',
  environmentId: 'env_persona_test',
  idvTemplateId: 'itmpl_idv_published',
  idvTemplateVersion: 'itmplv_idv_1',
  associatedPersonTemplateId: 'itmpl_ap_published',
  associatedPersonTemplateVersion: 'itmplv_ap_1',
  kybTransactionTypeId: 'trxn_type_kyb',
  kybWorkflowId: 'wfl_kyb_published',
  kybWorkflowVersion: 'wflv_kyb_1',
  caseTemplateId: 'casetmpl_published',
  caseType: 'kyb_review',
  ownershipCaseType: 'property_ownership',
  businessAuthorityCaseType: 'business_authority',
  kybCaseMode: 'workflow_managed',
  kybFieldMap: DEFAULT_KYB_FIELD_MAP,
  apiVersion: '2023-01-05',
  webhookSecretCurrent: 'persona_whsec_current',
  webhookSecretPrevious: 'persona_whsec_previous',
  webhookToleranceSeconds: 300,
  allowedOrigins: ['https://app.example.test'],
});

export const personaAttempt: ProviderAttemptCommand = {
  attemptId: 'att_persona_1',
  subjectReference: 'sub_opaque_persona1',
  packageCode: 'human_idv',
  countryCode: 'US',
  idempotencyKey: 'idem_persona_1',
  configurationRevision: 'cfg_persona_1',
  requestOrigin: 'https://app.example.test',
  legalFirstName: 'Ada',
  legalLastName: 'Lovelace',
  email: 'ada@example.test',
};

export function inquiryResource(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      type: 'inquiry',
      id: 'inq_persona1',
      attributes: {
        status: 'pending',
        'created-at': new Date(FIXED_NOW).toISOString(),
        'expires-at': new Date(FIXED_NOW + 3_600_000).toISOString(),
        ...((overrides.attributes as object) ?? {}),
      },
      ...overrides,
    },
    meta: { 'session-token': 'persona_session_token_1' },
  };
}

export function personaWebhookBody(name: string, status = 'completed') {
  return JSON.stringify({
    data: {
      type: 'event',
      id: 'evt_persona_1',
      attributes: {
        name,
        'created-at': new Date(FIXED_NOW).toISOString(),
        payload: {
          data: {
            type: 'inquiry',
            id: 'inq_persona1',
            attributes: { status },
          },
        },
      },
    },
  });
}

export async function signedPersonaRequest(
  secret: string,
  body: string,
  clock: FakeClock,
  environmentId = validPersonaConfig.environmentId,
): Promise<Request> {
  const request = await createSignedWebhookFixture({
    protocol: 'persona_hmac_sha256',
    secret,
    body,
    now: clock.now(),
  });
  const headers = new Headers(request.headers);
  headers.set('Persona-Environment-Id', environmentId);
  return new Request(request.url, { method: 'POST', headers, body: await request.arrayBuffer() });
}

export function createPersonaRuntime(
  handler: (request: Request) => Promise<Response> | Response,
  config: PersonaAdapterConfiguration = validPersonaConfig,
  clock = new FakeClock(FIXED_NOW),
): {
  adapter: PersonaVerificationAdapter;
  runtime: ProviderRuntimeContext<PersonaAdapterConfiguration>;
  clock: FakeClock;
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
    http: createAllowlistedHttp(personaProviderManifest.apiHosts, fetchImpl),
  });
  return {
    adapter: new PersonaVerificationAdapter(runtime),
    runtime,
    clock,
    requests,
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'Persona-Environment-Id': validPersonaConfig.environmentId, ...headers },
  });
}
