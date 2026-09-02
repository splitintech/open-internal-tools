import {
  createFakeAdapterForScenario,
  defineProviderManifest,
  fakeProviderManifest,
  ProviderError,
  type NormalizedProviderEvent,
  type VerificationAdapterV1,
  type VerifiedWebhookEnvelope,
} from '@splitin/verification-adapter-sdk';

import {
  createMemoryQueue,
  createMemoryStore,
  createProviderRegistry,
  createVerificationPlatform,
  type ActorContext,
  type AuthorizeFn,
  type EngineRuntime,
} from '../src/index.ts';

export const userActor: ActorContext = {
  tenantKey: 'default',
  actorId: 'user_1',
  actorType: 'user',
  roles: ['renter'],
  authorizedSubjectScope: ['*'],
};

export const operatorA: ActorContext = {
  tenantKey: 'default',
  actorId: 'ops_proposer',
  actorType: 'operator',
  roles: ['admin'],
  authorizedSubjectScope: ['*'],
};

export const operatorB: ActorContext = {
  tenantKey: 'default',
  actorId: 'ops_approver',
  actorType: 'operator',
  roles: ['admin'],
  authorizedSubjectScope: ['*'],
};

export const allowAll: AuthorizeFn = async () => true;

export function createWebhookAdapter(scenario: 'input_required' | 'verified' = 'input_required'): VerificationAdapterV1 {
  const inner = createFakeAdapterForScenario(scenario);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'verifyWebhook') {
        return async (request: Request): Promise<VerifiedWebhookEnvelope> => {
          const signature = request.headers.get('x-test-signature');
          const body = new Uint8Array(await request.clone().arrayBuffer());
          if (signature !== 'valid') {
            throw new ProviderError('SIGNATURE_INVALID', 'Invalid webhook signature.', { safeCode: 'signature_invalid' });
          }
          const json = JSON.parse(new TextDecoder().decode(body)) as { eventId: string };
          const digest = await crypto.subtle.digest('SHA-256', body);
          const bodySha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
          return {
            providerEventKey: json.eventId,
            receivedAt: new Date().toISOString(),
            bodySha256,
            opaquePayload: body,
          };
        };
      }
      if (prop === 'normalizeWebhook') {
        return async (input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> => {
          const json = JSON.parse(new TextDecoder().decode(input.opaquePayload)) as {
            eventId: string;
            resourceId: string;
            type: string;
            status: 'verified' | 'declined' | 'processing';
            occurredAt?: string;
          };
          return {
            providerEventKey: json.eventId,
            providerResourceId: json.resourceId,
            eventType: json.type,
            providerEventType: json.type,
            canonicalStatus: json.status,
            occurredAt: json.occurredAt ?? input.receivedAt,
            normalizedReasonCodes: [],
            safeMetadata: { family: 'test' },
          };
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as VerificationAdapterV1;
}

export function createNamedAdapter(provider: string, scenario: 'input_required' | 'verified' = 'input_required'): VerificationAdapterV1 {
  const inner = createFakeAdapterForScenario(scenario);
  const manifest = defineProviderManifest({
    ...fakeProviderManifest,
    provider,
    displayName: provider,
  });
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'provider') return provider;
      if (prop === 'manifest') return manifest;
      return Reflect.get(target, prop, receiver);
    },
  }) as VerificationAdapterV1;
}

export function createTestPlatform(options: {
  adapters?: VerificationAdapterV1[];
  runtime?: EngineRuntime;
  authorize?: AuthorizeFn;
} = {}) {
  const adapters = options.adapters ?? [createFakeAdapterForScenario('input_required')];
  const store = createMemoryStore();
  const queue = createMemoryQueue(store, { random: () => 0 });
  const registry = createProviderRegistry({ adapters });
  const platform = createVerificationPlatform({
    registry,
    store,
    queue,
    authorize: options.authorize ?? allowAll,
    runtime: { seedSandboxExamples: true, ...options.runtime },
  });
  return { platform, store, queue, registry };
}

export const startCommand = {
  packageCode: 'human_idv' as const,
  countryCode: 'US',
  subjectReference: 'sub_opaque_9f3a2c1d',
  idempotencyKey: 'idem_start_1',
};
