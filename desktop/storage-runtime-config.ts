import type { ManagedStorageHostConfig } from "../app/platform/managed-storage.js";

/** Main 显式覆盖继承的环境值；仅传定位事实，不传凭据、题目或历史。 */
export function serializeStorageRuntimeConfig(config: ManagedStorageHostConfig): string {
  return JSON.stringify({ formatVersion: 1, profileId: config.profileId, epochId: config.epochId,
    managedRoot: config.managedRoot, profileRoot: config.profileRoot, managedFilesRoot: config.managedFilesRoot });
}
