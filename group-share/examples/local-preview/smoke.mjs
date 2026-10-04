#!/usr/bin/env node
import { cookieName, signSession } from "../../dist/index.js";
import { handleGatewayRequest } from "../../dist/server.js";
import { EmailCodeIdentity } from "../../dist/identity.js";
import { mintShare } from "../../dist/server.js";
import { MemoryGroupStore, MemoryShareStore } from "../../dist/server.js";

const SECRET = "smoke-secret-smoke-secret";
const BASE = "share.example.test";

const groups = new MemoryGroupStore();
const shares = new MemoryShareStore();
await groups.put({ groupId: "design", members: [], cidrs: [] });
await groups.addMember("design", "ada@example.com");
await groups.addCidr("design", "203.0.113.0/24");
const share = await mintShare({ groups, shares }, { groupId: "design", originUrl: "http://127.0.0.1:4010" });
const config = {
  baseDomain: BASE,
  secret: SECRET,
  shares,
  groups,
  identity: new EmailCodeIdentity({ secret: SECRET, directory: ["ada@example.com", "bob@example.com"] }),
  trustedProxies: [],
  secureCookies: false,
};

function req(path, over = {}) {
  return {
    method: "GET",
    url: path,
    remoteAddress: over.remoteAddress ?? "203.0.113.10",
    headers: {
      host: over.host ?? `${share.label}.${BASE}`,
      cookie: over.cookie,
      "x-forwarded-for": over.forwardedFor,
    },
  };
}

function cookieFor(email, label = share.label) {
  const token = signSession({ email, label, exp: Date.now() + 60_000 }, SECRET);
  return `${cookieName(false)}=${token}`;
}

const cases = [];

const memberOk = await handleGatewayRequest(req("/", { cookie: cookieFor("ada@example.com") }), config);
cases.push(["member-on-allowlist", memberOk.proxy ? 200 : memberOk.status, 200]);

const memberOff = await handleGatewayRequest(
  req("/", { cookie: cookieFor("ada@example.com"), remoteAddress: "198.51.100.10" }),
  config,
);
cases.push(["member-off-allowlist", memberOff.status, 403]);

const outsider = await handleGatewayRequest(req("/", { cookie: cookieFor("bob@example.com") }), config);
cases.push(["outsider-on-allowlist", outsider.status, 403]);

const missing = await handleGatewayRequest(req("/", { host: `missinglabelmissingla.${BASE}` }), config);
cases.push(["missing-label", missing.status, 404]);

await shares.revoke(share.label, Date.now());
const revoked = await handleGatewayRequest(req("/", { cookie: cookieFor("ada@example.com") }), config);
cases.push(["revoked", revoked.status, 404]);

const share2 = await mintShare({ groups, shares }, { groupId: "design", originUrl: "http://127.0.0.1:4010" });
const spoof = await handleGatewayRequest(
  {
    method: "GET",
    url: "/",
    remoteAddress: "198.51.100.10",
    headers: {
      host: `${share2.label}.${BASE}`,
      cookie: cookieFor("ada@example.com", share2.label),
      "x-forwarded-for": "203.0.113.10",
    },
  },
  config,
);
cases.push(["forged-forwarded-ip", spoof.status, 403]);

let failed = 0;
for (const [name, got, want] of cases) {
  const ok = got === want;
  process.stdout.write(`${ok ? "ok" : "fail"} ${name} got=${got} want=${want}\n`);
  if (!ok) failed += 1;
}
process.exitCode = failed === 0 ? 0 : 1;
