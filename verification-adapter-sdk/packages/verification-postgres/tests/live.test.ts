import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const url = process.env.VERIFICATION_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)('live PostgreSQL 15/16', () => {
  it('applies and rolls back migrations, isolates tenants, and keeps audit immutable', async () => {
    const pg = await import('pg');
    const Client = (pg as { default?: { Client: typeof import('pg').Client }; Client?: typeof import('pg').Client }).default?.Client
      ?? (pg as { Client: typeof import('pg').Client }).Client;
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS verification CASCADE');
      for (const file of ['001_init.sql', '002_seed.sql', '003_retention.sql']) {
        await runSql(client, readFileSync(path.join(here, '../migrations', file), 'utf8'));
      }

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'verification' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toContain('attempts');
      expect(tables.rows.map((row) => row.table_name)).toContain('audit_events');

      await runSql(client, readFileSync(path.join(here, '../migrations/003_retention.down.sql'), 'utf8'));
      const dropped = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'verification' AND table_name = 'policy_versions' AND column_name = 'legal_hold'`,
      );
      expect(dropped.rows).toEqual([]);
      await runSql(client, readFileSync(path.join(here, '../migrations/003_retention.sql'), 'utf8'));

      await client.query(`INSERT INTO verification.tenants (tenant_key, display_name) VALUES ('alpha', 'Alpha') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO verification.tenants (tenant_key, display_name) VALUES ('beta', 'Beta') ON CONFLICT DO NOTHING`);
      await insertAttempt(client, 'alpha', 'att_alpha');
      const cross = await client.query(
        `SELECT id FROM verification.attempts WHERE tenant_key = $1 AND id = $2`,
        ['beta', 'att_alpha'],
      );
      expect(cross.rowCount).toBe(0);
      const own = await client.query(
        `SELECT id FROM verification.attempts WHERE tenant_key = $1 AND id = $2`,
        ['alpha', 'att_alpha'],
      );
      expect(own.rowCount).toBe(1);

      await client.query(
        `INSERT INTO verification.audit_events (tenant_key, id, actor_id, actor_type, operation, resource_type, safe_metadata)
         VALUES ('alpha', 'aud_1', 'ops', 'operator', 'start', 'attempt', '{}'::jsonb)`,
      );
      await expect(client.query(`UPDATE verification.audit_events SET operation = 'tamper' WHERE id = 'aud_1'`))
        .rejects.toThrow(/insert-only/i);

      const plan = await client.query(
        `EXPLAIN (FORMAT JSON) SELECT * FROM verification.routes
         WHERE tenant_key = 'default' AND environment = 'sandbox' AND package_code = 'human_idv' AND lifecycle = 'active'`,
      );
      const json = JSON.stringify(plan.rows);
      expect(json).toContain('Plan');

      await client.query('BEGIN');
      const claimed = await client.query(
        `SELECT id FROM verification.redaction_jobs
         WHERE tenant_key = 'default' AND status IN ('scheduled', 'retryable', 'processing')
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      expect(claimed.command).toBe('SELECT');
      await client.query('ROLLBACK');
    } finally {
      await client.query('DROP SCHEMA IF EXISTS verification CASCADE');
      await client.end();
    }
  });
});

async function runSql(client: { query: (sql: string) => Promise<unknown> }, sql: string): Promise<void> {
  for (const statement of splitSql(sql)) {
    await client.query(statement);
  }
}

function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let buffer = '';
  let inDollar = false;
  for (const line of sql.split('\n')) {
    buffer += `${line}\n`;
    const trimmed = line.trim();
    if (!inDollar && trimmed.includes('$$') && !trimmed.endsWith('$$;')) {
      inDollar = true;
      continue;
    }
    if (inDollar && trimmed.endsWith('$$;')) {
      inDollar = false;
      statements.push(buffer);
      buffer = '';
      continue;
    }
    if (!inDollar && trimmed.endsWith(';') && !trimmed.startsWith('--')) {
      statements.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) statements.push(buffer);
  return statements.map((item) => item.trim()).filter((item) => item && !item.startsWith('--'));
}

async function insertAttempt(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, tenant: string, id: string) {
  const hash = 'a'.repeat(64);
  const digest = 'b'.repeat(64);
  await client.query(
    `INSERT INTO verification.attempts (
       tenant_key, id, subject_hash, package_code, country_code, provider, environment,
       adapter_version, manifest_digest, configuration_revision, policy_version, canonical_status,
       status_version, idempotency_key, route_id, selection_reason, created_at, updated_at
     ) VALUES ($1,$2,$3,'human_idv','US','test_fake','sandbox','1.0.0',$4,'cfg','pol','created',0,$5,'rte_alpha','primary', now(), now())`,
    [tenant, id, hash, digest, `idem_${id}`],
  );
}
