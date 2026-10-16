import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { readElectronRuntimeVersions } from "./read-electron-runtime-version.mjs";

function interceptProbe(t, execute) {
  const stub = t.mock.method(childProcess, "execFileSync", execute);
  syncBuiltinESMExports();
  t.after(() => { stub.mock.restore(); syncBuiltinESMExports(); });
}

if (process.platform === "win32") {
  test("real Electron main process readback matches the locked runtime", () => {
    const expected = JSON.parse(readFileSync("package.json", "utf8")).devDependencies.electron;
    const result = readElectronRuntimeVersions();
    assert.equal(result.electronVersion, expected);
    assert.match(result.embeddedNodeVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(result.method, "Electron main process process.versions");
    assert.equal(result.pass, true);
  });

  test("a real non-Electron child failure retains exit diagnostics and fails closed", () => {
    assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
      assert.equal(error.diagnostics.phase, "launch");
      assert.notEqual(error.diagnostics.status, 0);
      assert.ok(error.diagnostics.pid > 0);
      assert.ok(error.diagnostics.stderr.length > 0);
      assert.equal(existsSync(error.diagnostics.launch.probePath), false);
      return true;
    });
  });

  for (const failure of [
    { status: 3221225477, signal: null, code: undefined, expectedHex: "0xc0000005" },
    { status: null, signal: "SIGTERM", code: "ETIMEDOUT", expectedHex: null },
    { status: null, signal: null, code: "ENOENT", expectedHex: null },
  ]) test(`probe diagnostics preserve ${failure.code ?? failure.expectedHex} without accepting output`, t => {
    let probePath;
    interceptProbe(t, (_executable, args, options) => {
      probePath = args[0];
      assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
      assert.equal(options.timeout, 30_000);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      const source = readFileSync(probePath, "utf8");
      assert.match(source, /app\.whenReady\(\)/);
      assert.match(source, /process\.versions\.electron/);
      assert.match(source, /process\.versions\.node/);
      throw Object.assign(new Error("fixture child failure"), { status: failure.status, signal: failure.signal,
        code: failure.code, pid: 123, stdout: '{"electronVersion":"43.5.0","embeddedNodeVersion":"24.19.0"}',
        stderr: "fixture startup failure; token=fixture-secret Bearer fixture-secret" });
    });
    assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
      assert.equal(error.diagnostics.status, failure.status);
      assert.equal(error.diagnostics.windowsStatusHex, failure.expectedHex);
      assert.equal(error.diagnostics.signal, failure.signal);
      assert.equal(error.diagnostics.code, failure.code ?? null);
      assert.equal(error.diagnostics.pid, 123);
      assert.match(error.diagnostics.stdout, /electronVersion/);
      assert.match(error.diagnostics.stderr, /fixture startup failure/);
      assert.doesNotMatch(error.message, /fixture-secret/);
      assert.equal(error.diagnostics.launch.electronRunAsNodeRemoved, true);
      return true;
    });
    assert.equal(existsSync(probePath), false);
  });

  for (const output of ["", "not-json", '{"electronVersion":"43.5.0"}'])
    test(`invalid successful probe output still fails closed: ${output || "empty"}`, t => {
      interceptProbe(t, () => output);
      assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
        assert.equal(error.diagnostics.phase, "decode");
        assert.equal(error.diagnostics.stdout, output);
        assert.equal(error.diagnostics.status, null);
        return true;
      });
    });
} else {
  test("Electron native probe remains unavailable outside Windows", () => {
    assert.throws(() => readElectronRuntimeVersions(), /requires a Windows runner/);
  });
}
