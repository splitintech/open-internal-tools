import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';

export interface DurableStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface WorkerEnv {
  store: DurableStore;
  productionRoutesEnabled: false;
}

export function createHonoLikeApp(env: WorkerEnv) {
  const adapter = createFakeAdapterForScenario('input_required');

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/production') || env.productionRoutesEnabled) {
        return Response.json({ error: 'production_routes_disabled' }, { status: 403 });
      }
      if (url.pathname === '/health') {
        return Response.json({ ok: true, runtime: 'worker', productionRoutesEnabled: false });
      }
      if (request.method === 'POST' && url.pathname === '/sandbox/attempts') {
        const created = await adapter.createAttempt({
          attemptId: 'att_hono_demo',
          subjectReference: 'sub_opaque_hono',
          packageCode: 'human_idv',
          countryCode: 'US',
          idempotencyKey: 'idem_hono_demo',
          configurationRevision: 'cfg_sandbox',
        });
        await env.store.put(created.attemptId, created.providerResourceId);
        return Response.json({
          attemptId: created.attemptId,
          providerResourceId: created.providerResourceId,
          canonicalStatus: created.canonicalStatus,
        }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
  };
}

export function memoryDurableStore(): DurableStore {
  const table = new Map<string, string>();
  return {
    async get(key) {
      return table.get(key) ?? null;
    },
    async put(key, value) {
      table.set(key, value);
    },
  };
}

async function main(): Promise<void> {
  const app = createHonoLikeApp({ store: memoryDurableStore(), productionRoutesEnabled: false });
  const health = await app.fetch(new Request('https://verification.example/health'));
  const blocked = await app.fetch(new Request('https://verification.example/production/attempts', { method: 'POST' }));
  process.stdout.write(`${health.status} ${blocked.status}\n`);
}

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  void main();
}
