import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decideAccess } from "../src/core/access";
import { ipInCidrs, normalizeIp, parseCidr } from "../src/core/cidr";
import { resolveClientIp } from "../src/core/client-ip";
import { isInvited, normalizeEmail } from "../src/core/email";
import { EmptyCidrListError, EmptyInviteListError } from "../src/core/errors";
import { encodeBase32, mintLabel, parseShareHost, RESERVED_LABELS } from "../src/core/label";
import { signSession, verifySession } from "../src/core/session";
import { createShareRecord } from "../src/core/share";
import type { Group, Share } from "../src/core/types";

const group: Group = {
  groupId: "design",
  members: ["ada@example.com"],
  cidrs: ["203.0.113.0/24"],
};

function liveShare(over: Partial<Share> = {}): Share {
  return {
    label: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
    groupId: "design",
    resourceId: "app",
    originUrl: "http://127.0.0.1:4010",
    expiresAt: null,
    revokedAt: null,
    ...over,
  };
}

describe("labels", () => {
  it("mints 128-bit base32 labels and skips reserved names", () => {
    const label = mintLabel();
    expect(label).toMatch(/^[a-z2-7]{26}$/);
    expect(RESERVED_LABELS).not.toContain(label);
    expect(encodeBase32(Buffer.alloc(16, 1)).length).toBe(26);
  });

  it("parses one-label share hosts and rejects the parent", () => {
    expect(parseShareHost("k7m2pabcdefghijklmnopqrs.share.example.test", "share.example.test")).toBe(
      "k7m2pabcdefghijklmnopqrs",
    );
    expect(parseShareHost("share.example.test", "share.example.test")).toBeNull();
    expect(parseShareHost("www.share.example.test", "share.example.test")).toBeNull();
    expect(parseShareHost("api.share.example.test:8787", "share.example.test")).toBeNull();
  });
});

describe("invite list", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail(" Ada@Example.COM ")).toBe("ada@example.com");
    expect(isInvited(["ada@example.com"], "ADA@example.com")).toBe(true);
    expect(isInvited(["ada@example.com"], "bob@example.com")).toBe(false);
  });
});

describe("cidrs", () => {
  it("matches ipv4 and mapped ipv6, and fails closed on an empty list", () => {
    expect(parseCidr("203.0.113.0/24")?.prefix).toBe(24);
    expect(ipInCidrs("203.0.113.10", ["203.0.113.0/24"])).toBe(true);
    expect(ipInCidrs("198.51.100.10", ["203.0.113.0/24"])).toBe(false);
    expect(normalizeIp("::ffff:203.0.113.10")).toEqual({ ip: "203.0.113.10", family: 4 });
    expect(ipInCidrs("::ffff:203.0.113.10", ["203.0.113.0/24"])).toBe(true);
    expect(ipInCidrs("203.0.113.10", [])).toBe(false);
    expect(ipInCidrs("203.0.113.10", ["not-a-cidr"])).toBe(false);
  });
});

describe("client ip", () => {
  it("uses the socket address when the peer is not a trusted proxy", () => {
    expect(
      resolveClientIp({
        remoteAddress: "198.51.100.10",
        forwardedFor: "203.0.113.10",
        trustedProxies: [],
      }),
    ).toBe("198.51.100.10");
  });

  it("takes the hop a trusted proxy appended", () => {
    expect(
      resolveClientIp({
        remoteAddress: "192.0.2.1",
        forwardedFor: "203.0.113.10",
        trustedProxies: ["192.0.2.1/32"],
      }),
    ).toBe("203.0.113.10");
  });
});

describe("sessions", () => {
  it("rejects tampered tokens and expired claims", () => {
    const secret = "test-secret";
    const token = signSession({ email: "ada@example.com", label: "abc", exp: Date.now() + 60_000 }, secret);
    expect(verifySession(token, secret)?.email).toBe("ada@example.com");
    expect(verifySession(`${token}x`, secret)).toBeNull();
    const expired = signSession({ email: "ada@example.com", label: "abc", exp: 1 }, secret);
    expect(verifySession(expired, secret, Date.now())).toBeNull();
  });
});

describe("access", () => {
  it("allows only a live share, invited member, and allowlisted ip", () => {
    const share = liveShare();
    const allow = decideAccess({
      share,
      group,
      identity: { email: "ada@example.com" },
      clientIp: "203.0.113.10",
      now: 100,
    });
    expect(allow).toEqual({ allow: true });
    expect(
      decideAccess({
        share: liveShare({ revokedAt: 50 }),
        group,
        identity: { email: "ada@example.com" },
        clientIp: "203.0.113.10",
        now: 100,
      }).status,
    ).toBe(404);
    expect(
      decideAccess({
        share: liveShare({ expiresAt: 50 }),
        group,
        identity: { email: "ada@example.com" },
        clientIp: "203.0.113.10",
        now: 100,
      }).reason,
    ).toBe("share-missing");
    expect(
      decideAccess({
        share,
        group,
        identity: { email: "bob@example.com" },
        clientIp: "203.0.113.10",
        now: 100,
      }).reason,
    ).toBe("not-invited");
    expect(
      decideAccess({
        share,
        group,
        identity: { email: "ada@example.com" },
        clientIp: "198.51.100.10",
        now: 100,
      }).reason,
    ).toBe("ip-denied");
    expect(
      decideAccess({
        share,
        group: { ...group, members: [], cidrs: ["203.0.113.0/24"] },
        identity: { email: "ada@example.com" },
        clientIp: "203.0.113.10",
        now: 100,
      }).reason,
    ).toBe("fail-closed");
  });
});

describe("mint", () => {
  it("refuses groups with empty invites or cidrs", () => {
    expect(() =>
      createShareRecord({ group: { ...group, members: [] }, originUrl: "http://127.0.0.1:4010" }),
    ).toThrow(EmptyInviteListError);
    expect(() =>
      createShareRecord({ group: { ...group, cidrs: [] }, originUrl: "http://127.0.0.1:4010" }),
    ).toThrow(EmptyCidrListError);
  });
});

describe("file store smoke path", () => {
  it("round-trips a group through json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "group-share-"));
    const { FileGroupStore } = await import("../src/store/file");
    const store = new FileGroupStore(join(dir, "groups.json"));
    await store.put({ groupId: "design", members: [], cidrs: [] });
    await store.addMember("design", "ADA@example.com");
    await store.addCidr("design", "203.0.113.10");
    const loaded = await store.get("design");
    expect(loaded).toEqual({
      groupId: "design",
      members: ["ada@example.com"],
      cidrs: ["203.0.113.10/32"],
    });
    await rm(dir, { recursive: true, force: true });
  });
});
