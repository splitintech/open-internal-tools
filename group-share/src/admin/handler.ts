import { resolveClientIp } from "../core/client-ip";
import { normalizeEmail } from "../core/email";
import { EmptyCidrListError, EmptyInviteListError, GroupNotFoundError, GroupShareError } from "../core/errors";
import { shareUrl } from "../core/label";
import { createShareRecord } from "../core/share";
import type { GatewayConfig, GatewayRequest, GatewayResponse } from "../gateway/handler";
import { adminDashboardPage, adminLoginPage, DEFAULT_GROUP_ID } from "../ui/admin";
import { issueOperatorCookie, operatorFromCookie, tokensEqual } from "./session";

export const ADMIN_LOGIN_PATH = "/__group-share/admin/login";
export const ADMIN_GROUPS_PATH = "/__group-share/admin/groups";
export const ADMIN_MEMBER_PATH = "/__group-share/admin/member";
export const ADMIN_CIDR_PATH = "/__group-share/admin/cidr";
export const ADMIN_SHARE_PATH = "/__group-share/admin/share";
export const ADMIN_QUICK_SHARE_PATH = "/__group-share/admin/quick-share";
export const ADMIN_REVOKE_PATH = "/__group-share/admin/revoke";

function html(status: number, body: string, extra: Partial<GatewayResponse> = {}): GatewayResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extra.headers },
    body,
    setCookie: extra.setCookie,
  };
}

function redirect(location: string, setCookie?: string): GatewayResponse {
  return { status: 302, headers: { location }, body: "", setCookie };
}

function header(headers: GatewayRequest["headers"], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function protocol(config: GatewayConfig, req: GatewayRequest): "http" | "https" {
  if (config.shareProtocol) return config.shareProtocol;
  return config.secureCookies ? "https" : "http";
}

function mintedUrl(label: string, config: GatewayConfig, req: GatewayRequest): string {
  const host = (header(req.headers, "host") ?? config.baseDomain).split(":")[0];
  const portPart = (header(req.headers, "host") ?? "").split(":")[1];
  const base = host === "127.0.0.1" || host === "localhost" || host === "::1" ? config.baseDomain : host;
  const url = shareUrl(label, base, protocol(config, req));
  return portPart ? `${url}:${portPart}` : url;
}

function errorMessage(error: unknown): string {
  if (error instanceof EmptyInviteListError || error instanceof EmptyCidrListError) return error.message;
  if (error instanceof GroupNotFoundError || error instanceof GroupShareError) return error.message;
  if (error instanceof Error) return error.message;
  return "That did not work.";
}

export function parseEmails(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const email = normalizeEmail(part);
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function parseTtlDays(raw: string | null): number {
  const value = Number(raw ?? "7");
  if (value === 1 || value === 7 || value === 30) return value;
  return 7;
}

async function ensureGroup(config: GatewayConfig, groupId: string) {
  const existing = await config.groups.get(groupId);
  if (existing) return existing;
  const group = { groupId, members: [] as string[], cidrs: [] as string[] };
  await config.groups.put(group);
  return group;
}

async function seedCidrs(
  config: GatewayConfig,
  groupId: string,
  req: GatewayRequest,
): Promise<void> {
  const group = await config.groups.get(groupId);
  if (!group) throw new GroupNotFoundError(groupId);
  if (group.cidrs.length > 0) return;

  const defaults = [...(config.defaultCidrs ?? [])];
  const clientIp = resolveClientIp({
    remoteAddress: req.remoteAddress,
    forwardedFor: header(req.headers, "x-forwarded-for"),
    trustedProxies: config.trustedProxies,
  });
  if (clientIp) defaults.push(`${clientIp}/32`);

  if (defaults.length === 0) {
    throw new EmptyCidrListError();
  }
  for (const cidr of defaults) {
    await config.groups.addCidr(groupId, cidr);
  }
}

export async function handleAdminRequest(
  req: GatewayRequest,
  config: GatewayConfig,
): Promise<GatewayResponse> {
  const now = (config.now ?? Date.now)();
  const url = new URL(req.url, `http://${header(req.headers, "host") ?? config.baseDomain}`);
  const authed = operatorFromCookie(header(req.headers, "cookie"), config.secret, config.secureCookies, now);
  const body = new URLSearchParams(req.method.toUpperCase() === "POST" ? (req.body ?? "") : "");
  const expectedToken = config.operatorToken || config.secret;

  if (url.pathname === ADMIN_LOGIN_PATH && req.method.toUpperCase() === "POST") {
    const offered = body.get("token") ?? "";
    if (!expectedToken || !tokensEqual(offered, expectedToken)) {
      return html(403, adminLoginPage("That token is not valid."));
    }
    return redirect("/", issueOperatorCookie(config.secret, config.secureCookies, now));
  }

  if (!authed) {
    return html(200, adminLoginPage());
  }

  const selectedId =
    url.searchParams.get("group") || body.get("groupId") || DEFAULT_GROUP_ID;

  if (req.method.toUpperCase() === "POST" && url.pathname === ADMIN_GROUPS_PATH) {
    const groupId = (body.get("groupId") ?? "").trim() || DEFAULT_GROUP_ID;
    await ensureGroup(config, groupId);
    return redirect(`/?group=${encodeURIComponent(groupId)}`);
  }

  if (req.method.toUpperCase() === "POST" && url.pathname === ADMIN_MEMBER_PATH) {
    const groupId = (body.get("groupId") ?? "").trim() || DEFAULT_GROUP_ID;
    const email = (body.get("email") ?? "").trim();
    try {
      await ensureGroup(config, groupId);
      await config.groups.addMember(groupId, email);
      return redirect(`/?group=${encodeURIComponent(groupId)}`);
    } catch (error) {
      return dashboard(req, config, { error: errorMessage(error), selectedId: groupId });
    }
  }

  if (req.method.toUpperCase() === "POST" && url.pathname === ADMIN_CIDR_PATH) {
    const groupId = (body.get("groupId") ?? "").trim() || DEFAULT_GROUP_ID;
    const cidr = (body.get("cidr") ?? "").trim();
    try {
      await ensureGroup(config, groupId);
      await config.groups.addCidr(groupId, cidr);
      return redirect(`/?group=${encodeURIComponent(groupId)}`);
    } catch (error) {
      return dashboard(req, config, { error: errorMessage(error), selectedId: groupId });
    }
  }

  if (req.method.toUpperCase() === "POST" && url.pathname === ADMIN_REVOKE_PATH) {
    const groupId = (body.get("groupId") ?? "").trim() || DEFAULT_GROUP_ID;
    const shares = await config.shares.list();
    const live = shares.filter((share) => share.groupId === groupId && !share.revokedAt);
    const latest = live[live.length - 1];
    if (!latest) {
      return dashboard(req, config, { error: "No live share to revoke.", selectedId: groupId });
    }
    await config.shares.revoke(latest.label, now);
    return dashboard(req, config, {
      selectedId: groupId,
      notice: `Revoked ${latest.label}.`,
    });
  }

  if (req.method.toUpperCase() === "POST" && url.pathname === ADMIN_QUICK_SHARE_PATH) {
    const groupId = (body.get("groupId") ?? "").trim() || DEFAULT_GROUP_ID;
    const emailsRaw = body.get("emails") ?? "";
    const originUrl = (body.get("originUrl") ?? "").trim();
    const ttlDays = parseTtlDays(body.get("ttlDays"));
    const form = { emails: emailsRaw, originUrl, ttlDays: String(ttlDays) };
    try {
      const emails = parseEmails(emailsRaw);
      if (emails.length === 0) {
        return dashboard(req, config, {
          error: "Add at least one email under Who.",
          selectedId: groupId,
          form,
        });
      }
      if (!originUrl) {
        return dashboard(req, config, {
          error: "Where needs an origin URL.",
          selectedId: groupId,
          form,
        });
      }
      const existing = await ensureGroup(config, groupId);
      await config.groups.put({
        groupId,
        members: emails,
        cidrs: [...existing.cidrs],
      });
      await seedCidrs(config, groupId, req);
      const group = await config.groups.get(groupId);
      if (!group) throw new GroupNotFoundError(groupId);
      const share = createShareRecord({
        group,
        originUrl,
        expiresAt: now + ttlDays * 24 * 60 * 60 * 1000,
      });
      await config.shares.put(share);
      const urlValue = mintedUrl(share.label, config, req);
      return dashboard(req, config, {
        selectedId: groupId,
        mintedUrl: urlValue,
        autoShare: true,
        notice: "Private URL ready. Opening the device share sheet.",
        form,
      });
    } catch (error) {
      return dashboard(req, config, {
        error: errorMessage(error),
        selectedId: groupId,
        form,
      });
    }
  }

  if (req.method.toUpperCase() === "POST" && url.pathname === ADMIN_SHARE_PATH) {
    const groupId = (body.get("groupId") ?? "").trim() || DEFAULT_GROUP_ID;
    const originUrl = (body.get("originUrl") ?? "").trim();
    try {
      const group = await config.groups.get(groupId);
      if (!group) throw new GroupNotFoundError(groupId);
      const share = createShareRecord({ group, originUrl });
      await config.shares.put(share);
      const urlValue = mintedUrl(share.label, config, req);
      return dashboard(req, config, {
        selectedId: groupId,
        mintedUrl: urlValue,
        autoShare: true,
        notice: "URL minted. Share it from this device.",
      });
    } catch (error) {
      return dashboard(req, config, { error: errorMessage(error), selectedId: groupId });
    }
  }

  return dashboard(req, config, { selectedId });
}

async function dashboard(
  req: GatewayRequest,
  config: GatewayConfig,
  opts: {
    selectedId?: string;
    mintedUrl?: string;
    autoShare?: boolean;
    error?: string;
    notice?: string;
    form?: { emails?: string; originUrl?: string; ttlDays?: string };
  },
): Promise<GatewayResponse> {
  await ensureGroup(config, opts.selectedId || DEFAULT_GROUP_ID);
  const groups = await config.groups.list();
  const shares = await config.shares.list();
  const selected =
    groups.find((group) => group.groupId === opts.selectedId) ??
    groups.find((group) => group.groupId === DEFAULT_GROUP_ID) ??
    groups[0] ??
    null;
  const live = selected
    ? shares.filter((share) => share.groupId === selected.groupId && !share.revokedAt)
    : [];
  const latest = live[live.length - 1];
  const mintedUrlValue = opts.mintedUrl ?? (latest ? mintedUrl(latest.label, config, req) : undefined);
  return html(
    opts.error ? 400 : 200,
    adminDashboardPage({
      groups,
      shares,
      selected,
      mintedUrl: mintedUrlValue,
      autoShare: opts.autoShare,
      error: opts.error,
      notice: opts.notice,
      form: opts.form,
    }),
  );
}
