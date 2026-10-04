#!/usr/bin/env node
import { EmailCodeIdentity } from "../../dist/identity.js";
import { listenGateway, mintShare, MemoryGroupStore, MemoryShareStore } from "../../dist/server.js";

const SECRET = "dev-secret-dev-secret-dev-secret";
const groups = new MemoryGroupStore();
const shares = new MemoryShareStore();
await groups.put({ groupId: "design", members: [], cidrs: [] });
await groups.addMember("design", "ada@example.com");
await groups.addCidr("design", "127.0.0.1/32");
const share = await mintShare(
  { groups, shares },
  { groupId: "design", originUrl: "http://127.0.0.1:4010" },
);

const port = Number(process.env.GROUP_SHARE_PORT ?? 8788);
const { url } = await listenGateway(
  {
    baseDomain: "share.example.test",
    secret: SECRET,
    shares,
    groups,
    identity: new EmailCodeIdentity({
      secret: SECRET,
      directory: ["ada@example.com"],
      deliverCode: (info) => process.stderr.write(`code ${info.code} for ${info.email}\n`),
    }),
    trustedProxies: [],
    secureCookies: false,
    operatorToken: "dev-token",
  },
  port,
  "127.0.0.1",
);

process.stdout.write(`${url}\n`);
process.stdout.write(`admin ${url}/\n`);
process.stdout.write(`share-label ${share.label}\n`);
