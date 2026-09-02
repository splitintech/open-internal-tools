import { createFakeAdapterForScenario } from '@splitin/verification-adapter-sdk';

export interface PostgresRpc {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number }>;
}

const productionRoutesEnabled = false;

export function createEdgeHandler(postgres: PostgresRpc) {
  const adapter = createFakeAdapterForScenario('input_required');

  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!productionRoutesEnabled && url.pathname.includes('/production')) {
      return Response.json({ error: 'production_routes_disabled' }, { status: 403 });
    }
    if (url.pathname.endsWith('/health')) {
      return Response.json({ ok: true, runtime: 'edge', productionRoutesEnabled });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/sandbox/attempts')) {
      const created = await adapter.createAttempt({
        attemptId: 'att_edge_demo',
        subjectReference: 'sub_opaque_edge',
        packageCode: 'human_idv',
        countryCode: 'US',
        idempotencyKey: 'idem_edge_demo',
        configurationRevision: 'cfg_sandbox',
      });
      await postgres.query(
        'insert into verification.attempts(attempt_id, subject_reference, package_code, country_code, provider, provider_resource_id, canonical_status, configuration_revision, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing',
        [
          created.attemptId,
          'sub_opaque_edge',
          'human_idv',
          'US',
          'test_fake',
          created.providerResourceId,
          created.canonicalStatus,
          'cfg_sandbox',
          'idem_edge_demo',
        ],
      );
      return Response.json({
        attemptId: created.attemptId,
        providerResourceId: created.providerResourceId,
        canonicalStatus: created.canonicalStatus,
      }, { status: 201 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  };
}

export function loggingPostgres(): PostgresRpc {
  return {
    async query(sql, params) {
      void sql;
      void params;
      return { rowCount: 1 };
    },
  };
}

async function main(): Promise<void> {
  const handler = createEdgeHandler(loggingPostgres());
  const blocked = await handler(new Request('https://project.supabase.co/functions/v1/verification/production/attempts', { method: 'POST' }));
  process.stdout.write(`${blocked.status}\n`);
}

if (process.argv[1]?.includes('supabase-edge')) {
  void main();
}
