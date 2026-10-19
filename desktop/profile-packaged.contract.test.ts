import assert from "node:assert/strict";
import { spawn, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import test from "node:test";
import { createPackageWithOptions, extractFile, getRawHeader } from "@electron/asar";
import { getCurrentFuseWire, FuseState, FuseV1Options } from "@electron/fuses";

const require = createRequire(import.meta.url);

function runFixtureProcess(command: string, args: string[], options: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: "ignore", ...options });
    child.once("error", () => reject(new Error("Owned packaged fixture process could not start")));
    // 关闭进程资源后再清理映像；同步启动器返回不作为 Windows 句柄关闭的替代证据。
    child.once("close", code => code === 0 ? resolve() : reject(new Error("Owned packaged fixture process did not exit successfully")));
  });
}

if (process.platform === "win32") test("ASAR production Main with NSIS fuses and acceptance CDP flags reaches real native consent without admitting history", async t => {
  const root = mkdtempSync(path.join(realpathSync.native(os.tmpdir()), "recall-packaged-profile-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), realpathSync.native(os.tmpdir())); assert.match(path.basename(root), /^recall-packaged-profile-test-/);
    await rm(root, { recursive: true, force: true, maxRetries: 0 });
  });
  const binary = path.join(root, "binary"); const source = path.join(root, "source");
  mkdirSync(binary); mkdirSync(source); mkdirSync(path.join(binary, "resources"));
  const electron = path.resolve("node_modules/electron/dist");
  assert.equal(readFileSync(path.join(electron, "version"), "utf8").trim(), "43.5.0");
  for (const entry of readdirSync(electron)) if (entry !== "resources") cpSync(path.join(electron, entry), path.join(binary, entry), { recursive: true });
  const executable = path.join(binary, "review-workspace.exe"); renameSync(path.join(binary, "electron.exe"), executable);
  cpSync(path.resolve(".desktop"), path.join(source, ".desktop"), { recursive: true });
  cpSync(path.resolve("test-support/profile-packaged-entry.cjs"), path.join(source, ".desktop/profile-packaged-entry.cjs"));
  cpSync(path.resolve("test-support/click-native-dialog.ps1"), path.join(root, "click-native-dialog.ps1"));
  writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "review-workspace", productName: "错题复盘", version: "0.3.1", type: "module", main: ".desktop/profile-packaged-entry.cjs" }));
  const archive = path.join(binary, "resources", "app.asar");
  const archiveStream = await createPackageWithOptions(source, archive, { dot: true });
  // ASAR API 在 end() 后就返回；必须等流关闭，才能读取、启动和最终清理该产物。
  await finished(archiveStream);
  assert.deepEqual(extractFile(archive, ".desktop/main.js"), readFileSync(path.resolve(".desktop/main.js")));
  // 与 NSIS 共用完整 fuse 配置和 PE ASAR integrity 写入器；不降低测试程序的安全基线。
  await require("../electron-builder.nsis.cjs").afterPack({ electronPlatformName: "win32", appOutDir: binary });
  const wire = await getCurrentFuseWire(executable);
  assert.equal(wire[FuseV1Options.OnlyLoadAppFromAsar], FuseState.ENABLE);
  assert.equal(wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], FuseState.ENABLE);
  const payload = path.join(root, "integrity.json");
  writeFileSync(payload, JSON.stringify([{ file: "resources\\app.asar", alg: "SHA256", value: createHash("sha256").update(getRawHeader(archive).headerString).digest("hex") }]));
  await runFixtureProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.resolve("scripts/embed-electron-asar-integrity.ps1"), "-ExecutablePath", executable, "-IntegrityPayloadPath", payload], { timeout: 15000 });
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const port = address.port; await new Promise<void>(resolve => server.close(() => resolve()));
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const log = openSync(path.join(root, "packaged-process.log"), "w");
  try {
    await runFixtureProcess(executable, [`--recall-owned-test-root=${root}`, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, "--force-renderer-accessibility"],
      { stdio: ["ignore", log, log], env: environment, timeout: 25000 });
    await runFixtureProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.resolve("test-support/wait-owned-electron.ps1"), "-OwnedRoot", root],
      { timeout: 15000 });
  } catch { throw new Error("Owned packaged startup fixture failed; raw paths and CDP endpoints withheld"); }
  finally { closeSync(log); }
  const observed = JSON.parse(readFileSync(path.join(root, "observation.json"), "utf8"));
  t.diagnostic(JSON.stringify(observed));
  assert.equal(observed.packaged, true); assert.equal(observed.debugRecordMatchesLiveEndpoint, true);
  assert.equal(observed.promptObserved, true); assert.equal(observed.cancelled, true);
  assert.equal(observed.failure, undefined); assert.equal(observed.rejection, "none");
  assert.equal(existsSync(path.join(root, "appData", "recall-storage")), false);
  assert.equal(existsSync(path.join(root, "appData", "profile", ".recall-storage")), false);
});
