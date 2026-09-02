const SECRET_PREFIX = /\b((?:sk_|rk_|whsec_)[A-Za-z0-9_-]+)/g;
const TOKEN_ASSIGNMENT = /(\b(?:token|access_token|refresh_token|id_token|api[_-]?key|client[_-]?secret|private[_-]?key|signing[_-]?secret)\b\s*[:=]\s*)(["']?)([^\s"',}]+)\2/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._~+/-]+=*/g;

export function redactSecrets(value: string): string {
  return value
    .replace(BEARER, 'Bearer ***')
    .replace(JWT, '***')
    .replace(SECRET_PREFIX, (_, match: string) => `${match.slice(0, match.indexOf('_') + 1)}***`)
    .replace(TOKEN_ASSIGNMENT, (_, prefix: string, quote: string) => `${prefix}${quote}***${quote}`);
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (isSecretKey(key) && typeof nested === 'string' && nested.length > 0) {
        return [key, redactSecrets(nested) === nested ? '***' : redactSecrets(nested)];
      }
      return [key, redactValue(nested)];
    });
    return Object.fromEntries(entries);
  }
  return value;
}

export function isSecretKey(key: string): boolean {
  return /secret|token|password|authorization|api[_-]?key|private[_-]?key|signing/i.test(key);
}

export function assertNoSecrets(value: string): void {
  if (SECRET_PREFIX.test(value) || BEARER.test(value) || JWT.test(value)) {
    SECRET_PREFIX.lastIndex = 0;
    BEARER.lastIndex = 0;
    JWT.lastIndex = 0;
    throw new Error('A secret would have been printed. Values matching sk_, rk_, whsec_, or tokens are redacted.');
  }
  SECRET_PREFIX.lastIndex = 0;
  BEARER.lastIndex = 0;
  JWT.lastIndex = 0;
}
