import { ProviderError } from './errors.ts';

export class FakeClock {
  constructor(private epochMs: number = Date.parse('2026-01-01T00:00:00.000Z')) {}
  now = (): Date => new Date(this.epochMs);
  advance(ms: number): void {
    this.epochMs += ms;
  }
}

export function deterministicId(prefix: string, seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `${prefix}_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

export function createControlledFetch(handler: (input: Request) => Promise<Response> | Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return handler(request);
  }) as typeof fetch;
}

export async function signHmacSha256Hex(secret: string, payload: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, payload as BufferSource)));
}

export async function sha256Hex(payload: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', payload as BufferSource)));
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createSignedWebhookFixture(input: {
  protocol: 'stripe_v1_hmac' | 'persona_hmac_sha256' | 'none';
  secret: string;
  body: string;
  now?: Date;
}): Promise<Request> {
  const now = input.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000);
  const raw = new TextEncoder().encode(input.body);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (input.protocol === 'stripe_v1_hmac') {
    const signature = await signHmacSha256Hex(input.secret, new TextEncoder().encode(`${timestamp}.${input.body}`));
    headers.set('stripe-signature', `t=${timestamp},v1=${signature}`);
  }
  if (input.protocol === 'persona_hmac_sha256') {
    const prefix = new TextEncoder().encode(`${timestamp}.`);
    const payload = new Uint8Array(prefix.length + raw.length);
    payload.set(prefix);
    payload.set(raw, prefix.length);
    const signature = await signHmacSha256Hex(input.secret, payload);
    headers.set('Persona-Signature', `t=${timestamp},v1=${signature}`);
  }
  return new Request('https://example.test/webhooks/provider', { method: 'POST', headers, body: raw });
}

export function denySecretLogging(value: string): void {
  if (/sk_|rk_|whsec_|secret|password/i.test(value)) {
    throw new ProviderError('INVALID_CONFIGURATION', 'A secret would have been printed or logged.', {
      safeCode: 'secret_leak',
    });
  }
}
