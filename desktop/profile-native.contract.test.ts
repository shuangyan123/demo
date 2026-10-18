import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectInitialProfile } from "./profile-initialization.ts";
import { resolveManagedStorage } from "./storage-bootstrap.ts";

function nativeFixture(t: { after: (callback: () => void) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "recall-native-profile-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.match(path.basename(root), /^recall-native-profile-test-/);
    rmSync(root, { recursive: true, force: true });
  });
  const launch = (mode: string) => JSON.parse(execFileSync(path.resolve("node_modules/electron/dist/electron.exe"),
    ["test-support/profile-native.cjs", root, mode], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 25000 }).trim());
  return { root, launch };
}

if (process.platform === "win32") for (const mode of ["cancel", "authorize", "changed"] as const)
  test(`actual Electron native ${mode}: lifecycle, owned confirmation and post-choice revalidation`, t => {
    const { root, launch } = nativeFixture(t);
    const result = launch(mode);
    assert.equal(result.result.kind, mode === "cancel" ? "cancelled" : mode === "authorize" ? "ready" : "unavailable");
    const metadata = path.join(root, "appData", "profile", ".recall-storage", "identity.json");
    assert.equal(existsSync(metadata), mode === "authorize");
    assert.equal(existsSync(path.join(root, "appData", "profile", "managed-files")), false);
    if (mode === "authorize") assert.deepEqual(launch("restart").config, result.result.config);
    if (mode === "changed") assert.equal(readdirSync(path.join(root, "appData", "profile")).includes("foreign"), true);
  });

if (process.platform === "win32") test("actual Electron Cancel exits, then a new native process can Create without cleaning Local State", t => {
  const { root, launch } = nativeFixture(t);
  const appData = path.join(root, "appData"); const profile = path.join(appData, "profile");
  assert.equal(launch("cancel").result.kind, "cancelled");
  // execFileSync 已确认 Main 退出；此时再检查，不能用退出前 stdout 的 entries 代替。
  assert.deepEqual(readdirSync(profile), ["Local State"]);
  const localState = readFileSync(path.join(profile, "Local State"));
  const paths = { appData, defaultUserData: profile, defaultSessionData: profile };
  assert.equal(resolveManagedStorage(paths).kind, "uninitialized");
  assert.equal(inspectInitialProfile(paths).kind, "eligible");
  assert.equal(existsSync(path.join(appData, "recall-storage")), false);
  assert.equal(existsSync(path.join(profile, ".recall-storage")), false);
  assert.equal(existsSync(path.join(profile, "managed-files")), false);
  const created = launch("authorize").result;
  assert.equal(created.kind, "ready");
  assert.deepEqual(readFileSync(path.join(profile, "Local State")), localState);
  assert.deepEqual(launch("restart").config, created.config);
  assert.deepEqual(readFileSync(path.join(profile, "Local State")), localState);
});

test("packaged Main inspects fresh storage only after app.whenReady, retaining native consent", () => {
  const main = readFileSync(path.resolve("desktop/main.ts"), "utf8");
  assert.match(main, /app\.whenReady\(\)\.then\(launchFreshProfileAfterReady\)/);
  assert.match(main, /async function launchFreshProfileAfterReady\(\)/);
  const afterReady = main.slice(main.indexOf("async function launchFreshProfileAfterReady()"), main.indexOf("function installApplicationLifecycle()"));
  assert.ok(afterReady.indexOf("resolveDesktopManagedStorage()") >= 0);
  assert.ok(afterReady.indexOf("inspectDesktopInitialProfile()") > afterReady.indexOf("resolveDesktopManagedStorage()"));
  assert.ok(afterReady.indexOf("launchInitialProfile(inspected.candidate)") > afterReady.indexOf("inspectDesktopInitialProfile()"));
  assert.match(main, /completeInitialProfileDecision\(candidate/);
  assert.doesNotMatch(main.slice(main.indexOf("const storageState = resolveDesktopManagedStorage()")), /app\.whenReady\(\)\.then\(\(\) => launchInitialProfile\(inspected\.candidate\)\)/);
});

test("packed first-profile diagnostics use only a fixed category, never path or secret values", () => {
  const script = readFileSync(path.resolve("desktop/profile-initialization.ts"), "utf8");
  assert.match(script, /RECALL_INITIAL_PROFILE_REVALIDATION:/);
  assert.match(script, /local_state_binding_changed/);
  assert.match(script, /recall_namespace_present/);
  assert.doesNotMatch(script, /console\\.error\\([^)]*(?:paths\\.|binding\\.|readFileSync|current\\.)/);
});
