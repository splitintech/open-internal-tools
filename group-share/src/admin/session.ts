import { createHmac, timingSafeEqual } from "node:crypto";

import { parseCookieHeader, setCookieHeader } from "../core/session";

export const LOCAL_OPERATOR_COOKIE = "group-share-op";
export const SECURE_OPERATOR_COOKIE = "__Host-group-share-op";
const OPERATOR_TTL_MS = 12 * 60 * 60 * 1000;

export function operatorCookieName(secure: boolean): string {
  return secure ? SECURE_OPERATOR_COOKIE : LOCAL_OPERATOR_COOKIE;
}

export function signOperator(secret: string, exp: number): string {
  const payload = Buffer.from(JSON.stringify({ role: "operator", exp }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(`op|${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOperator(token: string, secret: string, now = Date.now()): boolean {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(`op|${payload}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: string;
      exp?: number;
    };
    return claims.role === "operator" && typeof claims.exp === "number" && claims.exp > now;
  } catch {
    return false;
  }
}

export function operatorFromCookie(
  header: string | undefined,
  secret: string,
  secure: boolean,
  now = Date.now(),
): boolean {
  const token = parseCookieHeader(header, operatorCookieName(secure));
  if (!token) return false;
  return verifyOperator(token, secret, now);
}

export function issueOperatorCookie(secret: string, secure: boolean, now = Date.now()): string {
  const token = signOperator(secret, now + OPERATOR_TTL_MS);
  return setCookieHeader(operatorCookieName(secure), token, {
    secure,
    maxAgeSec: Math.floor(OPERATOR_TTL_MS / 1000),
  });
}

export function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length, 0));
    return false;
  }
  return timingSafeEqual(a, b);
}
