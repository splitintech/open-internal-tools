import { isPackageCode, isProviderCode } from '@splitin/verification-adapter-sdk';

import {
  assertSeparationOfDuties,
  authorizeActor,
  authorizeSubjectScope,
  corsHeaders,
  isCookieAuthenticated,
  requireCsrf,
  requireIdempotencyKey,
  requireOriginWhenPresent,
} from './auth.ts';
import { matchV1Route } from './catalog.ts';
import { toSafeErrorEnvelope, VerificationHttpError } from './errors.ts';
import {
  jsonResponse,
  optionalBoolean,
  optionalString,
  parseJsonObject,
  readLimitedBody,
  requiredString,
  type JsonRecord,
} from './json.ts';
import type {
  CircuitInput,
  ProtectedActionInput,
  ReviewInput,
  RouteChangeInput,
  StartSessionInput,
  VerificationFetchHandlerOptions,
  VerificationServerPlatform,
} from './types.ts';

const PACKAGE = /^[a-z0-9][a-z0-9_.-]{1,80}$/;
const ACTION = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const IDENTIFIER = /^[A-Za-z0-9._:~-]{4,128}$/;
const REASON = /^[a-z][a-z0-9_.-]{2,127}$/;
const COUNTRY = /^[A-Z]{2}$/;
const HASH = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^[A-Za-z0-9._:~-]{8,128}$/;

const SESSION_KEYS = [
  'packageCode', 'countryCode', 'action', 'resourceType', 'resourceReference', 'subjectReference',
  'continuationToken', 'continuationKey', 'legalFirstName', 'legalLastName', 'email',
  'organization', 'relationship', 'associatedPerson', 'evidenceReferences', 'metadata',
] as const;

const APPEAL_KEYS = ['attemptId', 'reasonCode', 'nonBiometricPathRequested', 'details'] as const;
const SUPPORT_KEYS = ['attemptId', 'appealId', 'reasonCode', 'message'] as const;
const PROTECTED_KEYS = ['action', 'resourceType', 'resourceReference'] as const;
const ROUTE_KEYS = ['operation', 'targetRoutePolicyId', 'requestId', 'action', 'reasonCode'] as const;
const CIRCUIT_KEYS = ['provider', 'providerEnvironment', 'status', 'errorCode', 'circuitOpenUntil'] as const;
const REVIEW_KEYS = [
  'operation', 'appealId', 'requestId', 'packageCode', 'decision', 'reasonCode',
  'policyVersionId', 'evidenceReferenceHash', 'expiresAt',
] as const;
const RECONCILE_KEYS = ['attemptId'] as const;
const REDACT_KEYS = ['privacyRequestId'] as const;
const WORKER_CLAIM_KEYS = ['queue', 'limit'] as const;
const WORKER_PROCESS_KEYS = ['leaseId', 'jobId'] as const;

export function createVerificationFetchHandler(
  platform: VerificationServerPlatform,
  options: VerificationFetchHandlerOptions,
): (request: Request) => Promise<Response> {
  const allowedOrigins = options.allowedOrigins ?? [];
  const supportPath = options.supportPath ?? null;
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return async (incoming: Request): Promise<Response> => {
    const extra = corsHeaders(incoming, allowedOrigins);
    try {
      requireOriginWhenPresent(incoming, allowedOrigins.length > 0 ? allowedOrigins : [incoming.headers.get('origin') ?? '']);
      const request = await readLimitedBody(incoming, maxBodyBytes);
      const url = new URL(request.url);
      const matched = matchV1Route(request.method, url.pathname, options.basePath);
      if (!matched) {
        if (request.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: extra });
        }
        throw new VerificationHttpError(404, 'NOT_FOUND', 'The verification endpoint was not found.');
      }
      const { route, params } = matched;
      if (route.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: extra });
      }

      if (route.id === 'webhooks.ingest') {
        const provider = params.provider ?? '';
        if (!isProviderCode(provider)) {
          throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Invalid provider.');
        }
        const result = await platform.ingestWebhook(provider, request);
        return jsonResponse(result, result.accepted ? 202 : 400, extra);
      }

      if (isCookieAuthenticated(request, options.isCookieAuthenticated) && route.csrf) {
        if (allowedOrigins.length === 0) {
          throw new VerificationHttpError(403, 'CSRF_REJECTED', 'Cookie-authenticated mutations require an origin allowlist.');
        }
        requireCsrf(request, route, allowedOrigins);
      }

      const actor = await options.resolveActor(request);
      authorizeActor(actor, route.auth);
      const idempotencyKey = requireIdempotencyKey(request, route) ?? '';

      if (options.rateLimit) {
        const budget = await options.rateLimit(actor, route.id);
        if (!budget.allowed) {
          throw new VerificationHttpError(429, 'RATE_LIMITED', 'Please wait before retrying.', budget.retryAfterSeconds ?? 30);
        }
      }

      const body = route.mutation && route.method === 'POST' && route.id !== 'sessions.get'
        ? await parseBodyForRoute(route.id, request)
        : {};

      const payload = await dispatch(platform, route.id, {
        actor,
        params,
        body,
        idempotencyKey,
        request,
      });
      return jsonResponse(payload, route.mutation && route.method === 'POST' ? 200 : 200, extra);
    } catch (error) {
      const mapped = toSafeErrorEnvelope(error, supportPath);
      const headers = { ...extra };
      if (mapped.retryAfterSeconds !== null) headers['Retry-After'] = String(Math.max(1, Math.ceil(mapped.retryAfterSeconds)));
      return jsonResponse(mapped.body, mapped.status, headers);
    }
  };
}

async function parseBodyForRoute(routeId: string, request: Request): Promise<JsonRecord> {
  switch (routeId) {
    case 'sessions.create':
      return parseJsonObject(request, SESSION_KEYS, { rejectRoutingFields: true });
    case 'sessions.resume':
    case 'sessions.retry':
    case 'sessions.pause':
    case 'sessions.cancel':
      return parseJsonObject(request, []);
    case 'appeals.create':
      return parseJsonObject(request, APPEAL_KEYS);
    case 'support.escalations':
      return parseJsonObject(request, SUPPORT_KEYS);
    case 'protectedActions.evaluate':
      return parseJsonObject(request, PROTECTED_KEYS);
    case 'admin.routes.mutate':
      return parseJsonObject(request, ROUTE_KEYS, { rejectRoutingFields: false });
    case 'admin.circuits.mutate':
      return parseJsonObject(request, CIRCUIT_KEYS, { rejectRoutingFields: false });
    case 'admin.review.mutate':
      return parseJsonObject(request, REVIEW_KEYS, { rejectRoutingFields: false });
    case 'admin.reconciliation.mutate':
      return parseJsonObject(request, RECONCILE_KEYS, { rejectRoutingFields: false });
    case 'admin.redaction.mutate':
      return parseJsonObject(request, REDACT_KEYS, { rejectRoutingFields: false });
    case 'workers.claim':
      return parseJsonObject(request, WORKER_CLAIM_KEYS, { rejectRoutingFields: false });
    case 'workers.process':
      return parseJsonObject(request, WORKER_PROCESS_KEYS, { rejectRoutingFields: false });
    default:
      return {};
  }
}

async function dispatch(
  platform: VerificationServerPlatform,
  routeId: string,
  ctx: {
    actor: import('@splitin/verification-adapter-sdk').ActorContext;
    params: Record<string, string>;
    body: JsonRecord;
    idempotencyKey: string;
    request: Request;
  },
): Promise<unknown> {
  const attemptId = ctx.params.id;
  switch (routeId) {
    case 'sessions.create': {
      const input = parseStartInput(ctx.body);
      authorizeSubjectScope(ctx.actor, input.subjectReference);
      return platform.startSession(ctx.actor, input, ctx.idempotencyKey, ctx.request);
    }
    case 'sessions.resume':
      return platform.resumeSession(ctx.actor, { attemptId: requireAttemptId(attemptId), idempotencyKey: ctx.idempotencyKey }, ctx.request);
    case 'sessions.get':
      return platform.getSession(ctx.actor, requireAttemptId(attemptId));
    case 'sessions.retry':
      return platform.retrySession(ctx.actor, { attemptId: requireAttemptId(attemptId), idempotencyKey: ctx.idempotencyKey }, ctx.request);
    case 'sessions.pause':
      return platform.pauseSession(ctx.actor, { attemptId: requireAttemptId(attemptId), idempotencyKey: ctx.idempotencyKey });
    case 'sessions.cancel':
      return platform.cancelSession(ctx.actor, { attemptId: requireAttemptId(attemptId), idempotencyKey: ctx.idempotencyKey });
    case 'appeals.create':
      return platform.createAppeal(ctx.actor, {
        attemptId: optionalString(ctx.body, 'attemptId', ATTEMPT_ID, 128),
        reasonCode: requiredString(ctx.body, 'reasonCode', REASON, 128),
        nonBiometricPathRequested: optionalBoolean(ctx.body, 'nonBiometricPathRequested'),
        details: optionalString(ctx.body, 'details', /^[\s\S]{1,2000}$/, 2000),
      }, ctx.idempotencyKey);
    case 'support.escalations':
      return platform.createSupportEscalation(ctx.actor, {
        attemptId: optionalString(ctx.body, 'attemptId', ATTEMPT_ID, 128),
        appealId: optionalString(ctx.body, 'appealId', ATTEMPT_ID, 128),
        reasonCode: requiredString(ctx.body, 'reasonCode', REASON, 128),
        message: optionalString(ctx.body, 'message', /^[\s\S]{1,2000}$/, 2000),
      }, ctx.idempotencyKey);
    case 'protectedActions.evaluate':
      return platform.evaluateProtectedAction(ctx.actor, parseProtectedAction(ctx.body), ctx.idempotencyKey);
    case 'admin.health':
      return platform.admin.health(ctx.actor);
    case 'admin.routes.get':
      return platform.admin.routes(ctx.actor);
    case 'admin.routes.mutate':
      return mutateRoute(platform, ctx.actor, ctx.body, ctx.idempotencyKey);
    case 'admin.circuits.get':
      return platform.admin.circuits(ctx.actor);
    case 'admin.circuits.mutate':
      return platform.admin.setCircuit(ctx.actor, parseCircuit(ctx.body), ctx.idempotencyKey);
    case 'admin.attempts':
      return platform.admin.attempts(ctx.actor);
    case 'admin.review.get':
      return platform.admin.review(ctx.actor);
    case 'admin.review.mutate':
      return mutateReview(platform, ctx.actor, ctx.body, ctx.idempotencyKey);
    case 'admin.audit':
      return platform.admin.audit(ctx.actor);
    case 'admin.reconciliation.get':
      return platform.admin.reconciliation(ctx.actor);
    case 'admin.reconciliation.mutate':
      return platform.admin.enqueueReconciliation(ctx.actor, {
        attemptId: requiredString(ctx.body, 'attemptId', ATTEMPT_ID, 128),
      }, ctx.idempotencyKey);
    case 'admin.redaction.get':
      return platform.admin.redaction(ctx.actor);
    case 'admin.redaction.mutate':
      return platform.admin.approveRedaction(ctx.actor, {
        privacyRequestId: requiredString(ctx.body, 'privacyRequestId', IDENTIFIER, 128),
      }, ctx.idempotencyKey);
    case 'workers.claim':
      return platform.workers.claim(ctx.actor, {
        queue: parseWorkerQueue(ctx.body.queue),
        limit: typeof ctx.body.limit === 'number' ? ctx.body.limit : undefined,
      }, ctx.idempotencyKey);
    case 'workers.process':
      return platform.workers.process(ctx.actor, {
        leaseId: requiredString(ctx.body, 'leaseId', IDENTIFIER, 128),
        jobId: requiredString(ctx.body, 'jobId', IDENTIFIER, 128),
      }, ctx.idempotencyKey);
    default:
      throw new VerificationHttpError(404, 'NOT_FOUND', 'The verification endpoint was not found.');
  }
}

function parseStartInput(body: JsonRecord): StartSessionInput {
  const packageCode = requiredString(body, 'packageCode', PACKAGE, 80);
  if (!isPackageCode(packageCode)) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Invalid packageCode.');
  }
  return {
    packageCode,
    countryCode: optionalString(body, 'countryCode', COUNTRY, 2),
    action: optionalString(body, 'action', ACTION, 160),
    resourceType: optionalString(body, 'resourceType', /^[a-z][a-z0-9_]{1,63}$/, 64),
    resourceReference: optionalString(body, 'resourceReference', IDENTIFIER, 128),
    subjectReference: optionalString(body, 'subjectReference', IDENTIFIER, 128),
    continuationToken: optionalString(body, 'continuationToken', HASH, 64),
    continuationKey: optionalString(body, 'continuationKey', /^[a-z][a-z0-9_.-]{2,127}$/, 128),
    legalFirstName: optionalString(body, 'legalFirstName', /^[\p{L}\p{M}\s'.-]{1,80}$/u, 80) ?? null,
    legalLastName: optionalString(body, 'legalLastName', /^[\p{L}\p{M}\s'.-]{1,80}$/u, 80) ?? null,
    email: optionalString(body, 'email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 254) ?? null,
    organization: isRecord(body.organization) ? body.organization as unknown as StartSessionInput['organization'] : undefined,
    relationship: isRecord(body.relationship) ? body.relationship as unknown as StartSessionInput['relationship'] : undefined,
    associatedPerson: isRecord(body.associatedPerson) ? body.associatedPerson as unknown as StartSessionInput['associatedPerson'] : undefined,
    evidenceReferences: Array.isArray(body.evidenceReferences)
      ? body.evidenceReferences.filter((value): value is string => typeof value === 'string')
      : undefined,
    metadata: isRecord(body.metadata) ? sanitizeMetadata(body.metadata) : undefined,
  };
}

function parseProtectedAction(body: JsonRecord): ProtectedActionInput {
  return {
    action: requiredString(body, 'action', ACTION, 160),
    resourceType: optionalString(body, 'resourceType', /^[a-z][a-z0-9_]{1,63}$/, 64),
    resourceReference: optionalString(body, 'resourceReference', IDENTIFIER, 128),
  };
}

function parseCircuit(body: JsonRecord): CircuitInput {
  const status = requiredString(body, 'status', /^(healthy|degraded|unavailable|circuit_open)$/, 32);
  const environment = requiredString(body, 'providerEnvironment', /^(sandbox|production)$/, 16);
  return {
    provider: requiredString(body, 'provider', /^[a-z][a-z0-9_]{1,63}$/, 64),
    providerEnvironment: environment as CircuitInput['providerEnvironment'],
    status: status as CircuitInput['status'],
    errorCode: optionalString(body, 'errorCode', /^[A-Z][A-Z0-9_]{2,127}$/, 128),
    circuitOpenUntil: optionalString(body, 'circuitOpenUntil', /^\d{4}-\d{2}-\d{2}T/, 40),
  };
}

async function mutateRoute(
  platform: VerificationServerPlatform,
  actor: import('@splitin/verification-adapter-sdk').ActorContext,
  body: JsonRecord,
  idempotencyKey: string,
) {
  const operation = requiredString(body, 'operation', /^(propose|approve|apply)$/, 16) as RouteChangeInput['operation'];
  const input: RouteChangeInput = {
    operation,
    targetRoutePolicyId: optionalString(body, 'targetRoutePolicyId', IDENTIFIER, 128),
    requestId: optionalString(body, 'requestId', IDENTIFIER, 128),
    action: optionalString(body, 'action', /^(activate|drain|rollback)$/, 16) as RouteChangeInput['action'],
    reasonCode: optionalString(body, 'reasonCode', REASON, 128),
  };
  if (operation !== 'propose') {
    const snapshot = await platform.admin.routes(actor);
    const change = snapshot.routeChanges.find((row) => row.id === input.requestId);
    if (operation === 'approve') assertSeparationOfDuties(actor, stringField(change, 'proposedBy'), 'approve this route change');
    if (operation === 'apply') assertSeparationOfDuties(actor, stringField(change, 'approvedBy'), 'apply this route change');
  }
  return platform.admin.mutateRoute(actor, input, idempotencyKey);
}

async function mutateReview(
  platform: VerificationServerPlatform,
  actor: import('@splitin/verification-adapter-sdk').ActorContext,
  body: JsonRecord,
  idempotencyKey: string,
) {
  const operation = requiredString(
    body,
    'operation',
    /^(begin_appeal_review|propose_manual_exception|approve_manual_exception|apply_manual_exception)$/,
    40,
  ) as ReviewInput['operation'];
  const input: ReviewInput = {
    operation,
    appealId: optionalString(body, 'appealId', IDENTIFIER, 128),
    requestId: optionalString(body, 'requestId', IDENTIFIER, 128),
    packageCode: optionalString(body, 'packageCode', PACKAGE, 80),
    decision: optionalString(body, 'decision', /^(approve|deny|revoke|request_more_information)$/, 40) as ReviewInput['decision'],
    reasonCode: optionalString(body, 'reasonCode', REASON, 128),
    policyVersionId: optionalString(body, 'policyVersionId', IDENTIFIER, 128),
    evidenceReferenceHash: optionalString(body, 'evidenceReferenceHash', HASH, 64),
    expiresAt: optionalString(body, 'expiresAt', /^\d{4}-\d{2}-\d{2}T/, 40),
  };
  if (operation === 'approve_manual_exception' || operation === 'apply_manual_exception') {
    const snapshot = await platform.admin.review(actor);
    const exception = snapshot.manualExceptions.find((row) => row.id === input.requestId);
    if (operation === 'approve_manual_exception') {
      assertSeparationOfDuties(actor, stringField(exception, 'proposedBy'), 'approve this manual exception');
    }
    if (operation === 'apply_manual_exception') {
      assertSeparationOfDuties(actor, stringField(exception, 'approvedBy'), 'apply this manual exception');
    }
  }
  return platform.admin.mutateReview(actor, input, idempotencyKey);
}

function parseWorkerQueue(value: unknown): 'webhook' | 'reconciliation' | 'redaction' | 'dead_letter' {
  if (value === 'webhook' || value === 'reconciliation' || value === 'redaction' || value === 'dead_letter') return value;
  throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Invalid queue.');
}

function requireAttemptId(value: string | undefined): string {
  if (!value || !ATTEMPT_ID.test(value)) {
    throw new VerificationHttpError(400, 'INVALID_REQUEST', 'Invalid attempt id.');
  }
  return value;
}

function sanitizeMetadata(value: JsonRecord): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'boolean' || nested === null) {
      result[key] = nested;
    }
  }
  return result;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: { [key: string]: string | number | boolean | null | undefined } | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}
