import type { ErrorClass, ProviderContext } from '@splitin/outreach-contracts';

export const GMAIL_API = 'https://gmail.googleapis.com';

export interface HttpDeps {
  readonly api: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
}

export interface GmailResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly retryAfterMs?: number;
}

/**
 * The request failed without an HTTP response. `reachedServer` is false only when the connection was never
 * established, which proves the provider did nothing; every other failure may have been processed.
 */
export class GmailNetworkError extends Error {
  constructor(
    readonly reachedServer: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'GmailNetworkError';
  }
}

const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

function failureCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' ? cause.code : '';
}

function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export async function gmailRequest(
  deps: HttpDeps,
  ctx: ProviderContext,
  token: string,
  method: 'GET' | 'POST',
  path: string,
  options: { query?: Record<string, string | readonly string[] | undefined>; json?: unknown } = {},
): Promise<GmailResponse> {
  const url = new URL(path, deps.api);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    for (const item of typeof value === 'string' ? [value] : value) url.searchParams.append(name, item);
  }
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(options.json === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(deps.timeoutMs)]),
    });
  } catch (error) {
    const code = failureCode(error);
    throw new GmailNetworkError(!CONNECT_FAILURES.has(code), `Gmail request failed (${code || (error as Error).name})`);
  }
  let body: Record<string, unknown> = {};
  try {
    const text = await response.text();
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch (error) {
    // The status line arrived, so the outcome is known even if the body was cut short.
    if (response.ok) throw new GmailNetworkError(true, `Gmail response body unreadable (${(error as Error).name})`);
  }
  const wait = retryAfter(response.headers.get('retry-after'));
  return { status: response.status, body, ...(wait === undefined ? {} : { retryAfterMs: wait }) };
}

/** Google's error shape: {error: {code, message, status, errors: [{reason, message}]}}. */
function errorDetail(body: Record<string, unknown>): { reason: string; message: string } {
  const error = (body.error ?? {}) as { message?: unknown; status?: unknown; errors?: { reason?: unknown }[] };
  const reason = typeof error.errors?.[0]?.reason === 'string' ? error.errors[0].reason : typeof error.status === 'string' ? error.status : '';
  return { reason, message: typeof error.message === 'string' ? error.message : '' };
}

const RATE_REASONS = /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/i;

/**
 * Maps a non-2xx Gmail response to the error taxonomy. `null` means the response does not prove the request
 * was rejected (5xx): the caller must treat the outcome as unknown.
 */
export function classifyGmailError(response: GmailResponse): { errorClass: ErrorClass; retryAfterMs?: number; detail: string } | null {
  const { status, body } = response;
  const { reason, message } = errorDetail(body);
  const detail = `Gmail HTTP ${status}${reason ? ` ${reason}` : ''}${message ? `: ${message.slice(0, 160)}` : ''}`;
  if (status >= 500) return null;
  if (status === 401) return { errorClass: 'auth_expired', detail };
  if (status === 429 || (status === 403 && RATE_REASONS.test(reason))) {
    const fallback = /daily/i.test(reason) || /daily/i.test(message) ? 3_600_000 : 60_000;
    return { errorClass: 'rate_limited', retryAfterMs: response.retryAfterMs ?? fallback, detail };
  }
  if (status === 403 && /domainPolicy/i.test(reason)) return { errorClass: 'policy_blocked', detail };
  if (status === 403) return { errorClass: 'forbidden', detail };
  if (status === 400 && /recipient|to header|invalid to|address/i.test(message)) return { errorClass: 'invalid_recipient', detail };
  return { errorClass: 'content_rejected', detail };
}
