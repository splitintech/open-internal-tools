import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createVerificationExpressHandler, expressToWebRequest } from '../src/express.ts';
import { createVerificationHonoHandler } from '../src/hono.ts';
import { createVerificationSupabaseHandler } from '../src/supabase.ts';
import { actorHeader, runContractSuite, type FetchLike } from './contract.ts';
import { createFakePlatform, userActor } from './fake-platform.ts';
import type { ActorContext } from '@splitin/verification-adapter-sdk';
import type { ExpressIncoming, ExpressOutgoing } from '../src/express.ts';
import { VerificationHttpError } from '../src/errors.ts';

function resolveActor(request: Request): Promise<ActorContext> {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer (user|operator|system):(.+)$/.exec(authorization);
  if (!match) throw new VerificationHttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  const type = match[1] as 'user' | 'operator' | 'system';
  const actorId = match[2]!;
  if (type === 'user') return Promise.resolve({ ...userActor, actorId });
  if (type === 'operator') {
    return Promise.resolve({
      tenantKey: 'default',
      actorId,
      actorType: 'operator',
      roles: actorId === 'ops_2' ? ['approver', 'operator'] : ['operator'],
      authorizedSubjectScope: ['*'],
    });
  }
  return Promise.resolve({ tenantKey: 'default', actorId, actorType: 'system', roles: ['worker'], authorizedSubjectScope: ['*'] });
}

const options = {
  allowedOrigins: ['https://app.example.com'],
  resolveActor,
};

function expressFetch(platform = createFakePlatform()): FetchLike {
  const middleware = createVerificationExpressHandler(platform, options);
  return async (request) => {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const rawBody = request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer());
    const req: ExpressIncoming = {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      protocol: 'https',
      headers,
      rawBody,
      get: (name) => (name.toLowerCase() === 'host' ? url.host : headers[name.toLowerCase()]),
    };
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let payload: Buffer = Buffer.alloc(0);
    const res: ExpressOutgoing = {
      statusCode: 200,
      setHeader(name, value) {
        responseHeaders[name] = String(value);
      },
      end(chunk) {
        statusCode = res.statusCode;
        if (chunk) payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      },
    };
    await middleware(req, res);
    return new Response(new Uint8Array(payload), { status: statusCode, headers: responseHeaders });
  };
}

describe('framework adapters share the contract suite', () => {
  it('express adapter', async () => {
    await runContractSuite(expressFetch());
  });

  it('hono adapter', async () => {
    const app = new Hono();
    const handler = createVerificationHonoHandler(createFakePlatform(), options);
    app.all('/v1', (context) => handler(context));
    app.all('/v1/*', (context) => handler(context));
    await runContractSuite((request) => Promise.resolve(app.fetch(request)));
  });

  it('supabase-style wrapper', async () => {
    const handler = createVerificationSupabaseHandler(createFakePlatform(), {
      allowedOrigins: ['https://app.example.com'],
      getUser: async (request) => {
        const authorization = request.headers.get('authorization') ?? '';
        const match = /^Bearer (user|operator|system):(.+)$/.exec(authorization);
        return match ? { id: match[2]! } : null;
      },
      resolveActor: async (request, user) => {
        if (!user) throw new VerificationHttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
        return resolveActor(request);
      },
    });
    await runContractSuite(handler);
  });
});

describe('express translation', () => {
  it('round-trips method, path, and raw body', () => {
    const request = expressToWebRequest({
      method: 'POST',
      originalUrl: '/v1/webhooks/test_fake',
      protocol: 'https',
      headers: { host: 'app.example.com', 'content-type': 'application/json' },
      rawBody: new TextEncoder().encode('{"id":"evt"}'),
      get: (name) => name === 'host' ? 'app.example.com' : undefined,
    });
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/v1/webhooks/test_fake');
  });
});

void actorHeader;
