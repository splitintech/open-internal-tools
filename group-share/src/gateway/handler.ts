import { handleAdminRequest } from "../admin/handler";
import { decideAccess, shareIsLive } from "../core/access";
import { resolveClientIp } from "../core/client-ip";
import { parseShareHost } from "../core/label";
import {
  cookieName,
  parseCookieHeader,
  setCookieHeader,
  signSession,
  stripCookie,
  verifySession,
} from "../core/session";
import type { Identity } from "../core/types";
import type { IdentityProvider } from "../identity/types";
import type { GroupStore, ShareStore } from "../store/types";
import { shareJs, UI_CSS_PATH, UI_JS_PATH, waitlistCss } from "../ui/assets";
import { statusPage } from "../ui/recipient";

export const SIGNIN_PATH = "/__group-share/signin";
export const VERIFY_PATH = "/__group-share/verify";
export const CALLBACK_PATH = "/__group-share/callback";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface GatewayConfig {
  baseDomain: string;
  secret: string;
  shares: ShareStore;
  groups: GroupStore;
  identity: IdentityProvider;
  trustedProxies: readonly string[];
  secureCookies: boolean;
  now?: () => number;
  sessionTtlMs?: number;
  operatorToken?: string;
  shareProtocol?: "http" | "https";
  /** Merged into an empty group CIDR list before quick-share mints. */
  defaultCidrs?: readonly string[];
}

export interface GatewayRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  remoteAddress: string | undefined;
  body?: string;
}

export interface GatewayResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  setCookie?: string;
  proxy?: { originUrl: string; path: string; method: string; headers: Record<string, string> };
}

function header(headers: GatewayRequest["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function page(status: number, title: string, message: string, extraHeaders: Record<string, string> = {}): GatewayResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extraHeaders },
    body: statusPage(title, message),
  };
}

export function isAdminHost(hostHeader: string, baseDomain: string): boolean {
  const host = hostHeader.split(":")[0]?.trim().toLowerCase() ?? "";
  const base = baseDomain.trim().toLowerCase();
  if (!host) return false;
  if (host === base) return true;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function uiAsset(pathname: string): GatewayResponse | null {
  if (pathname === UI_CSS_PATH) {
    return {
      status: 200,
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" },
      body: waitlistCss(),
    };
  }
  if (pathname === UI_JS_PATH) {
    return {
      status: 200,
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
      body: shareJs(),
    };
  }
  return null;
}

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (raw.includes("://")) return "/";
  return raw;
}

export async function handleGatewayRequest(
  req: GatewayRequest,
  config: GatewayConfig,
): Promise<GatewayResponse> {
  const now = (config.now ?? Date.now)();
  const host = header(req.headers, "host") ?? "";
  const url = new URL(req.url, `http://${host || config.baseDomain}`);
  const asset = uiAsset(url.pathname);
  if (asset) return asset;

  const label = parseShareHost(host, config.baseDomain);
  if (!label) {
    if (isAdminHost(host, config.baseDomain)) {
      return handleAdminRequest(req, config);
    }
    return page(404, "Not a share", "The parent host is the admin. Open a minted share subdomain.");
  }
  const share = await config.shares.get(label);
  if (!shareIsLive(share, now)) {
    return page(404, "Not found", "This share does not exist.");
  }

  const name = cookieName(config.secureCookies);
  const token = parseCookieHeader(header(req.headers, "cookie"), name);
  const session = token ? verifySession(token, config.secret, now) : null;
  const identityFromCookie =
    session && session.label === label ? { email: session.email } : null;

  const isSignIn =
    url.pathname === SIGNIN_PATH || url.pathname === VERIFY_PATH || url.pathname === CALLBACK_PATH;
  if (isSignIn) {
    const next = safeNextPath(url.searchParams.get("next") ?? undefined);
    const body = new URLSearchParams(req.body ?? "");
    if (!url.searchParams.get("next") && body.get("next")) {
      body.set("next", safeNextPath(body.get("next")));
    }
    const result = await config.identity.start({
      label,
      next: body.get("next") || next,
      method: req.method.toUpperCase(),
      body,
      query: url.searchParams,
      redirectUri: `${config.secureCookies ? "https" : "http"}://${host}${CALLBACK_PATH}`,
    });

    if (result.type === "redirect") {
      return { status: 302, headers: { location: result.location }, body: "" };
    }
    if (result.type === "html") {
      return {
        status: result.status,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: result.body,
      };
    }
    return issueSession(result.identity, label, safeNextPath(body.get("next") || next), config, now);
  }

  if (!identityFromCookie) {
    const next = safeNextPath(`${url.pathname}${url.search}`);
    return {
      status: 302,
      headers: { location: `${SIGNIN_PATH}?next=${encodeURIComponent(next)}` },
      body: "",
    };
  }

  const group = await config.groups.get(share.groupId);
  const clientIp = resolveClientIp({
    remoteAddress: req.remoteAddress,
    forwardedFor: header(req.headers, "x-forwarded-for"),
    trustedProxies: config.trustedProxies,
  });
  const decision = decideAccess({
    share,
    group,
    identity: identityFromCookie,
    clientIp,
    now,
  });
  if (!decision.allow) {
    const message =
      decision.reason === "not-invited"
        ? "You are signed in, but this share is limited to the invite list."
        : decision.reason === "ip-denied"
          ? "Open this from the office network or VPN."
          : "Access denied.";
    return page(decision.status, "Forbidden", message);
  }

  const forwarded: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "authorization") continue;
    if (lower === "cookie") {
      const stripped = stripCookie(Array.isArray(value) ? value.join("; ") : value, name);
      if (stripped) forwarded.cookie = stripped;
      continue;
    }
    forwarded[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  return {
    status: 200,
    headers: {},
    body: "",
    proxy: {
      originUrl: share.originUrl,
      path: `${url.pathname}${url.search}`,
      method: req.method,
      headers: forwarded,
    },
  };
}

function issueSession(
  identity: Identity,
  label: string,
  next: string,
  config: GatewayConfig,
  now: number,
): GatewayResponse {
  const ttl = config.sessionTtlMs ?? SESSION_TTL_MS;
  const token = signSession({ email: identity.email, label, exp: now + ttl }, config.secret);
  const name = cookieName(config.secureCookies);
  return {
    status: 302,
    headers: { location: next },
    body: "",
    setCookie: setCookieHeader(name, token, {
      secure: config.secureCookies,
      maxAgeSec: Math.floor(ttl / 1000),
    }),
  };
}
