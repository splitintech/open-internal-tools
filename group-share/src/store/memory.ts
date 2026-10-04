import { parseCidr } from "../core/cidr";
import { normalizeEmail } from "../core/email";
import { GroupNotFoundError, InvalidCidrError, ShareNotFoundError } from "../core/errors";
import type { Group, Share } from "../core/types";
import type { GroupStore, ShareStore } from "./types";

export class MemoryShareStore implements ShareStore {
  private readonly shares = new Map<string, Share>();

  async put(share: Share): Promise<void> {
    this.shares.set(share.label, { ...share, originUrl: share.originUrl });
  }

  async get(label: string): Promise<Share | null> {
    const share = this.shares.get(label);
    return share ? { ...share } : null;
  }

  async list(): Promise<Share[]> {
    return [...this.shares.values()].map((share) => ({ ...share }));
  }

  async revoke(label: string, at: number): Promise<Share> {
    const share = this.shares.get(label);
    if (!share) throw new ShareNotFoundError(label);
    const next = { ...share, revokedAt: at };
    this.shares.set(label, next);
    return { ...next };
  }
}

export class MemoryGroupStore implements GroupStore {
  private readonly groups = new Map<string, Group>();

  async put(group: Group): Promise<void> {
    this.groups.set(group.groupId, cloneGroup(group));
  }

  async get(groupId: string): Promise<Group | null> {
    const group = this.groups.get(groupId);
    return group ? cloneGroup(group) : null;
  }

  async list(): Promise<Group[]> {
    return [...this.groups.values()].map(cloneGroup);
  }

  async addMember(groupId: string, email: string): Promise<Group> {
    const group = await this.require(groupId);
    const normalized = normalizeEmail(email);
    if (!group.members.includes(normalized)) group.members.push(normalized);
    this.groups.set(groupId, group);
    return cloneGroup(group);
  }

  async addCidr(groupId: string, cidr: string): Promise<Group> {
    const parsed = parseCidr(cidr);
    if (!parsed) throw new InvalidCidrError(cidr);
    const canonical = `${parsed.ip}/${parsed.prefix}`;
    const group = await this.require(groupId);
    if (!group.cidrs.includes(canonical)) group.cidrs.push(canonical);
    this.groups.set(groupId, group);
    return cloneGroup(group);
  }

  async removeMember(groupId: string, email: string): Promise<Group> {
    const group = await this.require(groupId);
    const normalized = normalizeEmail(email);
    group.members = group.members.filter((member) => member !== normalized);
    this.groups.set(groupId, group);
    return cloneGroup(group);
  }

  async removeCidr(groupId: string, cidr: string): Promise<Group> {
    const parsed = parseCidr(cidr);
    if (!parsed) throw new InvalidCidrError(cidr);
    const canonical = `${parsed.ip}/${parsed.prefix}`;
    const group = await this.require(groupId);
    group.cidrs = group.cidrs.filter((entry) => entry !== canonical);
    this.groups.set(groupId, group);
    return cloneGroup(group);
  }

  private async require(groupId: string): Promise<Group> {
    const group = this.groups.get(groupId);
    if (!group) throw new GroupNotFoundError(groupId);
    return cloneGroup(group);
  }
}

function cloneGroup(group: Group): Group {
  return {
    groupId: group.groupId,
    members: [...group.members],
    cidrs: [...group.cidrs],
  };
}
