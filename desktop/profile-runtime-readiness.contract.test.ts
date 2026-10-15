import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { waitForInitialProfileRuntime } from "./profile-runtime-readiness.ts";

function fixture(t: { after: (callback: () => void) => void }) {
  const temporaryRoot = realpathSync.native(os.tmpdir());
  const root = mkdtempSync(path.join(temporaryRoot, "recall-runtime-readiness-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), temporaryRoot); assert.match(path.basename(root), /^recall-runtime-readiness-test-/);
    rmSync(root, { recursive: true, force: true });
  });
  const appData = path.join(root, "appData"); const profile = path.join(appData, "profile");
  mkdirSync(profile, { recursive: true }); writeFileSync(path.join(profile, "lockfile"), "");
  const localState = path.join(profile, "Local State");
  const bytes = JSON.stringify({ os_crypt: { audit_enabled: true,
    encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.alloc(64)]).toString("base64") }, uninstall_metrics: { installation_date2: "1" } });
  return { root, appData, profile, localState, bytes, paths: { appData, defaultUserData: profile, defaultSessionData: profile } };
}

if (process.platform === "win32") {
  test("initial runtime barrier waits for observed valid Local State without writing or authorizing", async t => {
    const f = fixture(t); const pending = waitForInitialProfileRuntime(f.paths);
    assert.deepEqual(readdirSync(f.profile), ["lockfile"]);
    writeFileSync(f.localState, f.bytes);
    assert.deepEqual(await pending, { kind: "ready" });
    assert.equal(readFileSync(f.localState, "utf8"), f.bytes);
    assert.equal(existsSync(path.join(f.appData, "recall-storage")), false);
  });

  test("existing recognized Local State is accepted immediately without replacement", async t => {
    const f = fixture(t); writeFileSync(f.localState, f.bytes);
    assert.deepEqual(await waitForInitialProfileRuntime(f.paths), { kind: "ready" });
    assert.equal(readFileSync(f.localState, "utf8"), f.bytes);
  });

  test("runtime barrier timeout is bounded and leaves a fresh site uninitialized", async t => {
    const f = fixture(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = waitForInitialProfileRuntime(f.paths);
    t.mock.timers.tick(20_000);
    assert.deepEqual(await pending, { kind: "unavailable", code: "storage_unavailable", reason: "initial_runtime_unavailable" });
    assert.deepEqual(readdirSync(f.profile), ["lockfile"]);
  });

  test("watch failure cannot fall through to candidate creation", async t => {
    const f = fixture(t);
    const mocked = t.mock.method(fs, "watch", () => { throw new Error("controlled watcher failure"); });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await waitForInitialProfileRuntime(f.paths), { kind: "unavailable", code: "storage_unavailable", reason: "initial_runtime_unavailable" });
      assert.deepEqual(readdirSync(f.profile), ["lockfile"]);
    } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  });

  test("asynchronous watcher errors close the barrier without authorizing", async t => {
    const f = fixture(t); const watcher = fs.watch(f.profile, () => {});
    const mocked = t.mock.method(fs, "watch", () => watcher); syncBuiltinESMExports();
    try {
      const pending = waitForInitialProfileRuntime(f.paths);
      watcher.emit("error", new Error("controlled asynchronous watcher error"));
      assert.deepEqual(await pending, { kind: "unavailable", code: "storage_unavailable", reason: "initial_runtime_unavailable" });
      assert.deepEqual(readdirSync(f.profile), ["lockfile"]);
    } finally { watcher.close(); mocked.mock.restore(); syncBuiltinESMExports(); }
  });

  for (const mutation of ["lock", "directory", "namespace", "unknown", "corrupt", "link"] as const)
    test(`runtime barrier rejects ${mutation} changes without publishing metadata`, async t => {
      const f = fixture(t);
      if (mutation === "directory") t.mock.timers.enable({ apis: ["setTimeout"] });
      const pending = waitForInitialProfileRuntime(f.paths);
      if (mutation === "lock") {
        renameSync(path.join(f.profile, "lockfile"), path.join(f.root, "old-lock"));
        writeFileSync(path.join(f.profile, "lockfile"), "");
      }
      if (mutation === "directory") { renameSync(f.profile, path.join(f.root, "old-profile")); mkdirSync(f.profile); }
      if (mutation === "namespace") mkdirSync(path.join(f.profile, ".recall-storage"));
      if (mutation === "unknown") writeFileSync(path.join(f.profile, "foreign"), "preserve");
      if (mutation === "link") {
        const other = path.join(f.root, "other"); mkdirSync(other); symlinkSync(other, f.localState, "junction");
      } else writeFileSync(f.localState, mutation === "corrupt" ? "{partial" : f.bytes);
      if (mutation === "directory") t.mock.timers.tick(20_000);
      assert.equal((await pending).kind, "unavailable");
      assert.equal(existsSync(path.join(f.profile, ".recall-storage/identity.json")), false);
      assert.equal(existsSync(path.join(f.appData, "recall-storage/bootstrap.json")), false);
      if (mutation === "unknown") assert.equal(readFileSync(path.join(f.profile, "foreign"), "utf8"), "preserve");
    });
}
