import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_CIDR_PATH,
  ADMIN_LOGIN_PATH,
  ADMIN_MEMBER_PATH,
  ADMIN_QUICK_SHARE_PATH,
  parseEmails,
} from "../src/admin/handler";
import { operatorCookieName, signOperator } from "../src/admin/session";
import { handleGatewayRequest, SIGNIN_PATH, type GatewayConfig } from "../src/gateway/handler";
import { EmailCodeIdentity } from "../src/identity/email-code";
import { mintShare } from "../src/server";
import { MemoryGroupStore, MemoryShareStore } from "../src/store/memory";
import { DEFAULT_GROUP_ID } from "../src/ui/admin";
import { UI_JS_PATH } from "../src/ui/assets";

const SECRET = "test-secret-test-secret";
const BASE = "share.example.test";
const LABEL_HOST = (label: string) => `${label}.${BASE}`;

async function setup() {
  const groups = new MemoryGroupStore();
  const shares = new MemoryShareStore();
  await groups.put({ groupId: "design", members: [], cidrs: [] });
  await groups.addMember("design", "ada@example.com");
  await groups.addCidr("design", "203.0.113.0/24");
  const identity = new EmailCodeIdentity({
    secret: SECRET,
    directory: ["ada@example.com", "bob@example.com"],
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
    operatorToken: "operator-token",
  };
  return { groups, shares, share, config, identity };
}

function req(
  host: string,
  path: string,
  over: Partial<{
    method: string;
    cookie: string;
    remoteAddress: string;
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
      "content-type": "application/x-www-form-urlencoded",
    },
  };
}

function operatorCookie(): string {
  return `${operatorCookieName(false)}=${signOperator(SECRET, Date.now() + 60_000)}`;
}

describe("waitlist UI shell", () => {
  it("styles recipient sign-in with the waitlist chrome", async () => {
    const { config, share } = await setup();
    const res = await handleGatewayRequest(req(LABEL_HOST(share.label), SIGNIN_PATH), config);
    expect(res.status).toBe(200);
    expect(res.body).toContain("questionnaire-page");
    expect(res.body).toContain("bg-saffron-ember");
    expect(res.body).toContain("grain");
    expect(res.body).toContain('name="email"');
    expect(res.body).toContain("Send code");
    expect(res.body).toContain("Split");
  });

  it("uses the waitlist card for the one-time code step", async () => {
    const { config, share } = await setup();
    const start = await handleGatewayRequest(
      req(LABEL_HOST(share.label), SIGNIN_PATH, {
        method: "POST",
        body: "email=ada@example.com&next=/",
      }),
      config,
    );
    expect(start.status).toBe(200);
    expect(start.body).toContain("questionnaire-page");
    expect(start.body).toContain("bg-saffron-ember");
    expect(start.body).toContain("One-time code");
    expect(start.body).toContain("/__group-share/verify");
    expect(start.body).toContain("ada@example.com");
  });

  it("styles 403 and 404 with the same saffron shell", async () => {
    const { config, share } = await setup();
    const outsider = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/", {
        cookie: `group-share=${Buffer.from(JSON.stringify({ skip: true })).toString("base64url")}`,
      }),
      config,
    );
    expect(outsider.status).toBe(302);

    const { signSession, cookieName } = await import("../src/core/session");
    const token = signSession(
      { email: "bob@example.com", label: share.label, exp: Date.now() + 60_000 },
      SECRET,
    );
    const forbidden = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/", { cookie: `${cookieName(false)}=${token}` }),
      config,
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toContain("questionnaire-page");
    expect(forbidden.body).toContain("bg-saffron-ember");
    expect(forbidden.body).toMatch(/invite list/);

    const missing = await handleGatewayRequest(req("missinglabelmissingla.share.example.test", "/"), config);
    expect(missing.status).toBe(404);
    expect(missing.body).toContain("questionnaire-page");
    expect(missing.body).toContain("bg-saffron-ember");
  });

  it("uses a short IP-deny line for members off the allowlist", async () => {
    const { config, share } = await setup();
    const { signSession, cookieName } = await import("../src/core/session");
    const token = signSession(
      { email: "ada@example.com", label: share.label, exp: Date.now() + 60_000 },
      SECRET,
    );
    const denied = await handleGatewayRequest(
      req(LABEL_HOST(share.label), "/", {
        cookie: `${cookieName(false)}=${token}`,
        remoteAddress: "198.51.100.10",
      }),
      config,
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toContain("office network or VPN");
  });
});

describe("three-ask admin share", () => {
  it("serves Who / Where / How long on the parent host after login", async () => {
    const { config } = await setup();
    const desk = await handleGatewayRequest(req(BASE, "/", { cookie: operatorCookie() }), config);
    expect(desk.status).toBe(200);
    expect(desk.body).toContain("questionnaire-page");
    expect(desk.body).toContain('name="emails"');
    expect(desk.body).toContain('name="originUrl"');
    expect(desk.body).toContain('name="ttlDays"');
    expect(desk.body).toContain(ADMIN_QUICK_SHARE_PATH);
    expect(desk.body).toContain(">Share<");
    expect(desk.body).not.toContain("Mint URL");
    expect(desk.body).toContain("Advanced");
  });

  it("quick-shares: seeds CIDR from operator IP and renders Share plus copy", async () => {
    const { config, groups } = await setup();
    const res = await handleGatewayRequest(
      req(BASE, ADMIN_QUICK_SHARE_PATH, {
        method: "POST",
        cookie: operatorCookie(),
        remoteAddress: "198.51.100.44",
        body: "emails=ada%40example.com%2C+bob%40example.com&originUrl=http%3A%2F%2F127.0.0.1%3A4010&ttlDays=7",
      }),
      config,
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("questionnaire-page");
    expect(res.body).toContain("data-share");
    expect(res.body).toContain("data-auto-share");
    expect(res.body).toContain("data-copy");
    expect(res.body).toContain("Copy link");
    expect(res.body).toMatch(/http:\/\/[a-z2-7]+\.share\.example\.test/);
    const group = await groups.get(DEFAULT_GROUP_ID);
    expect(group?.members).toEqual(["ada@example.com", "bob@example.com"]);
    expect(group?.cidrs).toContain("198.51.100.44/32");
  });

  it("merges GROUP_SHARE_DEFAULT_CIDRS when seeding an empty group", async () => {
    const groups = new MemoryGroupStore();
    const shares = new MemoryShareStore();
    const config: GatewayConfig = {
      baseDomain: BASE,
      secret: SECRET,
      shares,
      groups,
      identity: new EmailCodeIdentity({ secret: SECRET, directory: ["ada@example.com"] }),
      trustedProxies: [],
      secureCookies: false,
      operatorToken: "operator-token",
      defaultCidrs: ["203.0.113.0/24"],
    };
    const res = await handleGatewayRequest(
      req(BASE, ADMIN_QUICK_SHARE_PATH, {
        method: "POST",
        cookie: operatorCookie(),
        remoteAddress: "198.51.100.9",
        body: "emails=ada%40example.com&originUrl=http%3A%2F%2F127.0.0.1%3A4010&ttlDays=1",
      }),
      config,
    );
    expect(res.status).toBe(200);
    const group = await groups.get(DEFAULT_GROUP_ID);
    expect(group?.cidrs).toContain("203.0.113.0/24");
    expect(group?.cidrs).toContain("198.51.100.9/32");
  });

  it("refuses quick-share without Who or Where", async () => {
    const { config } = await setup();
    const noWho = await handleGatewayRequest(
      req(BASE, ADMIN_QUICK_SHARE_PATH, {
        method: "POST",
        cookie: operatorCookie(),
        body: "emails=&originUrl=http%3A%2F%2F127.0.0.1%3A4010&ttlDays=7",
      }),
      config,
    );
    expect(noWho.status).toBe(400);
    expect(noWho.body).toMatch(/email/i);
    expect(noWho.body).not.toContain("data-auto-share data-share-url");

    const noWhere = await handleGatewayRequest(
      req(BASE, ADMIN_QUICK_SHARE_PATH, {
        method: "POST",
        cookie: operatorCookie(),
        body: "emails=ada%40example.com&originUrl=&ttlDays=7",
      }),
      config,
    );
    expect(noWhere.status).toBe(400);
    expect(noWhere.body).toMatch(/Where/);
    expect(noWhere.body).not.toContain("data-auto-share data-share-url");
  });

  it("parses a comma-separated Who list", () => {
    expect(parseEmails("Ada@Example.com, bob@example.com; cara@example.com")).toEqual([
      "ada@example.com",
      "bob@example.com",
      "cara@example.com",
    ]);
  });

  it("auto-opens the share sheet when data-auto-share is present", () => {
    const script = readFileSync(join(process.cwd(), "ui/share.js"), "utf8");
    expect(script).toContain("data-auto-share");
    expect(script).toContain("navigator.share");
    expect(script).toContain("clipboard");
    expect(script).toContain("Link copied");
  });

  it("serves the share script as a static asset", async () => {
    const { config } = await setup();
    const res = await handleGatewayRequest(req(BASE, UI_JS_PATH), config);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.body).toContain("navigator.share");
    expect(res.body).toContain("data-auto-share");
  });

  it("keeps Advanced routes for CIDR and members", async () => {
    const { config, groups } = await setup();
    await groups.put({ groupId: "ops", members: [], cidrs: [] });
    const member = await handleGatewayRequest(
      req(BASE, ADMIN_MEMBER_PATH, {
        method: "POST",
        cookie: operatorCookie(),
        body: "groupId=ops&email=ada@example.com",
      }),
      config,
    );
    expect(member.status).toBe(302);
    const cidr = await handleGatewayRequest(
      req(BASE, ADMIN_CIDR_PATH, {
        method: "POST",
        cookie: operatorCookie(),
        body: "groupId=ops&cidr=203.0.113.0/24",
      }),
      config,
    );
    expect(cidr.status).toBe(302);
    const group = await groups.get("ops");
    expect(group?.members).toContain("ada@example.com");
    expect(group?.cidrs).toContain("203.0.113.0/24");
  });

  it("rejects a bad operator token", async () => {
    const { config } = await setup();
    const res = await handleGatewayRequest(
      req(BASE, ADMIN_LOGIN_PATH, { method: "POST", body: "token=nope" }),
      config,
    );
    expect(res.status).toBe(403);
    expect(res.body).toContain("questionnaire-page");
  });
});
