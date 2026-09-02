import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { listV1Paths, V1_ROUTES } from '../src/catalog.ts';
import { VerificationHttpError } from '../src/errors.ts';
import { createVerificationFetchHandler } from '../src/handler.ts';
import { buildOpenApiDocument, toOpenApiPath } from '../src/openapi.ts';
import { runContractSuite } from './contract.ts';
import { createFakePlatform, userActor } from './fake-platform.ts';

describe('verification-server web handler', () => {
  it('satisfies the shared HTTP contract', async () => {
    const platform = createFakePlatform();
    const handler = createVerificationFetchHandler(platform, {
      allowedOrigins: ['https://app.example.com'],
      resolveActor: async (request) => {
        const authorization = request.headers.get('authorization') ?? '';
        const match = /^Bearer (user|operator|system):(.+)$/.exec(authorization);
        if (!match) throw new VerificationHttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
        const type = match[1] as 'user' | 'operator' | 'system';
        const actorId = match[2]!;
        if (type === 'user') return { ...userActor, actorId };
        if (type === 'operator') {
          return { tenantKey: 'default', actorId, actorType: 'operator', roles: actorId === 'ops_2' ? ['approver', 'operator'] : ['operator'], authorizedSubjectScope: ['*'] };
        }
        return { tenantKey: 'default', actorId, actorType: 'system', roles: ['worker'], authorizedSubjectScope: ['*'] };
      },
    });
    await runContractSuite(handler);
  });

  it('never echoes provider secrets in error envelopes', async () => {
    const handler = createVerificationFetchHandler(createFakePlatform(), {
      allowedOrigins: ['https://app.example.com'],
      resolveActor: async () => {
        throw new Error('provider body contained sk_live_abc and webhook whsec_123');
      },
    });
    const response = await handler(new Request('https://app.example.com/v1/sessions', {
      method: 'POST',
      headers: { authorization: 'Bearer user:user_1', origin: 'https://app.example.com', 'content-type': 'application/json', 'idempotency-key': 'idem-secret' },
      body: JSON.stringify({ packageCode: 'human_idv' }),
    }));
    const body = await response.text();
    expect(body).not.toMatch(/sk_live|whsec_/);
    expect(JSON.parse(body).error.code).toBeDefined();
  });
});

describe('openapi', () => {
  it('keeps handler paths in sync with OpenAPI 3.1', () => {
    const document = buildOpenApiDocument();
    expect(document.openapi).toBe('3.1.0');
    const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../openapi/openapi.v1.json'), 'utf8')) as { paths: Record<string, unknown> };
    const expected = listV1Paths().map(toOpenApiPath).sort();
    expect(Object.keys(spec.paths).sort()).toEqual(expected);
    expect(Object.keys(document.paths as object).sort()).toEqual(expected);
    const catalogMethods = V1_ROUTES.map((route) => `${route.method} ${toOpenApiPath(route.path)}`).sort();
    const specMethods: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of Object.keys(item as object)) {
        specMethods.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(specMethods.sort()).toEqual(catalogMethods);
  });
});

describe('package boundaries', () => {
  it('keeps core handlers free of express and hono imports', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../src');
    const core = ['index.ts', 'handler.ts', 'catalog.ts', 'auth.ts', 'json.ts', 'errors.ts', 'types.ts', 'openapi.ts']
      .map((file) => readFileSync(join(root, file), 'utf8'))
      .join('\n');
    expect(core).not.toMatch(/from ['"]express['"]/);
    expect(core).not.toMatch(/from ['"]hono['"]/);
    expect(core).not.toMatch(/from ['"]@supabase\//);
  });
});
