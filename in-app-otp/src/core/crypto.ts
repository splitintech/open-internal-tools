import { DEFAULT_OTP_DIGITS, type OtpCodeGenerator, type OtpIdGenerator } from "./types";

function getCrypto(): Crypto {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("A Web Crypto compatible crypto.getRandomValues implementation is required");
  }
  return globalThis.crypto;
}

export const generateNumericOtp: OtpCodeGenerator = (digits = DEFAULT_OTP_DIGITS) => {
  if (!Number.isInteger(digits) || digits < 1 || digits > 10) {
    throw new Error("OTP digit count must be an integer between 1 and 10");
  }

  const crypto = getCrypto();
  const out: string[] = [];
  const max = 250;

  while (out.length < digits) {
    const bytes = new Uint8Array(digits - out.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= max) continue;
      out.push(String(byte % 10));
      if (out.length === digits) break;
    }
  }

  return out.join("");
};

export const generateOtpId: OtpIdGenerator = () => {
  const crypto = getCrypto();
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function createSystemClock() {
  return { now: () => new Date() };
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("A Web Crypto compatible crypto.subtle implementation is required");
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashOtpCode(code: string): Promise<string> {
  const saltBytes = new Uint8Array(16);
  getCrypto().getRandomValues(saltBytes);
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${salt}:${await sha256Hex(`${salt}.${code}`)}`;
}

export async function compareOtpCode(code: string, codeHash: string): Promise<boolean> {
  const [scheme, salt, digest] = codeHash.split(":");
  if (scheme !== "sha256" || !salt || !digest) return false;
  const next = await sha256Hex(`${salt}.${code}`);
  return constantTimeEqual(next, digest);
}
