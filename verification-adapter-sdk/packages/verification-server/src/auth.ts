import type { ActorContext } from '@splitin/verification-adapter-sdk';

import type { RouteAuth, RouteDefinition } from './catalog.ts';
import { VerificationHttpError } from './errors.ts';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:~-]{8,128}$/;
const OPERATOR_ROLES = new Set(['operator', 'admin', 'reviewer', 'approver']);
const SYSTEM_ROLES = new Set(['system', 'worker']);

export function isCookieAuthenticated(request: Request, override?: (request: Request) => boolean): boolean {
  if (override) return override(request);
  const authorization = request.headers.get('authorization') ?? '';
  if (/^bearer\s+/i.test(authorization)) return false;
  return Boolean(request.headers.get('cookie'));
}

export function requireCsrf(request: Request, route: RouteDefinition, allowedOrigins: string[]): void {
  if (!route.csrf) return;
  const origin = request.headers.get('origin') ?? originFromReferer(request.headers.get('referer'));
  if (!origin) {
    throw new VerificationHttpError(403, 'CSRF_REJECTED', 'Cookie-authenticated mutations require a trusted Origin.');
  }
  if (!allowedOrigins.includes(origin)) {
    throw new VerificationHttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
  }
}

export function requireOriginWhenPresent(request: Request, allowedOrigins: string[]): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  if (!allowedOrigins.includes(origin)) {
    throw new VerificationHttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
  }
}

export function requireIdempotencyKey(request: Request, route: RouteDefinition): string | undefined {
  if (!route.idempotency) return undefined;
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key) {
    throw new VerificationHttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Mutations require an Idempotency-Key header.');
  }
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new VerificationHttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is invalid.');
  }
  return key;
}

export function authorizeActor(actor: ActorContext, auth: RouteAuth): void {
  if (auth === 'none') return;
  if (!actor.actorId || !actor.tenantKey) {
    throw new VerificationHttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  }
  if (auth === 'actor') {
    if (actor.actorType === 'system' && !hasRole(actor, SYSTEM_ROLES) && !hasRole(actor, OPERATOR_ROLES)) {
      throw new VerificationHttpError(403, 'FORBIDDEN', 'This actor cannot access subject verification sessions.');
    }
    return;
  }
  if (auth === 'operator') {
    if (actor.actorType !== 'operator' && !hasRole(actor, OPERATOR_ROLES)) {
      throw new VerificationHttpError(403, 'FORBIDDEN', 'Operator authorization is required.');
    }
    return;
  }
  if (auth === 'system') {
    if (actor.actorType !== 'system' && !hasRole(actor, SYSTEM_ROLES)) {
      throw new VerificationHttpError(403, 'FORBIDDEN', 'Worker authorization is required.');
    }
  }
}

export function authorizeSubjectScope(actor: ActorContext, subjectReference: string | undefined): void {
  if (!subjectReference) return;
  if (actor.actorType === 'operator' || actor.actorType === 'system') return;
  if (subjectReference === actor.actorId) return;
  if (actor.authorizedSubjectScope.includes('*')) return;
  if (actor.authorizedSubjectScope.includes(subjectReference)) return;
  throw new VerificationHttpError(403, 'FORBIDDEN', 'The actor is not authorized for this subject.');
}

export function assertSeparationOfDuties(actor: ActorContext, otherActorId: string | null | undefined, action: string): void {
  if (!otherActorId) return;
  if (otherActorId === actor.actorId) {
    throw new VerificationHttpError(
      403,
      'SEPARATION_OF_DUTIES',
      `A different authorized operator must ${action}.`,
    );
  }
}

function hasRole(actor: ActorContext, allowed: Set<string>): boolean {
  return actor.roles.some((role) => allowed.has(role));
}

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function corsHeaders(request: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '';
  return {
    Vary: 'Origin',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-CSRF-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
}
