import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createFakeAdapterForScenario,
  runAdapterConformance,
  runAdapterConformanceScenarios,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  ENGINE_CONTRACT_VERSION,
  STANDARD_PACKAGE_CODES,
  STANDARD_WEBHOOK_PROTOCOLS,
  CANONICAL_STATUSES,
  type AdapterConformanceScenarioFactory,
  type VerificationAdapterV1,
} from '@splitin/verification-adapter-sdk';

import type { ParsedArgv } from './argv.ts';
import { flagBoolean, flagString } from './argv.ts';
import {
  CLI_VERSION,
  defaultConfig,
  envExample,
  loadConfig,
  resolveCwd,
  safeConfigView,
  validateCompatibility,
  validateProviderCredentials,
  writeConfig,
  writeText,
  type VerificationCliConfig,
} from './config.ts';
import { appliedMigrations, listedMigrationFiles, migrateDown, migrateUp } from './migrations.ts';
import { redactSecrets, redactValue } from './redact.ts';
import { SCAFFOLD_PACKAGE, scaffoldProvider } from './scaffold.ts';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function dispatch(parsed: ParsedArgv): Promise<CommandResult> {
  if (parsed.flags.help === true || parsed.command === 'help' || parsed.command === '--help') {
    return ok(usage());
  }
  if (parsed.command === 'version' || parsed.flags.version === true || parsed.flags.v === true) {
    return ok(`${CLI_VERSION}\n`);
  }
  switch (parsed.command) {
    case 'init':
      return cmdInit(parsed);
    case 'config':
      return parsed.subcommand === 'validate' ? cmdConfigValidate(parsed) : fail(`Unknown config command. Use \`config validate\`.\n`);
    case 'doctor':
      return cmdDoctor(parsed);
    case 'db':
      if (parsed.subcommand === 'migrate') return cmdDbMigrate(parsed);
      if (parsed.subcommand === 'rollback') return cmdDbRollback(parsed);
      return fail('Unknown db command. Use `db migrate` or `db rollback`.\n');
    case 'provider':
      if (parsed.subcommand === 'scaffold') return cmdProviderScaffold(parsed);
      if (parsed.subcommand === 'conformance') return cmdProviderConformance(parsed);
      return fail('Unknown provider command. Use `provider scaffold` or `provider conformance`.\n');
    case 'registry':
      return parsed.subcommand === 'generate' ? cmdRegistryGenerate(parsed) : fail('Unknown registry command. Use `registry generate`.\n');
    case 'dev':
      return cmdDev(parsed);
    case 'release':
      return parsed.subcommand === 'verify' ? cmdReleaseVerify(parsed) : fail('Unknown release command. Use `release verify`.\n');
    default:
      return fail(`Unknown command "${parsed.command}".\n\n${usage()}`);
  }
}

function cmdInit(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const force = flagBoolean(parsed.flags, 'force');
  const config = defaultConfig();
  const path = join(cwd, 'verification.config.json');
  if (existsSync(path) && !force) {
    return fail(`Refusing to overwrite ${path}. Pass --force to replace it.\n`);
  }
  writeConfig(cwd, config);
  writeText(join(cwd, '.env.example'), envExample());
  writeText(join(cwd, 'src/generated/.gitkeep'), '');
  const stdout = [
    'Initialized a disabled-by-default development configuration.',
    `Wrote ${path}`,
    'Wrote .env.example (empty placeholders only).',
    'productionEnabled=false productionRoutesEnabled=false environment=sandbox',
    'Fill sandbox credentials locally. The CLI redacts provider secrets and tokens.',
    'Next: splitin-verification config validate && splitin-verification doctor',
    '',
  ].join('\n');
  return ok(stdout);
}

function cmdConfigValidate(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const config = loadConfig(cwd);
  const compatibility = validateCompatibility(config);
  const credentials = validateProviderCredentials(config);
  const view = JSON.stringify(safeConfigView(config), null, 2);
  const lines = [
    `contractVersion=${config.contractVersion} engineCompatibility=${config.engineCompatibility}`,
    `productionEnabled=${config.productionEnabled} productionRoutesEnabled=${config.productionRoutesEnabled}`,
    'Credential check is shape-only. No Identity session, Persona inquiry, or Plaid IDV attempt is created.',
    view,
  ];
  if (compatibility.length || credentials.length) {
    for (const issue of compatibility) lines.push(`ERROR ${issue.code}: ${issue.message}`);
    for (const issue of credentials) lines.push(`ERROR ${issue.provider}/${issue.code}: ${issue.message}`);
    return { exitCode: 1, stdout: redactSecrets(`${lines.join('\n')}\n`), stderr: '' };
  }
  lines.push('Configuration is valid for sandbox development.');
  return ok(`${lines.join('\n')}\n`);
}

function cmdDoctor(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const config = loadConfig(cwd);
  const checks = [
    diagnoseDatabase(config, cwd),
    diagnoseWebhooks(config),
    diagnoseProviders(config),
    diagnoseBrowserKeys(config),
    diagnoseRouting(config),
  ];
  const lines = ['Verification adapter doctor', ...checks.map((check) => `${check.ok ? 'ok' : 'fail'}  ${check.name}: ${check.detail}`)];
  const failed = checks.some((check) => !check.ok);
  return { exitCode: failed ? 1 : 0, stdout: redactSecrets(`${lines.join('\n')}\n`), stderr: '' };
}

function diagnoseDatabase(config: VerificationCliConfig, cwd: string) {
  const applied = appliedMigrations(cwd);
  if (!config.database.schema) {
    return { ok: false, name: 'database', detail: 'Schema name is empty.' };
  }
  if (!config.database.url) {
    return {
      ok: true,
      name: 'database',
      detail: `No DATABASE_URL. Schema "${config.database.schema}" is configured. Applied local revisions: ${applied.join(', ') || 'none'}.`,
    };
  }
  try {
    const url = new URL(config.database.url);
    return {
      ok: url.protocol === 'postgres:' || url.protocol === 'postgresql:',
      name: 'database',
      detail: `Host ${url.hostname} schema ${config.database.schema}. Doctor does not open a live connection or run SQL.`,
    };
  } catch {
    return { ok: false, name: 'database', detail: 'DATABASE_URL is not a valid URL. The value is not printed.' };
  }
}

function diagnoseWebhooks(config: VerificationCliConfig) {
  if (!config.webhooks.publicBaseUrl) {
    return { ok: true, name: 'webhook', detail: 'Public webhook base URL is unset (expected for local sandbox).' };
  }
  try {
    const url = new URL(config.webhooks.publicBaseUrl);
    const okHttps = url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return {
      ok: okHttps,
      name: 'webhook',
      detail: okHttps
        ? `Endpoint origin ${url.origin} tolerance=${config.webhooks.toleranceSeconds}s.`
        : 'Webhook public URL must be HTTPS or loopback.',
    };
  } catch {
    return { ok: false, name: 'webhook', detail: 'Webhook public URL is malformed.' };
  }
}

function diagnoseProviders(config: VerificationCliConfig) {
  const credentials = validateProviderCredentials(config);
  const enabled = Object.entries(config.providers).filter(([, value]) => value.enabled).map(([name]) => name);
  if (credentials.length) {
    return { ok: false, name: 'provider', detail: credentials.map((issue) => `${issue.provider}:${issue.code}`).join(', ') };
  }
  return {
    ok: true,
    name: 'provider',
    detail: enabled.length
      ? `Enabled sandbox providers: ${enabled.join(', ')}. No billable production attempts.`
      : 'No third-party provider enabled. Fake provider remains the default route.',
  };
}

function diagnoseBrowserKeys(config: VerificationCliConfig) {
  const keys = Object.keys(config.browser.publishableKeys);
  return {
    ok: true,
    name: 'browser-key',
    detail: keys.length
      ? `Publishable keys present for ${keys.join(', ')}. Values redacted.`
      : 'No browser publishable keys configured (sandbox fake launcher does not need them).',
  };
}

function diagnoseRouting(config: VerificationCliConfig) {
  if (!config.routing.defaultProvider) {
    return { ok: false, name: 'routing', detail: 'Default provider is missing.' };
  }
  const known = config.providers[config.routing.defaultProvider];
  if (!known && config.routing.defaultProvider !== 'test_fake') {
    return { ok: false, name: 'routing', detail: `Default provider "${config.routing.defaultProvider}" is not in the config.` };
  }
  return {
    ok: true,
    name: 'routing',
    detail: `Default ${config.routing.defaultProvider}; ${config.routing.rules.length} package rule(s). Production routing is disabled.`,
  };
}

function cmdDbMigrate(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const config = loadConfig(cwd);
  const result = migrateUp(cwd, config);
  const files = listedMigrationFiles(cwd, config);
  return ok([
    result.applied.length ? `Applied ${result.applied.join(', ')}.` : 'No pending migrations.',
    `Wrote SQL templates under ${config.database.migrationsDirectory} (${files.length} files).`,
    'SQL is not executed against production. Apply with your own postgres client when ready.',
    '',
  ].join('\n'));
}

function cmdDbRollback(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const config = loadConfig(cwd);
  const result = migrateDown(cwd, config);
  return ok(result.rolledBack
    ? `Rolled back ${result.rolledBack}. SQL was not executed against a live database.\n`
    : 'No applied migrations to roll back.\n');
}

function cmdProviderScaffold(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const directory = flagString(parsed.flags, 'out') || parsed.positionals[0];
  const root = scaffoldProvider(cwd, directory);
  return ok([
    `Wrote fourth-party adapter stub at ${root}`,
    `Custom package: ${SCAFFOLD_PACKAGE}`,
    'The stub is sandbox-only and does not create billable provider attempts.',
    '',
  ].join('\n'));
}

async function cmdProviderConformance(parsed: ParsedArgv): Promise<CommandResult> {
  const command = {
    attemptId: 'att_conformance_cli',
    subjectReference: 'sub_opaque_conformance',
    packageCode: 'human_idv' as const,
    countryCode: 'US',
    idempotencyKey: 'idem_conformance_cli',
    configurationRevision: 'cfg_cli',
  };
  const modulePath = flagString(parsed.flags, 'module');
  const lines: string[] = [];
  try {
    if (!modulePath) {
      const adapter = createFakeAdapterForScenario('input_required');
      const results = await runAdapterConformance(adapter, command);
      lines.push(
        'Running @splitin/verification-adapter-sdk runAdapterConformance against the sandbox fake adapter.',
        'This does not call Stripe, Persona, or Plaid and cannot create billable attempts.',
        ...formatConformance(results),
      );
      const failed = results.filter((result) => !result.passed);
      return { exitCode: failed.length ? 1 : 0, stdout: redactSecrets(`${lines.join('\n')}\n`), stderr: '' };
    }

    const loaded = await loadConformanceModule(modulePath, resolveCwd(parsed.flags));
    const results = await runAdapterConformance(loaded.adapter, command);
    lines.push(
      `Running runAdapterConformance against module ${modulePath}.`,
      'Adapter output is redacted. Secrets, tokens, and credential material are never printed.',
      ...formatConformance(results),
    );
    if (loaded.factory) {
      const scenarios = await runAdapterConformanceScenarios(loaded.factory, command);
      lines.push('Running runAdapterConformanceScenarios for the exported factory.', ...formatConformance(scenarios));
      results.push(...scenarios);
    }
    const failed = results.filter((result) => !result.passed);
    return { exitCode: failed.length ? 1 : 0, stdout: redactSecrets(`${lines.join('\n')}\n`), stderr: '' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown conformance module failure.';
    return fail(`Unable to run provider conformance. ${detail}\n`);
  }
}

function formatConformance(results: Array<{ name: string; passed: boolean; detail?: string }>): string[] {
  return results.map((result) => `${result.passed ? 'pass' : 'fail'}  ${result.name}${result.detail ? `  ${result.detail}` : ''}`);
}

async function loadConformanceModule(
  modulePath: string,
  cwd: string,
): Promise<{ adapter: VerificationAdapterV1; factory: AdapterConformanceScenarioFactory | null }> {
  const absolute = isAbsolute(modulePath) ? modulePath : resolve(cwd, modulePath);
  const imported = await import(pathToFileURL(absolute).href) as Record<string, unknown>;
  const factoryCandidate = pickFunction(
    imported.createAdapterForScenario,
    imported.createAdapter,
    imported.default,
  );
  const isScenarioFactory = typeof factoryCandidate === 'function' && factoryCandidate.length >= 1;
  const adapter = isAdapter(imported.default)
    ? imported.default
    : isAdapter(imported.createAdapter)
      ? imported.createAdapter
      : typeof factoryCandidate === 'function'
        ? await (factoryCandidate as (scenario?: string) => unknown)(isScenarioFactory ? 'input_required' : undefined)
        : null;
  if (!isAdapter(adapter)) {
    throw new Error('Module must export a default adapter, createAdapter, or createAdapterForScenario.');
  }
  return {
    adapter,
    factory: isScenarioFactory ? (factoryCandidate as AdapterConformanceScenarioFactory) : null,
  };
}

function pickFunction(...candidates: unknown[]): ((...args: never[]) => unknown) | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'function') return candidate as (...args: never[]) => unknown;
  }
  return null;
}

function isAdapter(value: unknown): value is VerificationAdapterV1 {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as VerificationAdapterV1).createAttempt === 'function'
    && typeof (value as VerificationAdapterV1).retrieveAttempt === 'function';
}

function cmdRegistryGenerate(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const config = loadConfig(cwd);
  const out = flagString(parsed.flags, 'out', 'src/generated/verification-registry.ts');
  const contents = `/* Generated by splitin-verification registry generate. Do not edit. */
export const verificationAdapterContractVersion = ${JSON.stringify(VERIFICATION_ADAPTER_CONTRACT_VERSION)} as const;
export const verificationEngineContractVersion = ${JSON.stringify(ENGINE_CONTRACT_VERSION)} as const;
export const verificationCliVersion = ${JSON.stringify(CLI_VERSION)} as const;
export const standardPackageCodes = ${JSON.stringify(STANDARD_PACKAGE_CODES, null, 2)} as const;
export const standardWebhookProtocols = ${JSON.stringify(STANDARD_WEBHOOK_PROTOCOLS, null, 2)} as const;
export const canonicalStatuses = ${JSON.stringify(CANONICAL_STATUSES, null, 2)} as const;
export const configuredProviders = ${JSON.stringify(Object.keys(config.providers), null, 2)} as const;
export const productionRoutesEnabled = false;
export type StandardPackageCode = typeof standardPackageCodes[number];
export type ConfiguredProvider = typeof configuredProviders[number];
`;
  writeText(join(cwd, out), contents);
  return ok(`Wrote typed registry ${out}. productionRoutesEnabled=false.\n`);
}

function cmdDev(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const config = loadConfig(cwd);
  if (config.productionEnabled || config.productionRoutesEnabled) {
    return fail('Refusing to start because production routes are enabled. Set productionEnabled=false.\n');
  }
  const port = Number(flagString(parsed.flags, 'port', '8787')) || 8787;
  if (flagBoolean(parsed.flags, 'print-only')) {
    return ok(`Sandbox dev listener would bind 127.0.0.1:${port}. Production routes stay disabled.\n`);
  }
  const server = createServer((request, response) => {
    void handleDevRequest(request, response);
  });
  server.listen(port, '127.0.0.1');
  return ok(`Sandbox verification listener on http://127.0.0.1:${port}\nProduction routes disabled. GET /health, POST /sandbox/attempts.\n`);
}

async function handleDevRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    json(response, 200, { ok: true, environment: 'sandbox', productionRoutesEnabled: false });
    return;
  }
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/production/')) {
    json(response, 403, { error: 'production_routes_disabled' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/sandbox/attempts') {
    const adapter = createFakeAdapterForScenario('input_required');
    const created = await adapter.createAttempt({
      attemptId: 'att_dev_local',
      subjectReference: 'sub_opaque_dev',
      packageCode: 'human_idv',
      countryCode: 'US',
      idempotencyKey: 'idem_dev_local',
      configurationRevision: 'cfg_dev',
    });
    json(response, 201, redactValue({
      attemptId: created.attemptId,
      providerResourceId: created.providerResourceId,
      canonicalStatus: created.canonicalStatus,
      launcherKey: created.launch.launcherKey,
    }));
    return;
  }
  json(response, 404, { error: 'not_found' });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(`${JSON.stringify(body)}\n`);
}

function cmdReleaseVerify(parsed: ParsedArgv): CommandResult {
  const cwd = resolveCwd(parsed.flags);
  const lines = [
    `cli=${CLI_VERSION} contract=${VERIFICATION_ADAPTER_CONTRACT_VERSION} engine=${ENGINE_CONTRACT_VERSION}`,
    'npm trusted publishing must use OIDC (id-token: write). Do not embed an npm token.',
    'Publish 0.1.0-beta.0 first. Promote to 1.0.0 only after sandbox certification.',
    'productionEnabled must remain false in distributed examples.',
  ];
  if (existsSync(join(cwd, 'verification.config.json'))) {
    const config = loadConfig(cwd);
    if (config.productionEnabled || config.productionRoutesEnabled) {
      return fail(`${lines.join('\n')}\nERROR production_disabled: release artifacts must keep production routes off.\n`);
    }
  }
  lines.push('Release preflight passed.');
  return ok(`${lines.join('\n')}\n`);
}

function usage(): string {
  return `splitin-verification ${CLI_VERSION}

Usage: splitin-verification <command> [subcommand] [options]

Commands:
  init                     Write disabled-by-default sandbox configuration
  config validate          Validate contract/API versions and credential shape
  doctor                   Diagnose database, webhook, provider, browser-key, routing
  db migrate               Write and record SQL migrations (does not apply to prod)
  db rollback              Roll back the last recorded local migration
  provider scaffold        Write a fourth-party adapter stub (${SCAFFOLD_PACKAGE})
  provider conformance     Run @splitin/verification-adapter-sdk runAdapterConformance
  registry generate        Write a typed provider/package registry
  dev                      Bind a sandbox-only listener (production routes disabled)
  release verify           Check versions, provenance policy, and production flags

Global options:
  --cwd <dir>              Working directory
  --module <path>          Adapter module for \`provider conformance\` (default: fake)
  --help                   Show this help
`;
}

function ok(stdout: string): CommandResult {
  return { exitCode: 0, stdout: redactSecrets(stdout), stderr: '' };
}

function fail(stderr: string): CommandResult {
  return { exitCode: 1, stdout: '', stderr: redactSecrets(stderr) };
}
