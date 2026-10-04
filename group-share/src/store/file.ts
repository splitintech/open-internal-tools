import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseCidr } from "../core/cidr";
import { normalizeEmail } from "../core/email";
import { GroupNotFoundError, InvalidCidrError, ShareNotFoundError } from "../core/errors";
import type { Group, Share } from "../core/types";
import type { GroupStore, ShareStore } from "./types";

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export class FileShareStore implements ShareStore {
  constructor(private readonly path: string) {}

  async put(share: Share): Promise<void> {
    const all = await readJson<Record<string, Share>>(this.path, {});
    all[share.label] = share;
    await writeJson(this.path, all);
  }

  async get(label: string): Promise<Share | null> {
    const all = await readJson<Record<string, Share>>(this.path, {});
    return all[label] ?? null;
  }

  async list(): Promise<Share[]> {
    const all = await readJson<Record<string, Share>>(this.path, {});
    return Object.values(all);
  }

  async revoke(label: string, at: number): Promise<Share> {
    const all = await readJson<Record<string, Share>>(this.path, {});
    const share = all[label];
    if (!share) throw new ShareNotFoundError(label);
    const next = { ...share, revokedAt: at };
    all[label] = next;
    await writeJson(this.path, all);
    return next;
  }
}

export class FileGroupStore implements GroupStore {
  constructor(private readonly path: string) {}

  async put(group: Group): Promise<void> {
    const all = await readJson<Record<string, Group>>(this.path, {});
    all[group.groupId] = group;
    await writeJson(this.path, all);
  }

  async get(groupId: string): Promise<Group | null> {
    const all = await readJson<Record<string, Group>>(this.path, {});
    return all[groupId] ?? null;
  }

  async list(): Promise<Group[]> {
    const all = await readJson<Record<string, Group>>(this.path, {});
    return Object.values(all);
  }

  async addMember(groupId: string, email: string): Promise<Group> {
    return this.mutate(groupId, (group) => {
      const normalized = normalizeEmail(email);
      if (!group.members.includes(normalized)) group.members.push(normalized);
    });
  }

  async addCidr(groupId: string, cidr: string): Promise<Group> {
    const parsed = parseCidr(cidr);
    if (!parsed) throw new InvalidCidrError(cidr);
    const canonical = `${parsed.ip}/${parsed.prefix}`;
    return this.mutate(groupId, (group) => {
      if (!group.cidrs.includes(canonical)) group.cidrs.push(canonical);
    });
  }

  async removeMember(groupId: string, email: string): Promise<Group> {
    const normalized = normalizeEmail(email);
    return this.mutate(groupId, (group) => {
      group.members = group.members.filter((member) => member !== normalized);
    });
  }

  async removeCidr(groupId: string, cidr: string): Promise<Group> {
    const parsed = parseCidr(cidr);
    if (!parsed) throw new InvalidCidrError(cidr);
    const canonical = `${parsed.ip}/${parsed.prefix}`;
    return this.mutate(groupId, (group) => {
      group.cidrs = group.cidrs.filter((entry) => entry !== canonical);
    });
  }

  private async mutate(groupId: string, fn: (group: Group) => void): Promise<Group> {
    const all = await readJson<Record<string, Group>>(this.path, {});
    const existing = all[groupId];
    if (!existing) throw new GroupNotFoundError(groupId);
    const group: Group = {
      groupId: existing.groupId,
      members: [...existing.members],
      cidrs: [...existing.cidrs],
    };
    fn(group);
    all[groupId] = group;
    await writeJson(this.path, all);
    return group;
  }
}

export function defaultDataPaths(root: string): { shares: string; groups: string } {
  return {
    shares: join(root, "shares.json"),
    groups: join(root, "groups.json"),
  };
}
