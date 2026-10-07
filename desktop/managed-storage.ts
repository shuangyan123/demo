import { app } from "electron";
import { gateManagedStorageStartup, resolveManagedStorage } from "./storage-bootstrap.ts";
import type { ManagedStorageResolution } from "../app/platform/managed-storage.js";

/** 同步 pre-ready Host seam；不调用 setPath、不初始化 session，也不把路径交给 renderer。 */
export function resolveDesktopManagedStorage(): ManagedStorageResolution {
  try {
    const paths = { appData: app.getPath("appData"), defaultUserData: app.getPath("userData"), defaultSessionData: app.getPath("sessionData") };
    return gateManagedStorageStartup(resolveManagedStorage(paths), paths);
  } catch { return { kind: "unavailable", code: "storage_unavailable", reason: "host_paths_unavailable" }; }
}
