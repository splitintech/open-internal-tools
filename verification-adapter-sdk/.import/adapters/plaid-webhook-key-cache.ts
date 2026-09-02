export type PlaidVerificationJwk = JsonWebKey & {
  alg?: string;
  kid?: string;
  use?: string;
  created_at?: number | string | null;
  expired_at?: number | string | null;
};

export class PlaidWebhookVerificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PlaidWebhookVerificationError';
  }
}

interface CachedKey {
  key: PlaidVerificationJwk;
  fetchedAtMs: number;
}

export interface PlaidVerificationKeyCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * Per-isolate JWK cache. It is keyed by kid, expires on both a bounded local
 * TTL and Plaid's expired_at, and coalesces concurrent misses. Fetch failures
 * never return a stale key.
 */
export class PlaidVerificationKeyCache {
  private readonly entries = new Map<string, CachedKey>();
  private readonly inFlight = new Map<string, Promise<PlaidVerificationJwk>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: PlaidVerificationKeyCacheOptions = {}) {
    this.ttlMs = Math.min(Math.max(options.ttlMs ?? 15 * 60_000, 10_000), 60 * 60_000);
    this.now = options.now ?? Date.now;
  }

  async get(
    keyId: string,
    loader: (keyId: string) => Promise<PlaidVerificationJwk>,
  ): Promise<PlaidVerificationJwk> {
    assertKeyId(keyId);
    const nowMs = this.now();
    const cached = this.entries.get(keyId);
    if (cached && nowMs - cached.fetchedAtMs < this.ttlMs && !isExpired(cached.key, nowMs)) {
      validatePlaidJwk(cached.key, keyId, nowMs);
      return cached.key;
    }
    this.entries.delete(keyId);

    const existing = this.inFlight.get(keyId);
    if (existing) return existing;

    const pending = (async () => {
      const key = await loader(keyId);
      validatePlaidJwk(key, keyId, this.now());
      this.entries.set(keyId, { key, fetchedAtMs: this.now() });
      return key;
    })();
    this.inFlight.set(keyId, pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(keyId);
    }
  }

  clear(keyId?: string): void {
    if (keyId) this.entries.delete(keyId);
    else this.entries.clear();
  }
}

export function assertKeyId(keyId: string): void {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(keyId)) {
    throw new PlaidWebhookVerificationError('INVALID_KEY_ID', 'Webhook key ID is invalid');
  }
}

export function validatePlaidJwk(key: PlaidVerificationJwk, keyId: string, nowMs: number): void {
  if (!key || key.kid !== keyId || key.kty !== 'EC' || key.crv !== 'P-256'
    || key.alg !== 'ES256' || key.use !== 'sig'
    || typeof key.x !== 'string' || typeof key.y !== 'string'
    || !/^[A-Za-z0-9_-]{40,64}$/.test(key.x) || !/^[A-Za-z0-9_-]{40,64}$/.test(key.y)) {
    throw new PlaidWebhookVerificationError('INVALID_KEY', 'Webhook verification key is invalid');
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  const createdAt = timestampSeconds(key.created_at);
  if (createdAt === null || createdAt > nowSeconds + 60) {
    throw new PlaidWebhookVerificationError('INVALID_KEY', 'Webhook verification key creation time is invalid');
  }
  if (isExpired(key, nowMs)) {
    throw new PlaidWebhookVerificationError('EXPIRED_KEY', 'Webhook verification key is expired');
  }
}

function isExpired(key: PlaidVerificationJwk, nowMs: number): boolean {
  if (key.expired_at == null) return false;
  const expiry = timestampSeconds(key.expired_at);
  return expiry === null || expiry <= Math.floor(nowMs / 1000);
}

function timestampSeconds(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value) return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
