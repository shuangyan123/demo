import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const asar = createRequire(import.meta.url)("@electron/asar");
const packagedArtifactRequired = process.env.DESKTOP_ARTIFACT_REQUIRED === "1";
const expectedBridgeNames = [
  "reviewDesktopCredentialProtection",
  "reviewDesktopVault",
  "reviewDesktopWindow",
  "reviewFenbiSession",
].sort();

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inspectSandboxPreload(label, artifactPath, expectedHash) {
  assert.ok(existsSync(artifactPath), `${label} preload artifact is missing: ${artifactPath}`);
  const content = readFileSync(artifactPath, "utf8");
  assert.doesNotMatch(content, /(?:^|[\r\n])\s*(?:import|export)\b/, `${label} must not be an ESM preload`);
  assert.match(content, /require\(["']electron["']\)/, `${label} must load Electron through sandbox-compatible require`);
  assert.doesNotMatch(content, /require\(["'][./]/, `${label} must not depend on runtime local modules`);

  const bridgeNames = [...content.matchAll(/exposeInMainWorld\(["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(bridgeNames, expectedBridgeNames, `${label} exposes an unexpected bridge surface`);
  assert.equal(hash(content), expectedHash, `${label} differs from the compiled preload artifact`);
  return content;
}

test("sandbox preload artifact is CommonJS at the configured BrowserWindow path", () => {
  const compiledMainPath = resolve(workspaceRoot, ".desktop", "main.js");
  const compiledPreloadPath = resolve(workspaceRoot, ".desktop", "preload.cjs");
  const compiledMain = readFileSync(compiledMainPath, "utf8");
  inspectSandboxPreload(
    "compiled",
    compiledPreloadPath,
    hash(readFileSync(compiledPreloadPath)),
  );

  assert.match(compiledMain, /path\.join\(import\.meta\.dirname, ["']preload\.cjs["']\)/);
  assert.doesNotMatch(compiledMain, /preload\.js/);
});

test("desktop preparation and packaging retain the same sandbox preload when artifacts exist", () => {
  const compiledPreloadPath = resolve(workspaceRoot, ".desktop", "preload.cjs");
  const compiledPreload = readFileSync(compiledPreloadPath);
  const expectedHash = hash(compiledPreload);
  const stagingPreloadPath = resolve(workspaceRoot, ".desktop-app", ".desktop", "preload.cjs");
  const stagingOldPreloadPath = resolve(workspaceRoot, ".desktop-app", ".desktop", "preload.js");
  const asarPath = resolve(workspaceRoot, "out", "review-workspace-win32-x64", "resources", "app.asar");

  if (packagedArtifactRequired) {
    assert.ok(existsSync(stagingPreloadPath), "prepared desktop host is missing preload.cjs");
    assert.ok(existsSync(asarPath), "packaged desktop app is missing app.asar");
  }

  if (existsSync(stagingPreloadPath)) {
    inspectSandboxPreload("staging", stagingPreloadPath, expectedHash);
    assert.equal(existsSync(stagingOldPreloadPath), false, "staging retained the incompatible preload.js");
  }

  if (existsSync(asarPath)) {
    const files = asar.listPackage(asarPath)
      .map((file) => file.replaceAll("\\", "/").replace(/^\/+/, ""));
    assert.ok(files.includes(".desktop/preload.cjs"), "app.asar is missing the configured preload.cjs");
    assert.equal(files.includes(".desktop/preload.js"), false, "app.asar retained the incompatible preload.js");
    const packagedPreload = asar.extractFile(asarPath, ".desktop/preload.cjs");
    assert.equal(hash(packagedPreload), expectedHash, "app.asar preload differs from the compiled artifact");
  }
});
