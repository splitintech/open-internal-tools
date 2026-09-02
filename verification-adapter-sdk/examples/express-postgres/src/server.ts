import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';
import type { VerificationAdapterV1 } from '@splitin/verification-adapter-sdk';

export interface ExpressLikeRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): void;
}

export interface DurableAttemptStore {
  put(attemptId: string, record: { providerResourceId: string; canonicalStatus: string }): Promise<void>;
  get(attemptId: string): Promise<{ providerResourceId: string; canonicalStatus: string } | null>;
}

const productionRoutesEnabled = false;

export function createExpressVerificationHandler(options: {
  adapter?: VerificationAdapterV1;
  store?: DurableAttemptStore;
}) {
  const adapter = options.adapter ?? createFakeAdapterForScenario('input_required');
  const store = options.store ?? memoryStore();

  return async function handle(request: ExpressLikeRequest, response: ExpressLikeResponse): Promise<void> {
    if (!productionRoutesEnabled && (request.path.startsWith('/v1/production') || request.path.startsWith('/production'))) {
      response.status(403).json({ error: 'production_routes_disabled' });
      return;
    }
    if (request.method === 'GET' && request.path === '/health') {
      response.status(200).json({ ok: true, environment: 'sandbox', productionRoutesEnabled });
      return;
    }
    if (request.method === 'POST' && request.path === '/sandbox/attempts') {
      const created = await adapter.createAttempt({
        attemptId: String(request.body?.attemptId ?? 'att_express_demo'),
        subjectReference: String(request.body?.subjectReference ?? 'sub_opaque_express'),
        packageCode: 'human_idv',
        countryCode: 'US',
        idempotencyKey: String(request.body?.idempotencyKey ?? 'idem_express_demo'),
        configurationRevision: 'cfg_sandbox',
      });
      await store.put(created.attemptId, {
        providerResourceId: created.providerResourceId,
        canonicalStatus: created.canonicalStatus,
      });
      response.status(201).json({
        attemptId: created.attemptId,
        providerResourceId: created.providerResourceId,
        canonicalStatus: created.canonicalStatus,
        launcherKey: created.launch.launcherKey,
      });
      return;
    }
    response.status(404).json({ error: 'not_found' });
  };
}

function memoryStore(): DurableAttemptStore {
  const rows = new Map<string, { providerResourceId: string; canonicalStatus: string }>();
  return {
    async put(attemptId, record) {
      rows.set(attemptId, record);
    },
    async get(attemptId) {
      return rows.get(attemptId) ?? null;
    },
  };
}

async function main(): Promise<void> {
  const handle = createExpressVerificationHandler({});
  const log: unknown[] = [];
  await handle({ method: 'GET', path: '/health' }, {
    status(code) {
      log.push(code);
      return this;
    },
    json(body) {
      log.push(body);
    },
  });
  await handle({ method: 'POST', path: '/v1/production/attempts' }, {
    status(code) {
      log.push(code);
      return this;
    },
    json(body) {
      log.push(body);
    },
  });
  process.stdout.write(`${JSON.stringify(log)}\n`);
}

const isMain = process.argv[1]?.includes('express-postgres');
if (isMain) {
  void main();
}
