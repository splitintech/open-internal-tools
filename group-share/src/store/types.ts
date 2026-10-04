import type { Group, Share } from "../core/types";

export interface ShareStore {
  put(share: Share): Promise<void>;
  get(label: string): Promise<Share | null>;
  list(): Promise<Share[]>;
  revoke(label: string, at: number): Promise<Share>;
}

export interface GroupStore {
  put(group: Group): Promise<void>;
  get(groupId: string): Promise<Group | null>;
  list(): Promise<Group[]>;
  addMember(groupId: string, email: string): Promise<Group>;
  addCidr(groupId: string, cidr: string): Promise<Group>;
  removeMember(groupId: string, email: string): Promise<Group>;
  removeCidr(groupId: string, cidr: string): Promise<Group>;
}
