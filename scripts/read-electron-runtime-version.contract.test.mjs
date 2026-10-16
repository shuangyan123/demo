import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { inspect } from "node:util";
import { readElectronRuntimeVersions } from "./read-electron-runtime-version.mjs";

function interceptProbe(t, execute) {
  const stub = t.mock.method(childProcess, "execFileSync", execute);
  syncBuiltinESMExports();
  t.after(() => { stub.mock.restore(); syncBuiltinESMExports(); });
}

const secrets = Array.from({ length: 4 }, () => `fixture-${randomUUID()}`);
secrets.push(Buffer.from(`fixture:${secrets[0]}`).toString("base64"));
const sensitiveOutputs = [
  JSON.stringify({ token: secrets[0], nested: { password: secrets[1], token: secrets[2] } }),
  `Authorization: Basic ${secrets[4]}\nAuthorization: Bearer ${secrets[1]}`,
  secrets[3],
];

function assertNoSensitiveDiagnostics(error) {
  const printable = [error.message, error.stack, JSON.stringify(error.diagnostics), inspect(error, { depth: null })];
  for (const text of printable) {
    assert.ok(secrets.every(secret => !text.includes(secret)), "failure representation must not contain child secrets");
  }
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.deepEqual(Object.keys(error.diagnostics).sort(), [
    "code", "errorType", "launch", "output", "phase", "pid", "signal", "status", "windowsStatusHex",
  ].sort());
  assert.deepEqual(Object.keys(error.diagnostics.launch).sort(), [
    "probeDirectoryCanonical", "timeoutMs", "windowsHide", "parentNodeVersion", "nodeOptionsPresent", "electronRunAsNodeRemoved",
  ].sort());
  for (const metadata of Object.values(error.diagnostics.output)) {
    assert.deepEqual(Object.keys(metadata).sort(), ["bytes", "capped", "present"]);
  }
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
      assert.equal(error.diagnostics.output.stderr.present, true);
      assert.ok(error.diagnostics.output.stderr.bytes > 0);
      assertNoSensitiveDiagnostics(error);
      return true;
    });
  });

  test("real child stdout and stderr never escape into the wrapped failure", t => {
    const execute = childProcess.execFileSync;
    let probePath;
    const payload = sensitiveOutputs.join("\n");
    interceptProbe(t, (executable, args, options) => {
      probePath = args[0];
      writeFileSync(probePath, `process.stdout.write(${JSON.stringify(payload)}); process.stderr.write(${JSON.stringify(payload)}); process.exitCode = 7;`);
      return execute(executable, args, options);
    });
    assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
      assertNoSensitiveDiagnostics(error);
      assert.equal(error.diagnostics.status, 7);
      assert.equal(error.diagnostics.phase, "launch");
      assert.equal(error.diagnostics.output.stdout.bytes, Buffer.byteLength(payload));
      assert.equal(error.diagnostics.output.stderr.bytes, Buffer.byteLength(payload));
      return true;
    });
    assert.equal(existsSync(probePath), false);
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
      throw Object.assign(new Error(sensitiveOutputs.join("\n")), { status: failure.status, signal: failure.signal,
        code: failure.code, pid: 123, stdout: '{"electronVersion":"43.5.0","embeddedNodeVersion":"24.19.0"}',
        stderr: sensitiveOutputs.join("\n") });
    });
    assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
      assert.equal(error.diagnostics.status, failure.status);
      assert.equal(error.diagnostics.windowsStatusHex, failure.expectedHex);
      assert.equal(error.diagnostics.signal, failure.signal);
      assert.equal(error.diagnostics.code, failure.code ?? null);
      assert.equal(error.diagnostics.pid, 123);
      assert.equal(error.diagnostics.errorType, "child_process_failed");
      assert.equal(error.diagnostics.output.stdout.present, true);
      assert.equal(error.diagnostics.output.stderr.present, true);
      assertNoSensitiveDiagnostics(error);
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
        assert.equal(error.diagnostics.errorType, "invalid_readback");
        assert.equal(error.diagnostics.output.stdout.present, Boolean(output));
        assert.equal(error.diagnostics.output.stdout.bytes, Buffer.byteLength(output));
        assert.equal(error.diagnostics.status, 0);
        assertNoSensitiveDiagnostics(error);
        return true;
      });
    });

  for (const [index, payload] of [...sensitiveOutputs, sensitiveOutputs.join("\n")].entries()) {
    test(`all launch error channels reject sensitive payload variant ${index + 1}`, t => {
      interceptProbe(t, () => {
        throw Object.assign(new Error(payload), {
          status: -1073741819, signal: "SIGTERM", code: "ETIMEDOUT", pid: 321,
          stdout: Buffer.from(payload), stderr: payload, name: payload, stack: payload,
          cause: { credentials: payload }, extra: payload,
        });
      });
      assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
        assertNoSensitiveDiagnostics(error);
        assert.equal(error.diagnostics.status, -1073741819);
        assert.equal(error.diagnostics.windowsStatusHex, "0xc0000005");
        assert.equal(error.diagnostics.signal, "SIGTERM");
        assert.equal(error.diagnostics.code, "ETIMEDOUT");
        assert.equal(error.diagnostics.phase, "launch");
        assert.equal(error.diagnostics.pid, 321);
        assert.deepEqual(error.diagnostics.output.stdout, { present: true, bytes: Buffer.byteLength(payload), capped: false });
        return true;
      });
    });
  }

  for (const [index, output] of sensitiveOutputs.entries()) {
    test(`decode failure discards sensitive output variant ${index + 1}`, t => {
      interceptProbe(t, () => output);
      assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
        assertNoSensitiveDiagnostics(error);
        assert.equal(error.diagnostics.phase, "decode");
        assert.equal(error.diagnostics.status, 0);
        assert.equal(error.diagnostics.output.stdout.present, true);
        return true;
      });
    });
  }

  test("untrusted metadata is neither copied nor coerced into diagnostics", t => {
    const payload = sensitiveOutputs.join("\n");
    interceptProbe(t, () => {
      throw { status: payload, signal: payload, code: payload, pid: payload, message: payload,
        stdout: { toString() { throw new Error(payload); } }, stderr: payload };
    });
    assert.throws(() => readElectronRuntimeVersions({ executablePath: payload }), error => {
      assertNoSensitiveDiagnostics(error);
      for (const key of ["status", "windowsStatusHex", "signal", "code", "pid"]) assert.equal(error.diagnostics[key], null);
      assert.deepEqual(error.diagnostics.output.stdout, { present: false, bytes: 0, capped: false });
      assert.equal(error.diagnostics.phase, "launch");
      return true;
    });
  });

  test("diagnostic lengths are bounded and malformed numeric metadata is rejected", t => {
    interceptProbe(t, () => {
      throw Object.assign(new Error(secrets[3]), {
        status: Infinity, signal: "SIGTERM-extra", code: "ENOENT-extra", pid: -1,
        stdout: secrets[3].repeat(50_000), stderr: Buffer.alloc(0),
      });
    });
    assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
      assertNoSensitiveDiagnostics(error);
      assert.deepEqual(error.diagnostics.output.stdout, { present: true, bytes: 1_048_576, capped: true });
      assert.deepEqual(error.diagnostics.output.stderr, { present: false, bytes: 0, capped: false });
      for (const key of ["status", "windowsStatusHex", "signal", "code", "pid"]) assert.equal(error.diagnostics[key], null);
      return true;
    });
  });

  test("error getters cannot run while collecting safe metadata", t => {
    interceptProbe(t, () => {
      const error = new Error(secrets[3]);
      for (const key of ["status", "signal", "code", "pid", "stdout", "stderr"]) {
        Object.defineProperty(error, key, { get() { throw new Error(secrets[3]); } });
      }
      throw error;
    });
    assert.throws(() => readElectronRuntimeVersions({ executablePath: process.execPath }), error => {
      assertNoSensitiveDiagnostics(error);
      assert.equal(error.diagnostics.phase, "launch");
      assert.equal(error.diagnostics.status, null);
      assert.equal(error.diagnostics.output.stdout.present, false);
      return true;
    });
  });
} else {
  test("Electron native probe remains unavailable outside Windows", () => {
    assert.throws(() => readElectronRuntimeVersions(), /requires a Windows runner/);
  });
}
