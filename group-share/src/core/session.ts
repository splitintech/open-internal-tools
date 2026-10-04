import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeEmail } from "./email";
import type { SessionClaims } from "./types";

export const SECURE_COOKIE_NAME = "__Host-group-share";
export const LOCAL_COOKIE_NAME = "group-share";

export function cookieName(secure: boolean): string {
  return secure ? SECURE_COOKIE_NAME : LOCAL_COOKIE_NAME;
}

export function signSession(claims: SessionClaims, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: normalizeEmail(claims.email),
      label: claims.label,
      exp: claims.exp,
    }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): SessionClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.email !== "string" || typeof claims.label !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp <= now) return null;
    return { email: normalizeEmail(claims.email), label: claims.label, exp: claims.exp };
  } catch {
    return null;
  }
}

export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return rest.join("=");
  }
  return undefined;
}

export function setCookieHeader(
  name: string,
  value: string,
  opts: { secure: boolean; maxAgeSec: number },
): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${opts.maxAgeSec}`];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function stripCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${name}=`));
  return kept.length ? kept.join("; ") : undefined;
}
