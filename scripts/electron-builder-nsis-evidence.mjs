import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(workspaceRoot, "out", "builder-nsis");
const artifactRoot = path.join(outputRoot, "win-unpacked");
const executablePath = path.join(artifactRoot, "review-workspace.exe");
const resourcesRoot = path.join(artifactRoot, "resources");
const asarPath = path.join(resourcesRoot, "app.asar");
const runtimeRoot = path.join(resourcesRoot, ".desktop-runtime");
const packageJson = readJson(path.join(workspaceRoot, "package.json"));
const installerPath = path.join(outputRoot, `ReviewWorkspace-${packageJson.version}-Windows-x64-Setup.exe`);
const recallWindowsIconPath = path.join(workspaceRoot, "public", "brand", "recall", "app", "recall.ico");
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const { FuseState, FuseV1Options, getCurrentFuseWire } = require("@electron/fuses");

const expectedFuses = [
  ["RunAsNode", FuseV1Options.RunAsNode, FuseState.DISABLE],
  ["EnableCookieEncryption", FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  ["EnableNodeOptionsEnvironmentVariable", FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  ["EnableNodeCliInspectArguments", FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  ["EnableEmbeddedAsarIntegrityValidation", FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  ["OnlyLoadAppFromAsar", FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  ["LoadBrowserProcessSpecificV8Snapshot", FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  ["GrantFileProtocolExtraPrivileges", FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
  ["WasmTrapHandlers", FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
];

export function getNsisProductionPaths() {
  return {
    outputRoot,
    artifactRoot,
    executablePath,
    resourcesRoot,
    asarPath,
    runtimeRoot,
    installerPath,
  };
}

export async function collectNsisProductionEvidence() {
  if (process.platform !== "win32") {
    throw new Error("Production NSIS artifact readback requires a Windows runner");
  }

  const sourceCommit = resolveSourceCommit();
  assertEqual(packageJson.name, "review-workspace", "package name");
  assertEqual(packageJson.productName, "错题复盘", "product name");
  assertEqual(packageJson.version, "0.2.4", "package version");
  assertEqual(packageJson.devDependencies["electron-builder"], "26.16.0", "electron-builder version");

  requireFile(executablePath, "unpacked executable");
  requireFile(asarPath, "app.asar");
  requireFile(path.join(artifactRoot, "version"), "Electron version marker");
  requireFile(runtimeRoot, "bundled desktop runtime");
  requireFile(installerPath, "production NSIS installer");
  requireFile(recallWindowsIconPath, "approved Recall Windows ICO");

  const executableInfo = readPowerShellJson("read-windows-executable-info.ps1");
  assertEqual(executableInfo.ProductName, "错题复盘", "PE ProductName");
  assertEqual(executableInfo.FileDescription, "错题复盘", "PE FileDescription");
  assertEqual(executableInfo.InternalName, "review-workspace", "PE InternalName");
  assertMatch(executableInfo.FileVersion, /^0\.2\.4(?:\.0)?$/, "PE FileVersion");
  assertMatch(executableInfo.ProductVersion, /^0\.2\.4(?:\.0)?$/, "PE ProductVersion");
  assertEqual(readFileSync(path.join(artifactRoot, "version"), "utf8").trim(), "43.4.1", "packaged Electron version");

  const packageFiles = asar.listPackage(asarPath)
    .map((file) => file.replaceAll("\\", "/").replace(/^\/+/, ""));
  assert(packageFiles.includes(".desktop/main.js"), "app.asar is missing .desktop/main.js");
  assert(packageFiles.includes(".desktop/preload.cjs"), "app.asar is missing .desktop/preload.cjs");
  assert(packageFiles.includes("package.json"), "app.asar is missing package.json");
  assert(!packageFiles.some((file) => file.split("/").includes("node_modules")), "app.asar contains a node_modules tree");
  assert(!packageFiles.some((file) => file.startsWith(".desktop-runtime/")), "app.asar contains a duplicate .desktop-runtime");

  const appMetadata = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
  assertEqual(appMetadata.name, "review-workspace", "packaged app name");
  assertEqual(appMetadata.productName, "错题复盘", "packaged product name");
  assertEqual(appMetadata.version, "0.2.4", "packaged app version");

  const compiledPreload = readFileSync(path.join(workspaceRoot, ".desktop", "preload.cjs"));
  const packagedPreload = asar.extractFile(asarPath, ".desktop/preload.cjs");
  const preload = {
    compiledSha256: sha256(compiledPreload),
    packagedSha256: sha256(packagedPreload),
    pass: sha256(compiledPreload) === sha256(packagedPreload),
  };
  assert(preload.pass, "packaged preload hash differs from compiled preload hash");
  assert(!existsSync(path.join(artifactRoot, "resources", "app")), "resources/app unpacked application tree is present");
  const rootNodeModulesPresent = existsSync(path.join(artifactRoot, "node_modules"))
    || existsSync(path.join(resourcesRoot, "node_modules"));
  assert(!rootNodeModulesPresent, "unpacked production artifact contains a root node_modules tree");

  const resourceEntries = readdirSync(resourcesRoot);
  assert(resourceEntries.includes("app.asar"), "resources/app.asar is missing");
  assert(resourceEntries.includes(".desktop-runtime"), "resources/.desktop-runtime is missing");
  assert(resourceEntries.filter((entry) => entry === ".desktop-runtime").length === 1, "resources/.desktop-runtime is duplicated");

  const runtime = await verifyRuntime();
  const asarSha256 = sha256File(asarPath);
  const asarRawHeaderSha256 = sha256(asar.getRawHeader(asarPath).headerString);

  const integrityEntries = readPowerShellJson("read-electron-asar-integrity.ps1");
  const appIntegrity = integrityEntries.find((entry) => entry.file === "resources\\app.asar");
  const integrity = {
    expected: asarRawHeaderSha256,
    actual: appIntegrity?.value ?? null,
    pass: appIntegrity?.alg === "SHA256"
      && appIntegrity.value === asarRawHeaderSha256
      && integrityEntries.every((entry) => ["resources\\app.asar", "resources\\default_app.asar"].includes(entry.file)),
  };
  assert(integrity.pass, "PE INTEGRITY/ELECTRONASAR does not match the current app.asar raw header");

  const fuseWire = await getCurrentFuseWire(executablePath);
  const actualFuses = Object.fromEntries(expectedFuses.map(([name, key]) => [name, fuseStateName(fuseWire[key])]));
  const fuses = {
    version: String(fuseWire.version),
    actual: actualFuses,
    wire: Object.fromEntries(expectedFuses.map(([name, key]) => [name, fuseWire[key]])),
    pass: fuseWire.version === "1" && expectedFuses.every(([, key, expected]) => fuseWire[key] === expected),
  };
  assert(fuses.pass, "actual Electron V1 fuse wire differs from the strict production contract");

  const outputFiles = listFiles(outputRoot);
  const updaterMetadata = {
    blockmapPresent: outputFiles.some((file) => file.toLowerCase().endsWith(".blockmap")),
    latestYmlPresent: outputFiles.some((file) => path.basename(file).toLowerCase() === "latest.yml"),
  };
  assert(!updaterMetadata.blockmapPresent, "production output contains .blockmap updater metadata");
  assert(!updaterMetadata.latestYmlPresent, "production output contains latest.yml updater metadata");

  const installer = {
    filename: path.basename(installerPath),
    byteSize: statSync(installerPath).size,
    sha256: sha256File(installerPath),
  };

  return {
    schemaVersion: 1,
    sourceCommit,
    packageVersion: packageJson.version,
    productName: packageJson.productName,
    packageName: packageJson.name,
    electronVersion: "43.4.1",
    electronBuilderVersion: packageJson.devDependencies["electron-builder"],
    target: "nsis",
    architecture: "x64",
    appId: "com.squirrel.review_workspace.review-workspace",
    installerFilename: installer.filename,
    installerByteSize: installer.byteSize,
    installerSha256: installer.sha256,
    unpackedExecutablePath: relativePath(executablePath),
    executableFileVersion: executableInfo.FileVersion,
    executableProductVersion: executableInfo.ProductVersion,
    asarSha256,
    asarRawHeaderSha256,
    embeddedAsarIntegrity: integrity,
    appAsar: {
      path: relativePath(asarPath),
      pass: true,
      fileCount: packageFiles.length,
      nodeModulesPresent: false,
      rootNodeModulesPresent,
      duplicateRuntimePresent: false,
      unpackedResourcesAppPresent: false,
    },
    runtime: {
      nodeVersion: runtime.nodeVersion,
      manifestNodeVersion: runtime.manifestNodeVersion,
      manifestFileCount: runtime.manifestFileCount,
      manifestPass: runtime.manifestPass,
      path: relativePath(runtimeRoot),
    },
    preload,
    fuses,
    strictlyRequireAllFuses: true,
    updaterMetadata,
    applicationIdentity: {
      pass: true,
      packageName: appMetadata.name,
      productName: appMetadata.productName,
      version: appMetadata.version,
      executableName: "review-workspace",
      shortcutName: "错题复盘",
      uninstallDisplayName: "错题复盘",
    },
    perUserInstallerIntent: {
      perMachine: false,
      selectPerMachineByDefault: false,
      pass: true,
    },
    installTimeWebPayload: "ABSENT",
    signing: "INTENTIONALLY UNSIGNED",
    icon: {
      path: relativePath(recallWindowsIconPath),
      sha256: sha256File(recallWindowsIconPath),
    },
    ci: process.env.GITHUB_ACTIONS === "true"
      ? {
        runId: process.env.GITHUB_RUN_ID ?? null,
        jobName: process.env.GITHUB_JOB ?? null,
        exactHeadSha: sourceCommit,
      }
      : null,
  };
}

export function assertNsisProductionEvidence(evidence) {
  assertEqual(evidence.schemaVersion, 1, "evidence schema version");
  assertEqual(evidence.packageVersion, "0.2.4", "evidence package version");
  assertEqual(evidence.productName, "错题复盘", "evidence product name");
  assertEqual(evidence.packageName, "review-workspace", "evidence package name");
  assertEqual(evidence.electronVersion, "43.4.1", "evidence Electron version");
  assertEqual(evidence.electronBuilderVersion, "26.16.0", "evidence electron-builder version");
  assertEqual(evidence.target, "nsis", "evidence target");
  assertEqual(evidence.architecture, "x64", "evidence architecture");
  assertEqual(evidence.appId, "com.squirrel.review_workspace.review-workspace", "evidence appId");
  assertEqual(evidence.installerFilename, "ReviewWorkspace-0.2.4-Windows-x64-Setup.exe", "evidence installer filename");
  assert(typeof evidence.sourceCommit === "string" && /^[0-9a-f]{40}$/.test(evidence.sourceCommit), "evidence sourceCommit must be a full Git SHA");
  assert(evidence.installerByteSize > 0, "evidence installer byte size must be positive");
  assertMatch(evidence.installerSha256, /^[0-9a-f]{64}$/, "evidence installer SHA-256");
  assert(evidence.embeddedAsarIntegrity?.pass === true, "evidence embedded ASAR integrity must pass");
  assertMatch(evidence.asarSha256, /^[0-9a-f]{64}$/, "evidence app.asar SHA-256");
  assertMatch(evidence.asarRawHeaderSha256, /^[0-9a-f]{64}$/, "evidence raw ASAR header SHA-256");
  assertEqual(evidence.embeddedAsarIntegrity.expected, evidence.asarRawHeaderSha256, "evidence integrity expected hash");
  assertEqual(evidence.embeddedAsarIntegrity.actual, evidence.asarRawHeaderSha256, "evidence integrity actual hash");
  assert(evidence.appAsar?.fileCount > 0, "evidence app.asar file count must be positive");
  assert(evidence.appAsar?.nodeModulesPresent === false, "evidence app.asar node_modules flag");
  assert(evidence.appAsar?.rootNodeModulesPresent === false, "evidence root node_modules flag");
  assert(evidence.appAsar?.duplicateRuntimePresent === false, "evidence duplicate runtime flag");
  assert(evidence.appAsar?.unpackedResourcesAppPresent === false, "evidence unpacked resources/app flag");
  assert(evidence.runtime?.manifestPass === true, "evidence runtime manifest must pass");
  assert(evidence.runtime?.nodeVersion === "v24.20.0", "evidence bundled Node must be v24.20.0");
  assert(evidence.runtime?.manifestNodeVersion === "24.20.0", "evidence runtime manifest Node must be 24.20.0");
  assert(evidence.runtime?.manifestFileCount > 0, "evidence runtime manifest file count must be positive");
  assert(evidence.preload?.pass === true, "evidence preload hash must pass");
  assertMatch(evidence.preload?.compiledSha256, /^[0-9a-f]{64}$/, "evidence compiled preload SHA-256");
  assertEqual(evidence.preload.packagedSha256, evidence.preload.compiledSha256, "evidence packaged preload SHA-256");
  assert(evidence.fuses?.pass === true, "evidence fuses must pass");
  for (const [name, , expected] of expectedFuses) {
    assertEqual(evidence.fuses.actual?.[name], fuseStateName(expected), `evidence fuse ${name}`);
  }
  assert(evidence.strictlyRequireAllFuses === true, "evidence must preserve strictlyRequireAllFuses=true");
  assert(evidence.updaterMetadata?.blockmapPresent === false, "evidence must not contain a blockmap");
  assert(evidence.updaterMetadata?.latestYmlPresent === false, "evidence must not contain latest.yml");
  assert(evidence.applicationIdentity?.pass === true, "evidence application identity must pass");
  assertEqual(evidence.applicationIdentity.shortcutName, "错题复盘", "evidence shortcut name");
  assertEqual(evidence.applicationIdentity.uninstallDisplayName, "错题复盘", "evidence uninstall display name");
  assertEqual(evidence.icon?.path, "public/brand/recall/app/recall.ico", "evidence Windows icon path");
  assertMatch(evidence.icon?.sha256, /^[0-9a-f]{64}$/, "evidence Windows icon SHA-256");
  assert(evidence.perUserInstallerIntent?.pass === true, "evidence per-user intent must pass");
  assert(evidence.perUserInstallerIntent.perMachine === false, "evidence perMachine intent");
  assert(evidence.perUserInstallerIntent.selectPerMachineByDefault === false, "evidence per-machine selection intent");
  assertEqual(evidence.installTimeWebPayload, "ABSENT", "evidence install-time web payload");
  assertEqual(evidence.signing, "INTENTIONALLY UNSIGNED", "evidence signing state");
}

function resolveSourceCommit() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8", windowsHide: true }).trim().toLowerCase();
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: workspaceRoot, encoding: "utf8", windowsHide: true }).trim();
  if (status) throw new Error("Cannot bind production evidence to an ambiguous dirty worktree");
  const configured = process.env.NSIS_SOURCE_COMMIT
    ?? (process.env.GITHUB_ACTIONS === "true" ? process.env.GITHUB_SHA : undefined);
  if (configured !== undefined && !/^[0-9a-f]{40}$/i.test(configured)) {
    throw new Error("NSIS_SOURCE_COMMIT/GITHUB_SHA must be a full Git SHA");
  }
  if (configured !== undefined && configured.toLowerCase() !== head) {
    throw new Error(`NSIS source commit ${configured} does not match checked-out HEAD ${head}`);
  }
  return (configured ?? head).toLowerCase();
}

async function verifyRuntime() {
  const manifest = readJson(path.join(runtimeRoot, "manifest.json"));
  assertEqual(manifest.algorithm, "sha256", "runtime manifest algorithm");
  assertEqual(manifest.nodeVersion, "24.20.0", "runtime manifest Node version");
  assert(manifest.files && typeof manifest.files === "object", "runtime manifest files are missing");
  assert(manifest.files["node/node.exe"], "runtime manifest is missing node/node.exe");
  assert(manifest.files["app/server.js"], "runtime manifest is missing app/server.js");
  requireFile(path.join(runtimeRoot, "node", "node.exe"), "bundled Node executable");
  requireFile(path.join(runtimeRoot, "app", "server.js"), "runtime server");

  for (const [relative, expectedHash] of Object.entries(manifest.files)) {
    const normalized = relative.replaceAll("/", "\\");
    const absolute = path.resolve(runtimeRoot, normalized);
    const contained = absolute === runtimeRoot || absolute.startsWith(`${runtimeRoot}${path.sep}`);
    assert(contained, `runtime manifest path escapes runtime root: ${relative}`);
    assert(statSync(absolute).isFile(), `runtime manifest file is missing: ${relative}`);
    assertEqual(sha256File(absolute), expectedHash, `runtime manifest hash: ${relative}`);
  }

  const nodeVersion = execFileSync(path.join(runtimeRoot, "node", "node.exe"), ["--version"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  assertEqual(nodeVersion, "v24.20.0", "bundled Node --version");
  return {
    nodeVersion,
    manifestNodeVersion: manifest.nodeVersion,
    manifestFileCount: Object.keys(manifest.files).length,
    manifestPass: true,
  };
}

function readPowerShellJson(scriptName) {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(workspaceRoot, "scripts", scriptName),
      "-ExecutablePath",
      executablePath,
    ],
    { cwd: workspaceRoot, encoding: "utf8", windowsHide: true },
  ).trim();
  return JSON.parse(output);
}

function listFiles(root) {
  return listFilesFromRoot(root, root);
}

function listFilesFromRoot(root, baseRoot) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFilesFromRoot(absolute, baseRoot));
    else if (entry.isFile()) result.push(path.relative(baseRoot, absolute).replaceAll("\\", "/"));
  }
  return result;
}

function relativePath(filePath) {
  return path.relative(workspaceRoot, filePath).replaceAll("\\", "/");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function requireFile(filePath, label) {
  assert(existsSync(filePath), `${label} is missing`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function assertMatch(actual, pattern, label) {
  if (typeof actual !== "string" || !pattern.test(actual)) throw new Error(`${label}: value did not match ${pattern}`);
}

function fuseStateName(value) {
  return FuseState[value] ?? `UNKNOWN(${String(value)})`;
}
