import { ProviderError, type VerifiedWebhookEnvelope } from './contracts.ts';

const HEX_64 = /^[0-9a-f]{64}$/i;

export interface PersonaWebhookVerificationOptions {
  secrets: string[];
  expectedEnvironmentId: string;
  toleranceSeconds?: number;
  now?: () => Date;
}

/** Verifies Persona's HMAC over the exact timestamp.raw_body byte sequence. */
export async function verifyPersonaWebhook(
  request: Request,
  options: PersonaWebhookVerificationOptions,
): Promise<VerifiedWebhookEnvelope> {
  const signatureHeader = request.headers.get('Persona-Signature');
  const environmentId = request.headers.get('Persona-Environment-Id');
  const secrets = options.secrets.map((value) => value.trim()).filter(Boolean);
  if (!signatureHeader || secrets.length === 0 || environmentId !== options.expectedEnvironmentId) {
    throw signatureFailure('Persona webhook authentication is invalid.');
  }

  const candidates = parsePersonaSignatures(signatureHeader);
  if (candidates.length === 0) throw signatureFailure('Persona webhook signature is invalid.');
  const nowSeconds = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  const rawBytes = new Uint8Array(await request.arrayBuffer());
  if (rawBytes.byteLength === 0 || rawBytes.byteLength > 1_048_576) {
    throw payloadFailure('Persona webhook body size is invalid.');
  }

  let matched: { timestamp: number; signature: string } | null = null;
  for (const candidate of candidates) {
    if (Math.abs(nowSeconds - candidate.timestamp) > tolerance) continue;
    for (const secret of secrets) {
      const expected = await hmacSha256Hex(secret, signedPayload(candidate.timestamp, rawBytes));
      if (timingSafeHexEqual(expected, candidate.signature)) {
        matched = candidate;
        break;
      }
    }
    if (matched) break;
  }
  if (!matched) throw signatureFailure('Persona webhook signature is invalid or stale.');

  const bodySha256 = await sha256HexBytes(rawBytes);
  let transientJson: unknown;
  try {
    transientJson = JSON.parse(new TextDecoder().decode(rawBytes)) as unknown;
  } catch {
    transientJson = null;
  }
  let providerEventKey: string;
  try {
    providerEventKey = readPersonaEventId(transientJson);
  } catch {
    // The signature is valid, so use the digest as a durable idempotency key.
    // Normalization will classify and dead-letter the malformed payload.
    providerEventKey = `persona_${bodySha256}`;
  }
  return {
    providerEventKey,
    receivedAt: new Date(nowSeconds * 1000).toISOString(),
    signatureIssuedAt: new Date(matched.timestamp * 1000).toISOString(),
    bodySha256,
    opaquePayload: rawBytes,
  };
}

export function parsePersonaSignatures(header: string): Array<{ timestamp: number; signature: string }> {
  const groups = header.trim().split(/\s+/);
  const result: Array<{ timestamp: number; signature: string }> = [];
  for (const group of groups) {
    let timestamp: number | null = null;
    const signatures: string[] = [];
    for (const part of group.split(',')) {
      const [key, value] = part.split('=', 2);
      if (key === 't' && /^\d{1,12}$/.test(value ?? '')) timestamp = Number(value);
      if (key === 'v1' && HEX_64.test(value ?? '')) signatures.push((value ?? '').toLowerCase());
    }
    if (timestamp !== null && Number.isSafeInteger(timestamp)) {
      for (const signature of signatures) result.push({ timestamp, signature });
    }
  }
  return result;
}

function signedPayload(timestamp: number, rawBody: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const result = new Uint8Array(prefix.length + rawBody.length);
  result.set(prefix);
  result.set(rawBody, prefix.length);
  return result;
}

async function hmacSha256Hex(secret: string, value: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, value)));
}

async function sha256HexBytes(value: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)));
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!HEX_64.test(left) || !HEX_64.test(right)) return false;
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readPersonaEventId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw payloadFailure('Persona webhook JSON is invalid.');
  }
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw payloadFailure('Persona webhook event is invalid.');
  }
  const id = (data as Record<string, unknown>).id;
  if (typeof id !== 'string' || id.length < 8 || id.length > 256) {
    throw payloadFailure('Persona webhook event ID is invalid.');
  }
  return id;
}

function signatureFailure(message: string): ProviderError {
  return new ProviderError('SIGNATURE_INVALID', message, {
    retryable: false,
    safeCode: 'persona_webhook_signature_invalid',
  });
}

function payloadFailure(message: string): ProviderError {
  return new ProviderError('TERMINAL_INPUT_FAILURE', message, {
    retryable: false,
    safeCode: 'persona_webhook_payload_invalid',
  });
}
