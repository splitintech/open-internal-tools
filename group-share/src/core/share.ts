import { EmptyCidrListError, EmptyInviteListError, InvalidOriginError } from "./errors";
import { mintLabel } from "./label";
import type { Group, Share } from "./types";

export function assertGroupReady(group: Group): void {
  if (group.members.length === 0) throw new EmptyInviteListError();
  if (group.cidrs.length === 0) throw new EmptyCidrListError();
}

export function createShareRecord(opts: {
  group: Group;
  originUrl: string;
  resourceId?: string;
  expiresAt?: number | null;
  mint?: () => string;
}): Share {
  assertGroupReady(opts.group);
  let origin: URL;
  try {
    origin = new URL(opts.originUrl);
  } catch {
    throw new InvalidOriginError(opts.originUrl);
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new InvalidOriginError(opts.originUrl);
  }
  return {
    label: (opts.mint ?? mintLabel)(),
    groupId: opts.group.groupId,
    resourceId: opts.resourceId ?? origin.host,
    originUrl: origin.origin,
    expiresAt: opts.expiresAt ?? null,
    revokedAt: null,
  };
}
