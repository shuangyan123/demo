import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveManagedStorage } from "../desktop/storage-bootstrap.ts";
import { serializeStorageRuntimeConfig } from "../desktop/storage-runtime-config.ts";

/** 显式、独立临时 Host profile；只能用于 contracts/Playwright launcher，不是生产 fallback。 */
export function diagnosticStorageFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "recall-durable-submission-test-"));
  const appData = path.join(root, "os-config");
  const profile = path.join(appData, "test-profile");
  mkdirSync(path.join(profile, "Partitions", "review-workspace"), { recursive: true });
  const resolved = resolveManagedStorage({ appData, defaultUserData: profile, defaultSessionData: profile });
  if (resolved.kind !== "ready" && resolved.kind !== "legacy_existing_profile") throw new Error("test_host_profile_unavailable");
  return { root, config: resolved.config, payload: serializeStorageRuntimeConfig(resolved.config),
    file: path.join(resolved.config.managedFilesRoot, "diagnostic-history", "history.json"),
    cleanup() {
      if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("recall-durable-submission-test-"))
        throw new Error("unsafe_test_cleanup");
      rmSync(root, { recursive: true, force: true });
    },
  };
}
