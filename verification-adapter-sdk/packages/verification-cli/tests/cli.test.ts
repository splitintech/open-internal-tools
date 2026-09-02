import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseArgv } from '../src/argv.ts';
import { run } from '../src/cli.ts';
import { redactSecrets, redactValue } from '../src/redact.ts';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'verification-cli-'));
}

describe('splitin-verification init', () => {
  it('writes disabled-by-default development configuration and never prints secrets', async () => {
    const cwd = tempWorkspace();
    try {
      const result = await run(['node', 'splitin-verification', 'init', '--cwd', cwd]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('productionEnabled=false');
      expect(result.stdout).toContain('productionRoutesEnabled=false');
      expect(result.stdout).toContain('environment=sandbox');
      expect(result.stdout).not.toMatch(/sk_(?:test|live)_/);
      expect(result.stdout).not.toMatch(/rk_(?:test|live)_/);
      expect(result.stdout).not.toMatch(/whsec_[A-Za-z0-9]/);
      expect(result.stdout.toLowerCase()).not.toMatch(/\btoken=[A-Za-z0-9]/);

      const config = JSON.parse(readFileSync(join(cwd, 'verification.config.json'), 'utf8')) as {
        productionEnabled: boolean;
        productionRoutesEnabled: boolean;
        environment: string;
        providers: Record<string, { enabled: boolean; secretKey: string }>;
      };
      expect(config.productionEnabled).toBe(false);
      expect(config.productionRoutesEnabled).toBe(false);
      expect(config.environment).toBe('sandbox');
      expect(Object.values(config.providers).every((provider) => provider.enabled === false)).toBe(true);
      expect(Object.values(config.providers).every((provider) => provider.secretKey === '')).toBe(true);

      const env = readFileSync(join(cwd, '.env.example'), 'utf8');
      expect(env).toContain('VERIFICATION_PRODUCTION_ENABLED=false');
      expect(env).toContain('STRIPE_IDENTITY_SECRET_KEY=');
      expect(env).not.toMatch(/sk_live_|sk_test_[A-Za-z0-9]+/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('validates the generated config without creating billable attempts', async () => {
    const cwd = tempWorkspace();
    try {
      await run(['node', 'splitin-verification', 'init', '--cwd', cwd]);
      const result = await run(['node', 'splitin-verification', 'config', 'validate', '--cwd', cwd]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No Identity session');
      expect(result.stdout).toContain('sandbox development');
      expect(result.stdout).not.toMatch(/\bsk_[A-Za-z0-9]+/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('secret redaction', () => {
  it('redacts sk_, rk_, whsec_, and tokens before any CLI output', () => {
    const leaked = [
      'secretKey=sk_test_51ABCDEFGHIJKLMNOP',
      'restricted=rk_live_abc123',
      'webhook=whsec_abcdefghijklmnopqrstuv',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      'access_token: supersecrettokenvalue',
    ].join('\n');
    const redacted = redactSecrets(leaked);
    expect(redacted).not.toContain('sk_test_51ABCDEFGHIJKLMNOP');
    expect(redacted).not.toContain('rk_live_abc123');
    expect(redacted).not.toContain('whsec_abcdefghijklmnopqrstuv');
    expect(redacted).not.toContain('supersecrettokenvalue');
    expect(redacted).toContain('sk_***');
    expect(redacted).toContain('rk_***');
    expect(redacted).toContain('whsec_***');
    expect(redacted).toContain('Bearer ***');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(JSON.stringify(redactValue({ secretKey: 'sk_live_should_never_print', token: 'abc' }))).not.toContain('sk_live_should_never_print');
  });
});

describe('argv parser', () => {
  it('parses nested commands without extra dependencies', () => {
    const parsed = parseArgv(['node', 'splitin-verification', 'provider', 'scaffold', '--cwd', '/tmp/demo']);
    expect(parsed.command).toBe('provider');
    expect(parsed.subcommand).toBe('scaffold');
    expect(parsed.flags.cwd).toBe('/tmp/demo');
  });
});

describe('db migrate', () => {
  it('writes the real verification schema including tenant isolation', async () => {
    const cwd = tempWorkspace();
    try {
      await run(['node', 'splitin-verification', 'init', '--cwd', cwd]);
      const result = await run(['node', 'splitin-verification', 'db', 'migrate', '--cwd', cwd]);
      expect(result.exitCode).toBe(0);
      const up = readFileSync(join(cwd, 'migrations/verification/001_init.up.sql'), 'utf8');
      expect(up).toContain('CREATE SCHEMA IF NOT EXISTS verification');
      expect(up).toContain('tenant_key');
      expect(up).toContain('audit_events');
      expect(up).toContain('redaction_jobs');
      expect(up).not.toContain('subject_reference TEXT NOT NULL');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('provider conformance and sandbox launch', () => {
  it('runs fake adapter conformance without printing secrets', async () => {
    const result = await run(['node', 'splitin-verification', 'provider', 'conformance']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('sandbox fake adapter');
    expect(result.stdout).toContain('pass  terminal_monotonicity');
    expect(result.stdout).not.toMatch(/sk_(?:test|live)_/);
    expect(result.stdout).not.toMatch(/whsec_[A-Za-z0-9]/);
  });

  it('loads --module adapters and runs scenario factories without printing secrets', async () => {
    const modulePath = fileURLToPath(new URL('./fixtures/conformance-adapter.mjs', import.meta.url));
    const result = await run(['node', 'splitin-verification', 'provider', 'conformance', '--module', modulePath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Running runAdapterConformance against module');
    expect(result.stdout).toContain('runAdapterConformanceScenarios');
    expect(result.stdout).toContain('pass  success');
    expect(result.stdout).not.toMatch(/sk_(?:test|live)_/);
    expect(result.stdout).not.toMatch(/rk_(?:test|live)_/);
    expect(result.stdout).not.toContain('whsec_');
  });

  it('prints a sandbox bind address with --print-only', async () => {
    const cwd = tempWorkspace();
    try {
      await run(['node', 'splitin-verification', 'init', '--cwd', cwd]);
      const result = await run(['node', 'splitin-verification', 'dev', '--cwd', cwd, '--print-only']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('127.0.0.1:8787');
      expect(result.stdout).toContain('Production routes stay disabled');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
