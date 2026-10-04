import { randomBytes } from "node:crypto";

export const RESERVED_LABELS = Object.freeze(["www", "api", "auth", "share", "admin"]);

const RESERVED = new Set(RESERVED_LABELS);
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function mintLabel(rng: () => Uint8Array = () => randomBytes(16)): string {
  for (let i = 0; i < 8; i += 1) {
    const label = encodeBase32(rng());
    if (!RESERVED.has(label)) return label;
  }
  throw new Error("Unable to mint a non-reserved share label.");
}

export function parseShareHost(hostHeader: string, baseDomain: string): string | null {
  const host = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  const base = baseDomain.trim().toLowerCase();
  if (!host || !base) return null;
  if (host === base) return null;
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes(".")) return null;
  if (RESERVED.has(label)) return null;
  if (!/^[a-z2-7]{16,32}$/.test(label)) return null;
  return label;
}

export function shareUrl(label: string, baseDomain: string, protocol = "https"): string {
  return `${protocol}://${label}.${baseDomain}`;
}
