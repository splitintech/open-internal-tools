import type { ActorContext } from '@splitin/verification-adapter-sdk';

import { createVerificationFetchHandler } from './handler.ts';
import type { VerificationFetchHandlerOptions, VerificationServerPlatform } from './types.ts';

export interface ExpressIncoming {
  method?: string;
  url?: string;
  originalUrl?: string;
  protocol?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  rawBody?: Uint8Array | Buffer | string;
  get?(name: string): string | undefined;
}

export interface ExpressOutgoing {
  statusCode: number;
  setHeader(name: string, value: string | number | readonly string[]): void;
  end(chunk?: unknown): void;
}

export interface VerificationExpressOptions extends VerificationFetchHandlerOptions {
  /** Optional Express-native actor resolver. When set, it is translated into resolveActor. */
  resolveExpressActor?(req: ExpressIncoming): Promise<ActorContext>;
}

/**
 * Express binding. Translates req/res into Web API Request/Response only.
 */
export function createVerificationExpressHandler(
  platform: VerificationServerPlatform,
  options: VerificationExpressOptions,
) {
  return async (req: ExpressIncoming, res: ExpressOutgoing, next?: (error?: unknown) => void): Promise<void> => {
    try {
      const request = expressToWebRequest(req);
      const handler = createVerificationFetchHandler(platform, {
        ...options,
        resolveActor: options.resolveExpressActor
          ? async () => options.resolveExpressActor!(req)
          : options.resolveActor,
      });
      await applyWebResponse(res, await handler(request));
    } catch (error) {
      if (next) next(error);
      else throw error;
    }
  };
}

export function expressToWebRequest(req: ExpressIncoming): Request {
  const protocol = req.protocol ?? 'http';
  const host = req.get?.('host') ?? headerValue(req.headers.host) ?? '127.0.0.1';
  const path = req.originalUrl ?? req.url ?? '/';
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  const method = (req.method ?? 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : serializeExpressBody(req);
  return new Request(`${protocol}://${host}${path}`, {
    method,
    headers,
    body: body as unknown as BodyInit | undefined,
  });
}

export async function applyWebResponse(res: ExpressOutgoing, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function serializeExpressBody(req: ExpressIncoming): BodyInit | undefined {
  if (req.rawBody instanceof Uint8Array) return asRequestBody(req.rawBody);
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === 'string') return req.body;
  if (req.body instanceof Uint8Array) return asRequestBody(req.body);
  return JSON.stringify(req.body);
}

function asRequestBody(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
