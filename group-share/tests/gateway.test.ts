import { cookieName, parseCookieHeader, signSession } from "../src/core/session";
import { handleGatewayRequest, SIGNIN_PATH, type GatewayConfig } from "../src/gateway/handler";
import { EmailCodeIdentity } from "../src/identity/email-code";
import { OidcIdentity } from "../src/identity/oidc";
import { mintShare } from "../src/server";
import { MemoryGroupStore, MemoryShareStore } from "../src/store/memory";

const SECRET = "test-secret-test-secret";
const BASE = "share.example.test";
const LABEL_HOST = (label: string) => `${label}.${BASE}`;

async function setup() {
  const groups = new MemoryGroupStore();
  const shares = new MemoryShareStore();
  await groups.put({ groupId: "design", members: [], cidrs: [] });
  await groups.addMember("design", "ada@example.com");
  await groups.addCidr("design", "203.0.113.0/24");
  const delivered: { email: string; code: string }[] = [];
  const identity = new EmailCodeIdentity({
    secret: SECRET,
    directory: ["ada@example.com", "bob@example.com"],
    deliverCode: (info) => delivered.push({ email: info.email, code: info.code }),
  });
  const share = await mintShare({ groups, shares }, { groupId: "design", originUrl: "http://127.0.0.1:4010" });
  const config: GatewayConfig = {
    baseDomain: BASE,
    secret: SECRET,
    shares,
    groups,
    identity,
    trustedProxies: [],
    secureCookies: false,
  };
  return { groups, shares, share, config, delivered, identity };
}

function req(
  host: string,
  path: string,
  over: Partial<{
    method: string;
    cookie: string;
    remoteAddress: string;
    forwardedFor: string;
    body: string;
  }> = {},
) {
  return {
    method: over.method ?? "GET",
    url: path,
    remoteAddress: over.remoteAddress ?? "203.0.113.10",
    body: over.body,
    headers: {
      host,
      cookie: over.cookie,
      "x-forwarded-for": over.forwardedFor,
      "content-type": "application/x-www-form-urlencoded",
    },
  };
}

async function sessionCookie(config: GatewayConfig, label: string, email: string): Promise<string> {
  const token = signSession({ email, label, exp: Date.now() + 60_000 }, config.secret);
  return `${cookieName(false)}=${token}`;
}

describe("gateway", () => {
  it("returns 404 for a missing or revoked label", async () => {
    const { config, share, shares } = await setup();
    const missing = await handleGatewayRequest(req("nope.share.example.test", "/"), config);
    expect(missing.status).toBe(404);
    await shares.revoke(share.label, Date.now());
    const revoked = await handleGatewayRequest(req(LABEL_HOST(share.label), "/"), config);
    expect(revoked.status).toBe(404);
  });

  it("allows a member on the allowlist and proxies the origin", async () => {
    const { config, share } = await setup();
    const cookie = await sessionCookie(config, share.label, "ada@example.com");
    const res = await handleGatewayRequest(req(LABEL_HOST(share.label), "/app", { cookie }), config);
    expect(res.proxy?.originUrl).toBe("http://127.0.0.1:4010");
    expect(res.proxy?.path).toBe("/app");
  });

  it("denies a member off the allowlist", async () => {
    const { config, share } = await setup();
    const cookie = await sessionCookie(config, share.label, "ada@example.com");
    const res = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/", { cookie, remoteAddress: "198.51.100.10" }),
      config,
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/office network or VPN/);
    expect(res.proxy).toBeUndefined();
  });

  it("denies an outsider on an allowed ip", async () => {
    const { config, share } = await setup();
    const cookie = await sessionCookie(config, share.label, "bob@example.com");
    const res = await handleGatewayRequest(req(LABEL_HOST(share.label), "/", { cookie }), config);
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/invite list/);
  });

  it("ignores a forged forwarded ip from an untrusted peer", async () => {
    const { config, share } = await setup();
    const cookie = await sessionCookie(config, share.label, "ada@example.com");
    const res = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/", {
        cookie,
        remoteAddress: "198.51.100.10",
        forwardedFor: "203.0.113.10",
      }),
      config,
    );
    expect(res.status).toBe(403);
  });

  it("ignores a session minted for another label", async () => {
    const { config, share } = await setup();
    const cookie = await sessionCookie(config, "otherlabelotherlabelother", "ada@example.com");
    const res = await handleGatewayRequest(req(LABEL_HOST(share.label), "/", { cookie }), config);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(SIGNIN_PATH);
  });

  it("re-checks membership after the cookie is issued", async () => {
    const { config, share, groups } = await setup();
    const cookie = await sessionCookie(config, share.label, "ada@example.com");
    await groups.removeMember("design", "ada@example.com");
    const res = await handleGatewayRequest(req(LABEL_HOST(share.label), "/", { cookie }), config);
    expect(res.status).toBe(403);
  });

  it("issues a host-scoped cookie after a valid email code", async () => {
    const { config, share, delivered } = await setup();
    await handleGatewayRequest(
      req(LABEL_HOST(share.label), SIGNIN_PATH, {
        method: "POST",
        body: "email=ada@example.com&next=/",
      }),
      config,
    );
    expect(delivered[0]?.code).toMatch(/^\d{6}$/);
    const verified = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/__group-share/verify", {
        method: "POST",
        body: `email=ada@example.com&code=${delivered[0]?.code}&next=/home`,
      }),
      config,
    );
    expect(verified.status).toBe(302);
    expect(verified.headers.location).toBe("/home");
    expect(verified.setCookie).toMatch(/^group-share=/);
    const token = parseCookieHeader(verified.setCookie?.split(";")[0], "group-share");
    const authed = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/home", { cookie: `group-share=${token}` }),
      config,
    );
    expect(authed.proxy?.path).toBe("/home");
  });

  it("does not let an open redirect leave the share host", async () => {
    const { config, share, delivered } = await setup();
    await handleGatewayRequest(
      req(LABEL_HOST(share.label), SIGNIN_PATH, {
        method: "POST",
        body: "email=ada@example.com&next=https://evil.example",
      }),
      config,
    );
    const verified = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/__group-share/verify", {
        method: "POST",
        body: `email=ada@example.com&code=${delivered[0]?.code}&next=https://evil.example`,
      }),
      config,
    );
    expect(verified.headers.location).toBe("/");
  });
});

describe("oidc", () => {
  it("exchanges a code and reads email from userinfo, not idp groups", async () => {
    const fetchMock: typeof fetch = async (url) => {
      const href = String(url);
      if (href.includes("/token")) {
        return new Response(JSON.stringify({ access_token: "atk" }), { status: 200 });
      }
      return new Response(JSON.stringify({ email: "ada@example.com", groups: ["admin"] }), { status: 200 });
    };
    const oidc = new OidcIdentity({
      issuer: "https://idp.example",
      clientId: "id",
      clientSecret: "secret",
      authorizationEndpoint: "https://idp.example/auth",
      tokenEndpoint: "https://idp.example/token",
      userinfoEndpoint: "https://idp.example/userinfo",
      secret: SECRET,
      fetch: fetchMock,
    });
    const location = oidc.authorizationUrl({
      label: "abc",
      next: "/",
      redirectUri: "http://abc.share.example.test/__group-share/callback",
    });
    expect(location).toContain("client_id=id");
    const state = new URL(location).searchParams.get("state") ?? "";
    const identity = await oidc.complete({ code: "code", state, label: "abc" });
    expect(identity).toEqual({ email: "ada@example.com" });
  });
});
