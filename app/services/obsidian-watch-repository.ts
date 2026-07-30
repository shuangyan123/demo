import { reviewDb } from "../db/review-db.ts";
import { obsidianVaultAdapter } from "./obsidian-vault-adapter.ts";

/** 监听专用 repository；目录句柄不会进入运行时快照或 React 状态。 */
export const obsidianWatchRepository = {
  async watchChanges(listener: (change: { revision: number; occurredAt: string }) => void) {
    const config = await reviewDb.obsidianVaultConfigs.get("default");
    if (!config) throw new Error("请先连接 Obsidian Vault");
    const backend = config.backend ?? obsidianVaultAdapter.preferredBackend();
    const permission = await obsidianVaultAdapter.permission(config.directoryHandle, false, backend);
    if (permission !== "granted") throw new Error("Obsidian Vault 写入权限不可用，请重新授权");
    return obsidianVaultAdapter.watchChanges(
      config.directoryHandle,
      config.managedRoot,
      backend,
      listener,
    );
  },
};
