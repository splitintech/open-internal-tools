#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const catalogPath = join(root, 'packages/verification-server/src/catalog.ts');
const openapiPath = join(root, 'packages/verification-server/openapi/openapi.v1.json');

const catalog = readFileSync(catalogPath, 'utf8');
const spec = JSON.parse(readFileSync(openapiPath, 'utf8'));

if (spec.openapi !== '3.1.0' && spec.openapi !== '3.1') {
  fail(`Expected OpenAPI 3.1, received ${String(spec.openapi)}`);
}

const routePattern = /path:\s*'([^']+)'/g;
const catalogPaths = new Set();
for (const match of catalog.matchAll(routePattern)) {
  catalogPaths.add(toOpenApiPath(match[1]));
}

if (!catalog.includes('V1_ROUTES') || catalogPaths.size === 0) {
  fail('Unable to parse V1_ROUTES paths from catalog.ts');
}

const openapiPaths = new Set(Object.keys(spec.paths ?? {}));
const missing = [...catalogPaths].filter((path) => !openapiPaths.has(path)).sort();
if (missing.length) {
  fail(`OpenAPI is missing catalog paths:\n${missing.map((path) => `  ${path}`).join('\n')}`);
}

const requiredSchemas = [
  'SessionEnvelopeV1',
  'ProtectedActionDenial',
  'WebhookAccepted',
  'WorkerClaimResult',
  'WorkerProcessResult',
  'AdminHealthSnapshot',
  'AdminAttemptsSnapshot',
];
const schemas = spec.components?.schemas ?? {};
const missingSchemas = requiredSchemas.filter((name) => !schemas[name]);
if (missingSchemas.length) {
  fail(`OpenAPI is missing required schemas: ${missingSchemas.join(', ')}`);
}

const webhook = spec.paths?.['/v1/webhooks/{provider}']?.post;
if (!webhook?.responses?.['202']) {
  fail('Webhook ingest must document HTTP 202.');
}

process.stdout.write(`openapi:check ok (${catalogPaths.size} catalog paths in ${openapiPath})\n`);

function toOpenApiPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
