#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";

import { GroupNotFoundError, GroupShareError } from "./core/errors";
import { shareUrl } from "./core/label";
import { EmailCodeIdentity, directoryFromJson } from "./identity/index";
import { mintShare } from "./server";
import { FileGroupStore, FileShareStore, defaultDataPaths } from "./store/file";
import { listenGateway } from "./gateway/server";
import { readFileSync } from "node:fs";

function dataDir(): string {
  return process.env.GROUP_SHARE_DATA_DIR ?? join(homedir(), ".config", "group-share");
}

function stores() {
  const paths = defaultDataPaths(dataDir());
  return {
    groups: new FileGroupStore(paths.groups),
    shares: new FileShareStore(paths.shares),
  };
}

function arg(name: string, argv: string[]): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function usage(): string {
  return `group-share — private share subdomains

Usage:
  group-share serve
  group-share groups add <groupId> <email>
  group-share allow <groupId> <cidr>
  group-share share --group <groupId> --origin <url>
  group-share revoke <label>

Admin UI is the parent host (or http://127.0.0.1:PORT). Recipients open the minted subdomain.
`;
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  const { groups, shares } = stores();

  if (command === "groups" && argv[1] === "add") {
    const groupId = argv[2];
    const email = argv[3];
    if (!groupId || !email) {
      process.stderr.write(usage());
      return 1;
    }
    const existing = await groups.get(groupId);
    if (!existing) await groups.put({ groupId, members: [], cidrs: [] });
    const group = await groups.addMember(groupId, email);
    process.stdout.write(`${group.groupId} members: ${group.members.join(", ")}\n`);
    return 0;
  }

  if (command === "allow") {
    const groupId = argv[1];
    const cidr = argv[2];
    if (!groupId || !cidr) {
      process.stderr.write(usage());
      return 1;
    }
    const existing = await groups.get(groupId);
    if (!existing) await groups.put({ groupId, members: [], cidrs: [] });
    const group = await groups.addCidr(groupId, cidr);
    process.stdout.write(`${group.groupId} cidrs: ${group.cidrs.join(", ")}\n`);
    return 0;
  }

  if (command === "share") {
    const groupId = arg("--group", argv);
    const originUrl = arg("--origin", argv);
    if (!groupId || !originUrl) {
      process.stderr.write(usage());
      return 1;
    }
    const ttl = arg("--ttl", argv);
    const expiresAt = ttl ? Date.now() + Number(ttl) * 1000 : null;
    const share = await mintShare({ groups, shares }, { groupId, originUrl, expiresAt });
    const base = process.env.GROUP_SHARE_BASE_DOMAIN ?? "share.example.test";
    const protocol = process.env.GROUP_SHARE_SECURE === "0" ? "http" : "https";
    process.stdout.write(`${shareUrl(share.label, base, protocol)}\n`);
    return 0;
  }

  if (command === "revoke") {
    const label = argv[1];
    if (!label) {
      process.stderr.write(usage());
      return 1;
    }
    const share = await shares.revoke(label, Date.now());
    process.stdout.write(`revoked ${share.label}\n`);
    return 0;
  }

  if (command === "serve") {
    const secret = process.env.GROUP_SHARE_SECRET;
    if (!secret) {
      process.stderr.write("GROUP_SHARE_SECRET is required.\n");
      return 1;
    }
    const baseDomain = process.env.GROUP_SHARE_BASE_DOMAIN ?? "share.example.test";
    const port = Number(process.env.GROUP_SHARE_PORT ?? 8787);
    const host = process.env.GROUP_SHARE_HOST ?? "127.0.0.1";
    const trustedProxies = (process.env.GROUP_SHARE_TRUSTED_PROXIES ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const defaultCidrs = (process.env.GROUP_SHARE_DEFAULT_CIDRS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const directoryPath = process.env.GROUP_SHARE_DIRECTORY;
    const emails = directoryPath
      ? [...directoryFromJson(readFileSync(directoryPath, "utf8"))]
      : [];
    const identity = new EmailCodeIdentity({
      secret,
      directory: emails,
      isKnown: async (email) => {
        const all = await groups.list();
        return all.some((group) => group.members.includes(email));
      },
      deliverCode: (info) => {
        process.stderr.write(`[group-share] code for ${info.email} on ${info.label}\n`);
      },
    });
    await listenGateway(
      {
        baseDomain,
        secret,
        shares,
        groups,
        identity,
        trustedProxies,
        defaultCidrs,
        secureCookies: process.env.GROUP_SHARE_SECURE !== "0",
        operatorToken: process.env.GROUP_SHARE_OPERATOR_TOKEN || secret,
      },
      port,
      host,
    );
    process.stderr.write(`group-share listening on ${host}:${port} for *.${baseDomain}\n`);
    return new Promise(() => undefined);
  }

  process.stderr.write(usage());
  return command ? 1 : 0;
}

export { main };

const isDirect = process.argv[1]?.includes("cli");
if (isDirect) {
  main().then(
    (code) => {
      if (typeof code === "number") process.exitCode = code;
    },
    (error) => {
      const message = error instanceof GroupShareError || error instanceof GroupNotFoundError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
