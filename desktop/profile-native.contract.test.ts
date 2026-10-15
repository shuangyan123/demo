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
    ["test-support/profile-native.cjs", root, mode], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 40000 }).trim());
  return { root, launch };
}

if (process.platform === "win32") for (const mode of ["cancel", "authorize", "changed", "local-state-changed", "host-path-changed", "stale-before-ready"] as const)
  test(`actual Electron native ${mode}: lifecycle, owned confirmation and post-choice revalidation`, t => {
    const { root, launch } = nativeFixture(t);
    const result = launch(mode);
    t.diagnostic(JSON.stringify({ mode, observations: result.observations }));
    assert.equal(result.result.kind, mode === "cancel" ? "cancelled" : mode === "authorize" ? "ready" : "unavailable");
    const metadata = path.join(root, "appData", "profile", ".recall-storage", "identity.json");
    assert.equal(existsSync(metadata), mode === "authorize");
    assert.equal(existsSync(path.join(root, "appData", "profile", "managed-files")), false);
    if (mode === "authorize") assert.deepEqual(launch("restart").config, result.result.config);
    if (mode === "changed") assert.equal(readdirSync(path.join(root, "appData", "profile")).includes("foreign"), true);
    const before = result.observations.find((item: { stage: string }) => item.stage === "before-ready");
    const prompt = result.observations.find((item: { stage: string }) => item.stage === "before-prompt");
    assert.equal(prompt.ready, true);
    assert.equal(before.files.some((file: { name: string }) => file.name === "Local State"), false);
    assert.equal(prompt.files.find((file: { name: string }) => file.name === "Local State").bytes > 0, true);
    assert.deepEqual(before.profile, prompt.profile);
    assert.deepEqual(before.hostPaths, prompt.hostPaths);
    assert.deepEqual(before.files.find((file: { name: string }) => file.name === "lockfile"), prompt.files.find((file: { name: string }) => file.name === "lockfile"));
    if (mode === "stale-before-ready") assert.equal(result.result.reason, "initialization_candidate_changed");
  });

if (process.platform === "win32") for (const mode of ["history-before-prompt", "identity-before-prompt", "corrupt-before-prompt", "host-before-prompt"])
  test(`actual Electron refuses ${mode} before authorizing or publishing`, t => {
    const { root, launch } = nativeFixture(t);
    assert.equal(launch(mode).result.kind, "unavailable");
    if (mode === "history-before-prompt") assert.equal(readFileSync(path.join(root, "appData/profile/foreign"), "utf8"), "preserve");
    if (mode === "corrupt-before-prompt") assert.equal(readFileSync(path.join(root, "appData/recall-storage/bootstrap.json"), "utf8"), "{partial");
    if (mode === "identity-before-prompt") assert.equal(JSON.parse(readFileSync(path.join(root, "appData/profile/.recall-storage/identity.json"), "utf8")).profileId, "00000000-0000-4000-8000-000000000001");
    assert.equal(existsSync(path.join(root, "appData/recall-storage/bootstrap.json")), mode === "corrupt-before-prompt");
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
