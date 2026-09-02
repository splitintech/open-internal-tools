import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { REDACTION_STATUSES, REQUIRED_TABLES, SCHEMA_NAME } from '../src/catalog.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const initSql = readFileSync(path.join(here, '../migrations/001_init.sql'), 'utf8');
const seedSql = readFileSync(path.join(here, '../migrations/002_seed.sql'), 'utf8');
const retentionSql = readFileSync(path.join(here, '../migrations/003_retention.sql'), 'utf8');
const hardeningSql = readFileSync(path.join(here, '../migrations/supabaseHardening.sql'), 'utf8');

describe('verification postgres catalog', () => {
  it('uses the fixed schema name and required tables', () => {
    expect(SCHEMA_NAME).toBe('verification');
    expect(initSql).toContain('CREATE SCHEMA IF NOT EXISTS verification');
    for (const table of REQUIRED_TABLES) {
      expect(initSql).toContain(`CREATE TABLE verification.${table}`);
    }
    expect(initSql).toMatch(/PRIMARY KEY \(tenant_key/);
  });

  it('indexes routes, live attempts, valid decisions, and pending jobs', () => {
    expect(initSql).toContain('routes_active_selection_idx');
    expect(initSql).toContain('attempts_active_idx');
    expect(initSql).toContain('decisions_valid_idx');
    expect(initSql).toContain('reconciliation_pending_idx');
    expect(initSql).toContain('redaction_pending_idx');
    expect(initSql).toContain('WHERE lifecycle = \'active\'');
    expect(initSql).toContain('WHERE status = \'verified\' AND revoked_at IS NULL');
  });

  it('keeps audit_events insert-only and hashes subject references', () => {
    expect(initSql).toContain('audit_events are insert-only');
    expect(initSql).toContain('subject_hash text NOT NULL CHECK (subject_hash ~ \'^[a-f0-9]{64}$\')');
    expect(initSql).toContain('body_sha256 text NOT NULL');
    expect(initSql).toMatch(/raw webhook|hosted url|selfie/i);
  });

  it('seeds tenant default with sandbox examples and no active production route', () => {
    expect(seedSql).toContain("VALUES ('default'");
    expect(seedSql).toContain("'sandbox'");
    expect(seedSql).not.toMatch(/environment, package_code[\s\S]*'production'[\s\S]*'active'/);
    expect(seedSql).toContain('production-unactivated');
  });

  it('documents redaction statuses and optional supabase hardening', () => {
    expect(REDACTION_STATUSES).toEqual([
      'scheduled', 'processing', 'retryable', 'redacted', 'not_applicable', 'dead_letter',
    ]);
    for (const status of REDACTION_STATUSES) {
      expect(initSql).toContain(`'${status}'`);
    }
    expect(hardeningSql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(hardeningSql).toContain('FORCE ROW LEVEL SECURITY');
    expect(hardeningSql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA verification FROM anon, authenticated');
  });

  it('requires production retention columns before an active production policy', () => {
    expect(retentionSql).toContain('decision_retention_days');
    expect(retentionSql).toContain('provider_redaction_delay_days');
    expect(retentionSql).toContain('appeal_hold_days');
    expect(retentionSql).toContain('legal_hold');
    expect(retentionSql).toContain('production_retention_complete');
  });
});
