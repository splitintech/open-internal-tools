export const API_CONTRACT_VERSION = '1.0.0' as const;

export type RouteAuth = 'none' | 'actor' | 'operator' | 'system';

export interface RouteDefinition {
  id: string;
  method: 'GET' | 'POST' | 'OPTIONS';
  path: string;
  auth: RouteAuth;
  csrf: boolean;
  idempotency: boolean;
  mutation: boolean;
}

export const V1_ROUTES: readonly RouteDefinition[] = Object.freeze([
  { id: 'sessions.create', method: 'POST', path: '/v1/sessions', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'sessions.resume', method: 'POST', path: '/v1/sessions/:id/resume', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'sessions.get', method: 'GET', path: '/v1/sessions/:id', auth: 'actor', csrf: false, idempotency: false, mutation: false },
  { id: 'sessions.retry', method: 'POST', path: '/v1/sessions/:id/retry', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'sessions.pause', method: 'POST', path: '/v1/sessions/:id/pause', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'sessions.cancel', method: 'POST', path: '/v1/sessions/:id/cancel', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'appeals.create', method: 'POST', path: '/v1/appeals', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'support.escalations', method: 'POST', path: '/v1/support/escalations', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'webhooks.ingest', method: 'POST', path: '/v1/webhooks/:provider', auth: 'none', csrf: false, idempotency: false, mutation: true },
  { id: 'protectedActions.evaluate', method: 'POST', path: '/v1/protected-actions/evaluate', auth: 'actor', csrf: true, idempotency: true, mutation: true },
  { id: 'admin.health', method: 'GET', path: '/v1/admin/health', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.routes.get', method: 'GET', path: '/v1/admin/routes', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.routes.mutate', method: 'POST', path: '/v1/admin/routes', auth: 'operator', csrf: true, idempotency: true, mutation: true },
  { id: 'admin.circuits.get', method: 'GET', path: '/v1/admin/circuits', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.circuits.mutate', method: 'POST', path: '/v1/admin/circuits', auth: 'operator', csrf: true, idempotency: true, mutation: true },
  { id: 'admin.attempts', method: 'GET', path: '/v1/admin/attempts', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.review.get', method: 'GET', path: '/v1/admin/review', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.review.mutate', method: 'POST', path: '/v1/admin/review', auth: 'operator', csrf: true, idempotency: true, mutation: true },
  { id: 'admin.audit', method: 'GET', path: '/v1/admin/audit', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.reconciliation.get', method: 'GET', path: '/v1/admin/reconciliation', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.reconciliation.mutate', method: 'POST', path: '/v1/admin/reconciliation', auth: 'operator', csrf: true, idempotency: true, mutation: true },
  { id: 'admin.redaction.get', method: 'GET', path: '/v1/admin/redaction', auth: 'operator', csrf: false, idempotency: false, mutation: false },
  { id: 'admin.redaction.mutate', method: 'POST', path: '/v1/admin/redaction', auth: 'operator', csrf: true, idempotency: true, mutation: true },
  { id: 'workers.claim', method: 'POST', path: '/v1/workers/claim', auth: 'system', csrf: false, idempotency: true, mutation: true },
  { id: 'workers.process', method: 'POST', path: '/v1/workers/process', auth: 'system', csrf: false, idempotency: true, mutation: true },
]);

export function listV1Paths(): string[] {
  return [...new Set(V1_ROUTES.map((route) => route.path))].sort();
}

export interface MatchedRoute {
  route: RouteDefinition;
  params: Record<string, string>;
}

export function matchV1Route(method: string, pathname: string, basePath = ''): MatchedRoute | null {
  const relative = stripBasePath(pathname, basePath);
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'OPTIONS') {
    const found = V1_ROUTES.find((route) => matchPath(route.path, relative));
    return found ? { route: { ...found, method: 'OPTIONS', csrf: false, idempotency: false, mutation: false }, params: matchPath(found.path, relative) ?? {} } : null;
  }
  for (const route of V1_ROUTES) {
    if (route.method !== normalizedMethod) continue;
    const params = matchPath(route.path, relative);
    if (params) return { route, params };
  }
  return null;
}

function stripBasePath(pathname: string, basePath: string): string {
  const normalized = normalizePath(pathname);
  const base = normalizePath(basePath);
  if (!base || base === '/') return normalized;
  if (normalized === base) return '/';
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length) || '/';
  return normalized;
}

function normalizePath(value: string): string {
  const path = value.split('?')[0] ?? '/';
  if (!path.startsWith('/')) return `/${path}`;
  return path.replace(/\/+$/, '') || '/';
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = normalizePath(pattern).split('/').filter(Boolean);
  const pathParts = normalizePath(pathname).split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!;
    const actual = pathParts[index]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}
