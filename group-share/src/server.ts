import { GroupNotFoundError } from "./core/errors";
export { createShareRecord, assertGroupReady } from "./core/share";
export { handleGatewayRequest, SIGNIN_PATH, VERIFY_PATH, CALLBACK_PATH, safeNextPath, isAdminHost } from "./gateway/handler";
export { createGatewayServer, listenGateway } from "./gateway/server";
export { FileGroupStore, FileShareStore, defaultDataPaths } from "./store/file";
export { MemoryGroupStore, MemoryShareStore } from "./store/memory";
export type { GroupStore, ShareStore } from "./store/types";

import { createShareRecord } from "./core/share";
import type { Share } from "./core/types";
import type { GroupStore, ShareStore } from "./store/types";

export async function mintShare(
  stores: { groups: GroupStore; shares: ShareStore },
  input: { groupId: string; originUrl: string; resourceId?: string; expiresAt?: number | null },
): Promise<Share> {
  const group = await stores.groups.get(input.groupId);
  if (!group) throw new GroupNotFoundError(input.groupId);
  const share = createShareRecord({
    group,
    originUrl: input.originUrl,
    resourceId: input.resourceId,
    expiresAt: input.expiresAt,
  });
  await stores.shares.put(share);
  return share;
}
