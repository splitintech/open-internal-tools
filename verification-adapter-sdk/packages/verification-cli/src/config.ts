import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  ENGINE_CONTRACT_VERSION,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  majorsCompatible,
} from '@splitin/verification-adapter-sdk';

import { redactValue } from './redact.ts';

export const CONFIG_FILE_NAME = 'verification.config.json';
export const CLI_VERSION = '0.1.0-beta.0';

export interface ProviderCredentialConfig {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
  apiVersion: string;
}

export interface VerificationCliConfig {
  contractVersion: string;
  engineCompatibility: string;
  environment: 'sandbox' | 'production';
  productionEnabled: boolean;
  productionRoutesEnabled: boolean;
  database: {
    url: string;
    schema: string;
    migrationsDirectory: string;
  };
  webhooks: {
    publicBaseUrl: string;
    toleranceSeconds: number;
  };
  browser: {
    publishableKeys: Record<string, string>;
  };
  routing: {
    defaultProvider: string;
    rules: Array<{ packageCode: string; provider: string; countryCode?: string }>;
  };
  providers: Record<string, ProviderCredentialConfig>;
}

export function defaultConfig(): VerificationCliConfig {
  return {
    contractVersion: VERIFICATION_ADAPTER_CONTRACT_VERSION,
    engineCompatibility: ENGINE_CONTRACT_VERSION,
    environment: 'sandbox',
    productionEnabled: false,
    productionRoutesEnabled: false,
    database: {
      url: '',
      schema: 'verification',
      migrationsDirectory: 'migrations/verification',
    },
    webhooks: {
      publicBaseUrl: '',
      toleranceSeconds: 300,
    },
    browser: {
      publishableKeys: {},
    },
    routing: {
      defaultProvider: 'test_fake',
      rules: [{ packageCode: 'human_idv', provider: 'test_fake', countryCode: 'US' }],
    },
    providers: {
      test_fake: disabledProvider('sandbox', 'fake-1'),
      stripe_identity: disabledProvider('sandbox', '2024-06-20'),
      persona: disabledProvider('sandbox', '2023-01-05'),
      plaid_idv: disabledProvider('sandbox', '2020-09-14'),
    },
  };
}

function disabledProvider(environment: 'sandbox' | 'production', apiVersion: string): ProviderCredentialConfig {
  return {
    enabled: false,
    environment,
    secretKey: '',
    webhookSecret: '',
    publishableKey: '',
    apiVersion,
  };
}

export function configPath(cwd: string): string {
  return join(cwd, CONFIG_FILE_NAME);
}

export function loadConfig(cwd: string): VerificationCliConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) {
    throw new Error(`Missing ${CONFIG_FILE_NAME}. Run \`splitin-verification init\` first.`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as VerificationCliConfig;
  return { ...defaultConfig(), ...parsed, providers: { ...defaultConfig().providers, ...parsed.providers } };
}

export function writeConfig(cwd: string, config: VerificationCliConfig): string {
  const path = configPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return path;
}

export function safeConfigView(config: VerificationCliConfig): unknown {
  return redactValue(config);
}

export interface CompatibilityIssue {
  code: string;
  message: string;
}

export function validateCompatibility(config: VerificationCliConfig): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  if (config.contractVersion !== VERIFICATION_ADAPTER_CONTRACT_VERSION) {
    issues.push({
      code: 'contract_version',
      message: `Config contract ${config.contractVersion} does not match SDK ${VERIFICATION_ADAPTER_CONTRACT_VERSION}.`,
    });
  }
  if (!majorsCompatible(config.engineCompatibility, ENGINE_CONTRACT_VERSION)) {
    issues.push({
      code: 'engine_incompatible',
      message: `Engine compatibility ${config.engineCompatibility} is not compatible with ${ENGINE_CONTRACT_VERSION}.`,
    });
  }
  if (config.productionEnabled || config.productionRoutesEnabled || config.environment === 'production') {
    issues.push({
      code: 'production_disabled',
      message: 'Production routes and production environment are disabled until sandbox certification.',
    });
  }
  return issues;
}

export interface CredentialIssue {
  provider: string;
  code: string;
  message: string;
}

/**
 * Validates credential *shape* and sandbox/production split without creating
 * Identity sessions, Persona inquiries, or Plaid IDV attempts.
 */
export function validateProviderCredentials(config: VerificationCliConfig): CredentialIssue[] {
  const issues: CredentialIssue[] = [];
  for (const [provider, credentials] of Object.entries(config.providers)) {
    if (!credentials.enabled) continue;
    if (credentials.environment === 'production' || looksLikeLiveSecret(credentials.secretKey)) {
      issues.push({
        provider,
        code: 'production_credential_blocked',
        message: `Provider "${provider}" has a live or production credential. The CLI never creates billable production attempts.`,
      });
    }
    if (credentials.secretKey && !looksLikeSandboxSecret(credentials.secretKey) && !looksLikeLiveSecret(credentials.secretKey)) {
      issues.push({
        provider,
        code: 'unrecognized_secret_prefix',
        message: `Provider "${provider}" secret does not use a recognized sandbox prefix. Values are never printed.`,
      });
    }
    if (credentials.webhookSecret && !credentials.webhookSecret.startsWith('whsec_') && provider !== 'test_fake') {
      issues.push({
        provider,
        code: 'webhook_secret_shape',
        message: `Provider "${provider}" webhook secret should use a sandbox webhook prefix. The value is not printed.`,
      });
    }
    if (!credentials.apiVersion.trim()) {
      issues.push({
        provider,
        code: 'api_version_missing',
        message: `Provider "${provider}" is missing a pinned API version.`,
      });
    }
  }
  return issues;
}

export function looksLikeLiveSecret(value: string): boolean {
  return /^(?:sk_live_|rk_live_)/.test(value) || (value.startsWith('sk_') && !value.includes('test'));
}

export function looksLikeSandboxSecret(value: string): boolean {
  return /^(?:sk_test_|rk_test_|test_|sandbox_)/.test(value) || value.startsWith('whsec_test');
}

export function resolveCwd(flags: Record<string, string | boolean>): string {
  const cwd = flags.cwd ?? flags.C;
  return resolve(typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd());
}

export function writeText(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

export function envExample(): string {
  return `# SplitIn verification adapter SDK — development placeholders only.
# Production is disabled. Never commit real secrets.

VERIFICATION_ENVIRONMENT=sandbox
VERIFICATION_PRODUCTION_ENABLED=false
VERIFICATION_PRODUCTION_ROUTES_ENABLED=false

DATABASE_URL=
VERIFICATION_DATABASE_SCHEMA=verification

STRIPE_IDENTITY_SECRET_KEY=
STRIPE_IDENTITY_WEBHOOK_SECRET=
STRIPE_IDENTITY_PUBLISHABLE_KEY=

PERSONA_API_KEY=
PERSONA_WEBHOOK_SECRET=

PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_WEBHOOK_SECRET=

VERIFICATION_WEBHOOK_PUBLIC_BASE_URL=
VERIFICATION_BROWSER_PUBLISHABLE_KEY=
`;
}
