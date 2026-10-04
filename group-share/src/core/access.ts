import { ipInCidrs } from "./cidr";
import { isInvited } from "./email";
import type { AccessDecision, Group, Identity, Share } from "./types";

export function shareIsLive(share: Share | null | undefined, now: number): share is Share {
  if (!share) return false;
  if (share.revokedAt != null && share.revokedAt <= now) return false;
  if (share.expiresAt != null && share.expiresAt <= now) return false;
  return true;
}

export function decideAccess(input: {
  share: Share | null | undefined;
  group: Group | null | undefined;
  identity: Identity | null | undefined;
  clientIp: string | null;
  now: number;
}): AccessDecision {
  if (!shareIsLive(input.share, input.now)) {
    return { allow: false, status: 404, reason: "share-missing" };
  }
  const group = input.group;
  if (!group || group.groupId !== input.share.groupId) {
    return { allow: false, status: 403, reason: "group-missing" };
  }
  if (group.members.length === 0 || group.cidrs.length === 0) {
    return { allow: false, status: 403, reason: "fail-closed" };
  }
  if (!input.identity) {
    return { allow: false, status: 403, reason: "unauthenticated" };
  }
  if (!isInvited(group.members, input.identity.email)) {
    return { allow: false, status: 403, reason: "not-invited" };
  }
  if (!input.clientIp || !ipInCidrs(input.clientIp, group.cidrs)) {
    return { allow: false, status: 403, reason: "ip-denied" };
  }
  return { allow: true };
}
