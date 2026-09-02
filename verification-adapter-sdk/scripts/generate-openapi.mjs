#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const catalogPath = join(root, 'packages/verification-server/src/catalog.ts');
const openapiPath = join(root, 'packages/verification-server/openapi/openapi.v1.json');
const generatedPath = join(root, 'docs/generated/openapi.json');

const catalog = readFileSync(catalogPath, 'utf8');
const routePattern = /\{\s*id:\s*'([^']+)',\s*method:\s*'(GET|POST|OPTIONS)',\s*path:\s*'([^']+)',\s*auth:\s*'([^']+)',\s*csrf:\s*(true|false),\s*idempotency:\s*(true|false),\s*mutation:\s*(true|false)\s*\}/g;

const routes = [];
for (const match of catalog.matchAll(routePattern)) {
  routes.push({
    id: match[1],
    method: match[2].toLowerCase(),
    catalogPath: match[3],
    path: toOpenApiPath(match[3]),
    auth: match[4],
    csrf: match[5] === 'true',
    idempotency: match[6] === 'true',
    mutation: match[7] === 'true',
  });
}

if (routes.length === 0) {
  throw new Error('generate-openapi: failed to parse V1_ROUTES from catalog.ts');
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'SplitIn Verification Server API',
    version: '1.0.0',
    license: { name: 'MIT' },
    description: 'Provider-neutral verification session, webhook, worker, and operations API. Every path is generated from packages/verification-server/src/catalog.ts V1_ROUTES.',
  },
  servers: [{ url: '/', description: 'Host-mounted verification fetch handler' }],
  tags: [
    { name: 'sessions' },
    { name: 'appeals' },
    { name: 'support' },
    { name: 'webhooks' },
    { name: 'protected-actions' },
    { name: 'admin' },
    { name: 'workers' },
  ],
  paths: {},
  components: {
    securitySchemes: {
      actor: { type: 'http', scheme: 'bearer', description: 'Host-authenticated actor. Cookie sessions require Origin/CSRF.' },
      operator: { type: 'http', scheme: 'bearer', description: 'Operations operator. Cookie sessions require Origin/CSRF.' },
      system: { type: 'http', scheme: 'bearer', description: 'Worker/system credential. CSRF is not used.' },
    },
    schemas: componentSchemas(),
  },
};

for (const route of routes) {
  spec.paths[route.path] ??= {};
  spec.paths[route.path][route.method] = operationFor(route);
}

const json = `${JSON.stringify(spec, null, 2)}\n`;
mkdirSync(join(root, 'packages/verification-server/openapi'), { recursive: true });
mkdirSync(join(root, 'docs/generated'), { recursive: true });
writeFileSync(openapiPath, json);
writeFileSync(generatedPath, json);
process.stdout.write(`Wrote ${openapiPath}\nWrote ${generatedPath}\n`);

function toOpenApiPath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationFor(route) {
  const tag = route.id.split('.')[0] === 'protectedActions' ? 'protected-actions' : route.id.split('.')[0];
  const successSchema = successSchemaFor(route.id);
  const successStatus = route.id === 'webhooks.ingest' ? '202' : '200';
  const operation = {
    operationId: route.id,
    tags: [tag],
    summary: route.id.replaceAll('.', ' '),
    description: [
      `Auth: ${route.auth}.`,
      route.csrf ? 'Cookie-authenticated mutations require Origin/CSRF.' : 'CSRF is not required.',
      route.idempotency ? 'Idempotency-Key is required.' : 'Idempotency-Key is not required.',
    ].join(' '),
    security: route.auth === 'none' ? [] : [{ [route.auth]: [] }],
    parameters: [
      ...pathParameters(route.path),
      ...(route.idempotency ? [{
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 8, maxLength: 128 },
      }] : []),
    ],
    responses: {
      [successStatus]: {
        description: route.id === 'webhooks.ingest' ? 'Webhook accepted for reconciliation' : 'Success',
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${successSchema}` } },
        },
      },
      400: errorResponse('Invalid request'),
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
      404: { description: 'Not found' },
      429: errorResponse('Rate limited'),
    },
  };
  const requestSchema = requestSchemaFor(route.id);
  if (requestSchema && route.method === 'post') {
    operation.requestBody = {
      required: route.mutation,
      content: {
        'application/json': { schema: { $ref: `#/components/schemas/${requestSchema}` } },
      },
    };
  }
  if (route.id === 'webhooks.ingest') {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': { schema: { type: 'object', additionalProperties: true } },
      },
    };
  }
  return operation;
}

function pathParameters(path) {
  return [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  }));
}

function errorResponse(description) {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/SafeErrorEnvelope' } },
    },
  };
}

function successSchemaFor(id) {
  if (id.startsWith('sessions.') && !['sessions.pause', 'sessions.cancel'].includes(id)) return 'SessionEnvelopeV1';
  if (id === 'sessions.pause' || id === 'sessions.cancel') return 'SessionMutationResult';
  if (id === 'appeals.create') return 'AppealResult';
  if (id === 'support.escalations') return 'SupportEscalationResult';
  if (id === 'webhooks.ingest') return 'WebhookAccepted';
  if (id === 'protectedActions.evaluate') return 'ProtectedActionDecision';
  if (id === 'admin.health') return 'AdminHealthSnapshot';
  if (id === 'admin.routes.get') return 'AdminRoutesSnapshot';
  if (id === 'admin.circuits.get') return 'AdminCircuitsSnapshot';
  if (id === 'admin.attempts') return 'AdminAttemptsSnapshot';
  if (id === 'admin.review.get') return 'AdminReviewSnapshot';
  if (id === 'admin.audit') return 'AdminAuditSnapshot';
  if (id === 'admin.reconciliation.get') return 'AdminReconciliationSnapshot';
  if (id === 'admin.redaction.get') return 'AdminRedactionSnapshot';
  if (id.startsWith('admin.') && id.endsWith('.mutate')) return 'SafeAdminRecord';
  if (id === 'workers.claim') return 'WorkerClaimResult';
  if (id === 'workers.process') return 'WorkerProcessResult';
  return 'SafeAdminRecord';
}

function requestSchemaFor(id) {
  switch (id) {
    case 'sessions.create': return 'StartSessionInput';
    case 'appeals.create': return 'AppealInput';
    case 'support.escalations': return 'SupportEscalationInput';
    case 'protectedActions.evaluate': return 'ProtectedActionInput';
    case 'admin.routes.mutate': return 'RouteChangeInput';
    case 'admin.circuits.mutate': return 'CircuitInput';
    case 'admin.review.mutate': return 'ReviewInput';
    case 'admin.reconciliation.mutate': return 'ReconciliationInput';
    case 'admin.redaction.mutate': return 'RedactionInput';
    case 'workers.claim': return 'WorkerClaimInput';
    case 'workers.process': return 'WorkerProcessInput';
    default: return null;
  }
}

function componentSchemas() {
  const canonicalStatus = {
    type: 'string',
    enum: [
      'created', 'pending_user_input', 'paused', 'processing', 'manual_review_required',
      'verified', 'declined', 'failed', 'expired', 'canceled', 'provider_unavailable', 'redacted',
    ],
  };
  const nullableString = { type: ['string', 'null'] };
  return {
    CanonicalStatus: canonicalStatus,
    SessionContinuationV1: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'token', 'expiresAt'],
      properties: {
        key: { type: 'string' },
        token: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
    ProviderLaunchEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['attemptId', 'canonicalStatus', 'launcherKey', 'presentation'],
      properties: {
        attemptId: { type: 'string' },
        canonicalStatus,
        launcherKey: { type: 'string' },
        presentation: { type: 'string', enum: ['embedded', 'hosted', 'qr', 'none'] },
        providerDisclosure: { type: 'string' },
        transientSecret: { type: 'string' },
        transientSecretExpiresAt: { type: 'string', format: 'date-time' },
        hostedUrl: { type: 'string', format: 'uri' },
        hostedFallbackExpiresAt: { type: 'string', format: 'date-time' },
        safeErrorCode: nullableString,
        retryAfter: nullableString,
        supportPath: nullableString,
        continuationReference: { type: 'string' },
      },
    },
    SessionEnvelopeV1: {
      type: 'object',
      additionalProperties: false,
      required: [
        'contractVersion', 'attemptId', 'packageCode', 'status', 'presentation', 'launch',
        'launcherKey', 'providerDisclosure', 'safeErrorCode', 'retryAfter', 'supportPath',
        'expiresAt', 'canResume', 'canRetry', 'continuation',
      ],
      properties: {
        contractVersion: { const: '1.0.0' },
        attemptId: { type: 'string' },
        packageCode: { type: 'string' },
        status: canonicalStatus,
        presentation: { type: 'string', enum: ['embedded', 'hosted', 'qr', 'none'] },
        launch: { anyOf: [{ $ref: '#/components/schemas/ProviderLaunchEnvelope' }, { type: 'null' }] },
        launcherKey: nullableString,
        providerDisclosure: nullableString,
        safeErrorCode: nullableString,
        retryAfter: nullableString,
        supportPath: nullableString,
        expiresAt: nullableString,
        canResume: { type: 'boolean' },
        canRetry: { type: 'boolean' },
        continuation: { anyOf: [{ $ref: '#/components/schemas/SessionContinuationV1' }, { type: 'null' }] },
      },
    },
    SessionMutationResult: {
      type: 'object',
      required: ['attemptId', 'status'],
      properties: {
        attemptId: { type: 'string' },
        status: canonicalStatus,
        paused: { type: 'boolean' },
        canceled: { type: 'boolean' },
        canResume: { type: 'boolean' },
        canRetry: { type: 'boolean' },
      },
    },
    StartSessionInput: {
      type: 'object',
      required: ['packageCode'],
      properties: {
        packageCode: { type: 'string' },
        countryCode: { type: 'string', pattern: '^[A-Z]{2}$' },
        action: { type: 'string' },
        resourceType: { type: 'string' },
        resourceReference: { type: 'string' },
        subjectReference: { type: 'string' },
        continuationToken: { type: 'string' },
        continuationKey: { type: 'string' },
        legalFirstName: nullableString,
        legalLastName: nullableString,
        email: nullableString,
        organization: { type: 'object', additionalProperties: true },
        relationship: { type: 'object', additionalProperties: true },
        associatedPerson: { type: 'object', additionalProperties: true },
        evidenceReferences: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
      },
    },
    ProtectedActionDenial: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'action', 'resourceHash', 'requiredPackages', 'continuation'],
      properties: {
        code: { const: 'VERIFICATION_REQUIRED' },
        action: { type: 'string' },
        resourceHash: { type: 'string' },
        requiredPackages: { type: 'array', items: { type: 'string' } },
        continuation: { $ref: '#/components/schemas/SessionContinuationV1' },
        retryAfter: nullableString,
        supportPath: nullableString,
      },
    },
    ProtectedActionAllow: {
      type: 'object',
      required: ['allowed'],
      properties: {
        allowed: { const: true },
        enforcementActive: { type: 'boolean' },
        policyVersionId: nullableString,
      },
    },
    ProtectedActionDecision: {
      oneOf: [
        { $ref: '#/components/schemas/ProtectedActionAllow' },
        {
          allOf: [
            { type: 'object', required: ['allowed'], properties: { allowed: { const: false } } },
            { $ref: '#/components/schemas/ProtectedActionDenial' },
          ],
        },
      ],
    },
    ProtectedActionInput: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string' },
        resourceType: { type: 'string' },
        resourceReference: { type: 'string' },
      },
    },
    WebhookAccepted: {
      type: 'object',
      required: ['accepted', 'duplicate'],
      properties: {
        accepted: { type: 'boolean' },
        duplicate: { type: 'boolean' },
        providerEventKey: { type: 'string' },
      },
    },
    AppealInput: {
      type: 'object',
      required: ['reasonCode'],
      properties: {
        attemptId: { type: 'string' },
        reasonCode: { type: 'string' },
        nonBiometricPathRequested: { type: 'boolean' },
        details: { type: 'string' },
      },
    },
    AppealResult: {
      type: 'object',
      required: ['appealId', 'status'],
      properties: {
        appealId: { type: 'string' },
        status: { type: 'string', enum: ['open', 'in_review', 'resolved', 'rejected'] },
      },
    },
    SupportEscalationInput: {
      type: 'object',
      required: ['reasonCode'],
      properties: {
        attemptId: { type: 'string' },
        appealId: { type: 'string' },
        reasonCode: { type: 'string' },
        message: { type: 'string' },
      },
    },
    SupportEscalationResult: {
      type: 'object',
      required: ['escalationId', 'status'],
      properties: {
        escalationId: { type: 'string' },
        status: { const: 'open' },
      },
    },
    SafeAdminRecord: {
      type: 'object',
      additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
      properties: { id: { type: 'string' } },
    },
    AdminHealthSnapshot: adminSnapshot(['runtime', 'health', 'alerts']),
    AdminRoutesSnapshot: adminSnapshot(['routes', 'routeChanges']),
    AdminCircuitsSnapshot: adminSnapshot(['circuits']),
    AdminAttemptsSnapshot: adminSnapshot(['attempts']),
    AdminReviewSnapshot: adminSnapshot(['appeals', 'manualExceptions', 'policyVersions']),
    AdminAuditSnapshot: adminSnapshot(['audit']),
    AdminReconciliationSnapshot: {
      type: 'object',
      required: ['generatedAt', 'jobs', 'queues'],
      properties: {
        generatedAt: { type: 'string', format: 'date-time' },
        jobs: { type: 'array', items: { $ref: '#/components/schemas/SafeAdminRecord' } },
        queues: { type: 'object', additionalProperties: { type: 'integer' } },
      },
    },
    AdminRedactionSnapshot: adminSnapshot(['privacyRequests', 'jobs']),
    RouteChangeInput: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: { type: 'string', enum: ['propose', 'approve', 'apply'] },
        targetRoutePolicyId: { type: 'string' },
        requestId: { type: 'string' },
        action: { type: 'string', enum: ['activate', 'drain', 'rollback'] },
        reasonCode: { type: 'string' },
      },
    },
    CircuitInput: {
      type: 'object',
      required: ['provider', 'providerEnvironment', 'status'],
      properties: {
        provider: { type: 'string' },
        providerEnvironment: { type: 'string', enum: ['sandbox', 'production'] },
        status: { type: 'string', enum: ['healthy', 'degraded', 'unavailable', 'circuit_open'] },
        errorCode: { type: 'string' },
        circuitOpenUntil: { type: 'string', format: 'date-time' },
      },
    },
    ReviewInput: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: {
          type: 'string',
          enum: ['begin_appeal_review', 'propose_manual_exception', 'approve_manual_exception', 'apply_manual_exception'],
        },
        appealId: { type: 'string' },
        requestId: { type: 'string' },
        packageCode: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'deny', 'revoke', 'request_more_information'] },
        reasonCode: { type: 'string' },
        policyVersionId: { type: 'string' },
        evidenceReferenceHash: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
    ReconciliationInput: {
      type: 'object',
      required: ['attemptId'],
      properties: { attemptId: { type: 'string' } },
    },
    RedactionInput: {
      type: 'object',
      required: ['privacyRequestId'],
      properties: { privacyRequestId: { type: 'string' } },
    },
    WorkerClaimInput: {
      type: 'object',
      required: ['queue'],
      properties: {
        queue: { type: 'string', enum: ['webhook', 'reconciliation', 'redaction', 'dead_letter'] },
        limit: { type: 'integer', minimum: 1 },
      },
    },
    WorkerClaimResult: {
      type: 'object',
      required: ['leases'],
      properties: {
        leases: {
          type: 'array',
          items: {
            type: 'object',
            required: ['leaseId', 'jobId', 'queue'],
            properties: {
              leaseId: { type: 'string' },
              jobId: { type: 'string' },
              queue: { type: 'string' },
            },
          },
        },
      },
    },
    WorkerProcessInput: {
      type: 'object',
      required: ['leaseId', 'jobId'],
      properties: {
        leaseId: { type: 'string' },
        jobId: { type: 'string' },
      },
    },
    WorkerProcessResult: {
      type: 'object',
      required: ['processed', 'disposition'],
      properties: {
        processed: { type: 'boolean' },
        disposition: { type: 'string', enum: ['completed', 'retryable', 'dead_letter', 'duplicate'] },
      },
    },
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
        supportPath: nullableString,
      },
    },
  };
}

function adminSnapshot(recordFields) {
  const properties = {
    generatedAt: { type: 'string', format: 'date-time' },
  };
  for (const field of recordFields) {
    properties[field] = { type: 'array', items: { $ref: '#/components/schemas/SafeAdminRecord' } };
  }
  return {
    type: 'object',
    required: ['generatedAt', ...recordFields],
    properties,
  };
}
