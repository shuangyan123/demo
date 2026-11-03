import { app } from "electron";
import { gateManagedStorageStartup, resolveManagedStorage } from "./storage-bootstrap.ts";
import type { ManagedStorageResolution } from "../app/platform/managed-storage.js";
import { createInitialProfile, inspectInitialProfile, type FreshProfileCandidate } from "./profile-initialization.ts";
import { initialProfileRejection } from "./storage-inspection.ts";

function hostPaths() {
  return { appData: app.getPath("appData"), defaultUserData: app.getPath("userData"), defaultSessionData: app.getPath("sessionData") };
}

/** 同步 pre-ready Host seam；不调用 setPath、不初始化 session，也不把路径交给 renderer。 */
export function resolveDesktopManagedStorage(): ManagedStorageResolution {
  try {
    const paths = hostPaths();
    const result = gateManagedStorageStartup(resolveManagedStorage(paths), paths);
    if (result.kind === "unavailable" && result.reason === "unrecognized_legacy_profile") {
      const rejected = initialProfileRejection(paths.defaultUserData, "candidate");
      if (rejected) console.error(`RECALL_INITIAL_PROFILE_INSPECTION:${rejected}`);
    }
    return result;
  } catch { return { kind: "unavailable", code: "storage_unavailable", reason: "host_paths_unavailable" }; }
}

export function inspectDesktopInitialProfile() {
  try { return inspectInitialProfile(hostPaths()); }
  catch { return { kind: "unavailable", code: "storage_unavailable", reason: "host_paths_unavailable" } as const; }
}

/** Main 独占 facade；不接受 renderer、HTTP 或序列化路径。 */
export function createDesktopInitialProfile(candidate: FreshProfileCandidate): ManagedStorageResolution {
  try { return createInitialProfile(candidate, hostPaths()); }
  catch { return { kind: "unavailable", code: "storage_unavailable", reason: "host_paths_unavailable" }; }
}
