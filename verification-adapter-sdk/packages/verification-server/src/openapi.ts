import { listV1Paths, V1_ROUTES } from './catalog.ts';

export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of V1_ROUTES) {
    const path = toOpenApiPath(route.path);
    const item = paths[path] ?? {};
    item[route.method.toLowerCase()] = {
      operationId: route.id,
      summary: route.id.replace(/[._]/g, ' '),
      security: route.auth === 'none' ? [] : [{ actor: [] }],
      parameters: [
        ...(route.idempotency
          ? [{
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 8, maxLength: 128 },
          }]
          : []),
        ...pathParams(path),
      ],
      responses: {
        '200': { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } },
        '202': { description: 'Accepted' },
        '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/SafeErrorEnvelope' } } } },
        '401': { description: 'Unauthenticated' },
        '403': { description: 'Forbidden' },
        '404': { description: 'Not found' },
      },
    };
    paths[path] = item;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'SplitIn Verification Server API',
      version: '1.0.0',
      license: { name: 'MIT' },
      description: 'Provider-neutral verification session, webhook, worker, and operations API.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        actor: { type: 'http', scheme: 'bearer', description: 'Host-authenticated actor. Cookies require Origin/CSRF.' },
      },
      schemas: {
        SafeErrorEnvelope: {
          type: 'object',
          additionalProperties: false,
          required: ['contractVersion', 'error', 'safeErrorCode', 'retryAfter', 'supportPath'],
          properties: {
            contractVersion: { const: '1.0.0' },
            error: {
              type: 'object',
              required: ['code', 'message', 'retryable'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                retryable: { type: 'boolean' },
              },
            },
            safeErrorCode: { type: 'string' },
            retryAfter: { type: ['integer', 'null'] },
            supportPath: { type: ['string', 'null'] },
          },
        },
      },
    },
  };
}

export function openApiPathList(): string[] {
  return listV1Paths();
}

export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParams(path: string): Array<Record<string, unknown>> {
  return [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}
