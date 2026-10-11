import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const artifactRequired = process.env.DESKTOP_BUILDER_M0_ARTIFACT_REQUIRED === "1";
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const { FuseState, FuseV1Options, getCurrentFuseWire } = require("@electron/fuses");
const artifactRoot = resolve(workspaceRoot, "out", "builder-m0", "win-unpacked");
const executablePath = join(artifactRoot, "review-workspace.exe");
const resourcesRoot = join(artifactRoot, "resources");
const asarPath = join(resourcesRoot, "app.asar");
const runtimeRoot = join(resourcesRoot, ".desktop-runtime");
const installerPath = resolve(workspaceRoot, "out", "builder-m0", "ReviewWorkspace-0.2.4-NSIS-M0-POC.exe");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function readPowerShellJson(scriptName) {
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve(workspaceRoot, "scripts", scriptName), "-ExecutablePath", executablePath],
    { encoding: "utf8" },
  ).trim();
  return JSON.parse(output);
}

function readEmbeddedIntegrity() {
  return readPowerShellJson("read-electron-asar-integrity.ps1");
}

async function verifyRuntimeManifest() {
  const manifest = JSON.parse(readFileSync(join(runtimeRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.algorithm, "sha256");
  assert.equal(manifest.nodeVersion, "22.23.1");
  assert.ok(Object.keys(manifest.files).length > 0);
  assert.ok(manifest.files["node/node.exe"]);
  assert.ok(manifest.files["app/server.js"]);

  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const normalized = relativePath.replaceAll("/", "\\");
    const absolutePath = resolve(runtimeRoot, normalized);
    assert.ok(absolutePath.startsWith(`${runtimeRoot}${require("node:path").sep}`), `manifest path escapes runtime: ${relativePath}`);
    assert.equal(statSync(absolutePath).isFile(), true, `runtime file missing: ${relativePath}`);
    assert.equal(sha256File(absolutePath), expectedHash, `runtime hash mismatch: ${relativePath}`);
  }

  const nodeVersion = execFileSync(join(runtimeRoot, "node", "node.exe"), ["--version"], { encoding: "utf8" }).trim();
  assert.equal(nodeVersion, "v22.23.1");
}

test("M0 unpacked artifact preserves app.asar, runtime, preload, identity, and security readback", async (t) => {
  if (!artifactRequired) {
    t.skip("set DESKTOP_BUILDER_M0_ARTIFACT_REQUIRED=1 after building the M0 artifact");
    return;
  }

  assert.equal(process.platform, "win32", "M0 artifact readback requires Windows");
  assert.ok(existsSync(executablePath), `missing M0 executable: ${executablePath}`);
  assert.ok(existsSync(asarPath), `missing M0 app.asar: ${asarPath}`);
  assert.ok(existsSync(runtimeRoot), `missing M0 runtime: ${runtimeRoot}`);

  const executableInfo = readPowerShellJson("read-windows-executable-info.ps1");
  assert.match(executableInfo.FileVersion, /0\.2\.4/);
  assert.match(executableInfo.ProductVersion, /0\.2\.4/);
  assert.equal(executableInfo.ProductName, "错题复盘");
  assert.equal(executableInfo.FileDescription, "错题复盘");
  assert.equal(executableInfo.InternalName, "review-workspace");
  assert.equal(readFileSync(join(artifactRoot, "version"), "utf8").trim(), "43.5.0");

  const files = asar.listPackage(asarPath).map((file) => file.replaceAll("\\", "/").replace(/^\/+/, ""));
  assert.ok(files.includes(".desktop/main.js"));
  assert.ok(files.includes(".desktop/preload.cjs"));
  assert.ok(files.includes("package.json"));
  assert.equal(files.some((file) => file.includes("node_modules/")), false, "app.asar contains an unexpected node_modules tree");
  assert.equal(files.some((file) => file.startsWith(".desktop-runtime/")), false, "runtime was duplicated inside app.asar");

  const appMetadata = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
  assert.equal(appMetadata.name, "review-workspace");
  assert.equal(appMetadata.productName, "错题复盘");
  assert.equal(appMetadata.version, "0.2.4");

  const compiledPreload = readFileSync(resolve(workspaceRoot, ".desktop", "preload.cjs"));
  const packagedPreload = asar.extractFile(asarPath, ".desktop/preload.cjs");
  assert.equal(sha256(packagedPreload), sha256(compiledPreload));
  assert.equal(existsSync(join(artifactRoot, "resources", "app")), false, "OnlyLoadAppFromAsar contract cannot be proven with an unpacked app directory present");

  const resourceEntries = readdirSync(resourcesRoot);
  assert.ok(resourceEntries.includes("app.asar"));
  assert.ok(resourceEntries.includes(".desktop-runtime"));
  assert.equal(resourceEntries.filter((entry) => entry === ".desktop-runtime").length, 1);
  await verifyRuntimeManifest();

  const fuseWire = await getCurrentFuseWire(executablePath);
  assert.equal(fuseWire.version, "1");
  const expectedFuses = {
    [FuseV1Options.RunAsNode]: FuseState.DISABLE,
    [FuseV1Options.EnableCookieEncryption]: FuseState.ENABLE,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
    [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
    [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: FuseState.DISABLE,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: FuseState.DISABLE,
    [FuseV1Options.WasmTrapHandlers]: FuseState.ENABLE,
  };
  for (const [fuse, expected] of Object.entries(expectedFuses)) {
    assert.equal(fuseWire[fuse], expected, `fuse ${fuse} differs from the required security contract`);
  }

  const expectedIntegrityHash = sha256(require("@electron/asar").getRawHeader(asarPath).headerString);
  const integrity = readEmbeddedIntegrity();
  const appIntegrity = integrity.find((entry) => entry.file === "resources\\app.asar");
  assert.deepEqual(appIntegrity, {
    file: "resources\\app.asar",
    alg: "SHA256",
    value: expectedIntegrityHash,
  });
  assert.ok(integrity.every((entry) => ["resources\\app.asar", "resources\\default_app.asar"].includes(entry.file)));

  assert.ok(existsSync(installerPath), `missing M0 NSIS installer: ${installerPath}`);
  assert.equal(existsSync(`${installerPath}.blockmap`), false);
  assert.equal(existsSync(resolve(workspaceRoot, "out", "builder-m0", "latest.yml")), false);
});
