import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveManagedStorage } from "../desktop/storage-bootstrap.ts";
import { serializeStorageRuntimeConfig } from "../desktop/storage-runtime-config.ts";
import { createInitialProfile, inspectInitialProfile } from "../desktop/profile-initialization.ts";

/** 显式、独立临时 Host profile；只能用于 contracts/Playwright launcher，不是生产 fallback。 */
export function diagnosticStorageFixture(fresh = false) {
  // Windows CI 的 TEMP 可含短名称或别名；只规范化测试父目录，不放宽生产 Host 校验。
  const parent = realpathSync.native(os.tmpdir());
  const root = mkdtempSync(path.join(parent, "recall-durable-submission-test-"));
  const owner = lstatSync(root);
  function cleanup() {
    if (path.dirname(root) !== parent || !path.basename(root).startsWith("recall-durable-submission-test-"))
      throw new Error("unsafe_test_cleanup");
    let current;
    try { current = lstatSync(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== owner.dev || current.ino !== owner.ino
      || realpathSync.native(root) !== root) throw new Error("unsafe_test_cleanup");
    rmSync(root, { recursive: true, force: true });
  }
  try {
    const appData = path.join(root, "os-config");
    const profile = path.join(appData, "test-profile");
    mkdirSync(fresh ? appData : path.join(profile, "Partitions", "review-workspace"), { recursive: true });
    const paths = { appData, defaultUserData: profile, defaultSessionData: profile };
    const inspected = fresh ? inspectInitialProfile(paths) : undefined;
    if (fresh && inspected?.kind !== "eligible")
      throw new Error(`fresh_test_candidate_unavailable:${inspected?.kind}:${inspected && "reason" in inspected ? inspected.reason : "no_reason"}`);
    // fresh fixture 显式模拟 Main 已获授权；不会构造 legacy partition 来冒充首次初始化。
    const resolved = inspected?.kind === "eligible" ? createInitialProfile(inspected.candidate, paths) : resolveManagedStorage(paths);
    if (resolved.kind !== "ready" && resolved.kind !== "legacy_existing_profile")
      throw new Error(`test_host_profile_unavailable:${resolved.kind}:${"reason" in resolved ? resolved.reason : "no_reason"}`);
    return { root, config: resolved.config, payload: serializeStorageRuntimeConfig(resolved.config),
      file: path.join(resolved.config.managedFilesRoot, "diagnostic-history", "history.json"), cleanup };
  } catch (error) {
    try { cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "test_host_profile_setup_and_cleanup_failed", { cause: error }); }
    throw error;
  }
}
