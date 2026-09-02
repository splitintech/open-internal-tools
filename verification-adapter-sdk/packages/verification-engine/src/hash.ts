export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(payload: string | Uint8Array): Promise<string> {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)));
}

export async function hmacSha256Hex(secret: string, payload: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes as BufferSource)));
}

export function randomToken(cryptoImpl: Crypto = globalThis.crypto): string {
  const bytes = new Uint8Array(32);
  cryptoImpl.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function newId(prefix: string, cryptoImpl: Crypto = globalThis.crypto): string {
  return `${prefix}_${cryptoImpl.randomUUID().replace(/-/g, '')}`;
}

export async function cohortBucket(tenantKey: string, subjectHash: string): Promise<number> {
  const hex = await sha256Hex(`${tenantKey}:${subjectHash}`);
  return Number.parseInt(hex.slice(0, 8), 16) % 100;
}
