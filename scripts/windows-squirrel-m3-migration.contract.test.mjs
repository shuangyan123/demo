import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const helperPath = resolve(workspaceRoot, "scripts", "windows-squirrel-m3-migration.ps1");
const helperSource = readFileSync(helperPath, "utf8");
const electronBuilderAppId = "com.squirrel.review_workspace.review-workspace";
const electronBuilderVersion = "26.15.3";
const electronBuilderNsisGuid = "6e1e4cd2-13e9-52d1-a05a-25028be9da88";
const electronBuilderNsisNamespace = "50e065bc-3134-11e6-9bab-38c9862bdaf3";

function baseFixture() {
  const legacyRoot = "C:\\fixture\\review_workspace";
  const nsisRoot = "C:\\fixture\\Programs\\review-workspace";
  const userData = "C:\\fixture\\Roaming\\错题复盘";
  const desktopShortcut = "C:\\fixture\\Desktop\\错题复盘.lnk";
  const startMenuShortcut = "C:\\fixture\\StartMenu\\错题复盘.lnk";
  const legacyStub = legacyRoot + "\\review-workspace.exe";
  const legacyVersionDirectory = legacyRoot + "\\app-0.2.4";
  const nsisExecutable = nsisRoot + "\\review-workspace.exe";
  const nsisUninstaller = nsisRoot + "\\Uninstall review-workspace.exe";
  const legacyRegistryKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\review_workspace";
  const nsisInstallRegistryKey = `HKCU:\\Software\\${electronBuilderNsisGuid}`;
  const nsisUninstallRegistryKey = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${electronBuilderNsisGuid}`;
  return {
    paths: {
      legacyRoot,
      legacyRegistryKey,
      legacyUpdate: legacyRoot + "\\Update.exe",
      legacyStub,
      legacyVersionDirectory,
      nsisRoot,
      nsisExecutable,
      nsisUninstaller,
      nsisInstallRegistryKey,
      nsisUninstallRegistryKey,
      userData,
      desktopShortcut,
      startMenuShortcut,
    },
    legacyRoot: {
      status: "VALID",
      path: legacyRoot,
      isReparsePoint: false,
      stub: { status: "VALID", path: legacyStub, isDirectory: false, isReparsePoint: false },
      update: { status: "FOUND", path: legacyRoot + "\\Update.exe", isReparsePoint: false },
      versionDirectory: { status: "FOUND", path: legacyVersionDirectory, isReparsePoint: false },
      versionExecutable: { status: "VALID", path: legacyVersionDirectory + "\\review-workspace.exe" },
      residuals: [{ name: ".dead", path: legacyRoot + "\\.dead", kind: "INERT", isReparsePoint: false }],
      unknownResiduals: [],
    },
    legacyRegistration: {
      status: "VALID",
      key: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\review_workspace",
      identity: true,
    },
    registryFacts: [
      {
        key: legacyRegistryKey,
        hive: "HKCU",
        DisplayName: "错题复盘",
        DisplayVersion: "0.2.4",
        InstallLocation: legacyRoot,
        UninstallString: `"${legacyRoot}\\Update.exe" --uninstall`,
        QuietUninstallString: `"${legacyRoot}\\Update.exe" --uninstall -s`,
      },
      {
        key: nsisInstallRegistryKey,
        hive: "HKCU",
        InstallLocation: nsisRoot,
      },
      {
        key: nsisUninstallRegistryKey,
        hive: "HKCU",
        DisplayName: "错题复盘",
        DisplayVersion: "0.2.4",
        UninstallString: `"${nsisUninstaller}" /currentuser`,
        QuietUninstallString: `"${nsisUninstaller}" /currentuser /S`,
      },
    ],
    legacyProcesses: { status: "VALID", count: 0, entries: [] },
    desktopShortcut: { status: "LEGACY_TARGET", path: desktopShortcut, targetPath: legacyStub },
    startMenuShortcut: { status: "NSIS_TARGET", path: startMenuShortcut, targetPath: nsisExecutable },
    userData: { status: "FOUND", path: userData, isReparsePoint: false },
    nsisRoot: { status: "FOUND", path: nsisRoot, isDirectory: true, isReparsePoint: false },
    nsisExecutable: { status: "FOUND", path: nsisExecutable, isDirectory: false, isReparsePoint: false },
    ambiguities: [],
    unknownPaths: [],
  };
}

function runFixture(fixture, args = []) {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "review-workspace-m3-"));
  const fixturePath = join(fixtureDirectory, "snapshot.json");
  writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
  try {
    try {
      return JSON.parse(execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath, "-SnapshotPath", fixturePath, ...args],
        { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
      ).trim());
    } catch (error) {
      throw new Error("M3 helper fixture failed: " + String(error.stdout ?? "") + " " + String(error.stderr ?? ""), { cause: error });
    }
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

test("M3 helper has a non-destructive inspect default and no installer-hook cleanup", () => {
  assert.match(helperSource, /param\([\s\S]*\[switch\]\$ExecuteCleanup/);
  assert.match(helperSource, /defaultMode\s*=\s*"NON-DESTRUCTIVE"/);
  assert.match(helperSource, /SNAPSHOT_CLEANUP_FORBIDDEN/);
  assert.doesNotMatch(helperSource, /preInit|customInit|customInstall/);
  assert.doesNotMatch(helperSource, /app\.setPath|safeStorage|decrypt|credential/i);
});

test("M3 helper cannot execute registry-provided uninstall commands", () => {
  assert.match(helperSource, /UninstallString/);
  assert.match(helperSource, /Test-ExpectedSquirrelCommand/);
  assert.doesNotMatch(helperSource, /Start-Process/);
  assert.doesNotMatch(helperSource, /Invoke-Expression/);
  assert.doesNotMatch(helperSource, /cmd\.exe|powershell\.exe.*UninstallString/i);
  assert.match(helperSource, /remove-registry-key/);
});

test("M3 helper source contains exact identity and never-touch boundaries", () => {
  assert.match(helperSource, /review_workspace/);
  assert.match(helperSource, /review-workspace\.exe/);
  assert.match(helperSource, /app-0\.2\.4/);
  assert.match(helperSource, /Programs\\review-workspace/);
  assert.match(helperSource, /ProductNameZh/);
  assert.match(helperSource, /0x9519[\s\S]*0x9898[\s\S]*0x590D[\s\S]*0x76D8/);
  assert.match(helperSource, /USERDATA_BOUNDARY_COLLISION/);
  assert.match(helperSource, /NSIS_ROOT_NOT_PRESENT/);
  assert.match(helperSource, /REPARSE_POINT/);
  assert.match(helperSource, /LEGACY_APP_RUNNING/);
});

test("M3 registry identity uses the pinned electron-builder UUIDv5 derivation", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  assert.match(helperSource, new RegExp(electronBuilderAppId.replaceAll(".", "\\.")));
  assert.match(helperSource, new RegExp(electronBuilderNsisNamespace));
  assert.match(helperSource, /Get-ElectronBuilderNsisGuid/);
  assert.match(helperSource, /SHA1/);
  const result = runFixture(baseFixture());
  assert.equal(result.registryIdentity.identity.appId, electronBuilderAppId);
  assert.equal(result.registryIdentity.identity.electronBuilderVersion, electronBuilderVersion);
  assert.equal(result.registryIdentity.identity.namespace, electronBuilderNsisNamespace);
  assert.equal(result.registryIdentity.identity.guid, electronBuilderNsisGuid);
});

test("M3 registry classification preserves legitimate Squirrel plus NSIS coexistence", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const result = runFixture(baseFixture());
  assert.equal(result.legacyRegistration, "FOUND");
  assert.equal(result.registryIdentity.nsisInstallRegistry.status, "NSIS_EXPECTED");
  assert.equal(result.registryIdentity.nsisUninstallRegistry.status, "NSIS_EXPECTED");
  assert.equal(result.cleanupEligible, true);
  assert.equal(result.blockingReasons.includes("AMBIGUOUS_LEGACY_REGISTRATION"), false);
  assert.equal(result.registryIdentity.classifications.filter((entry) => entry.classification === "NSIS_EXPECTED").length, 2);
  assert.equal(result.registryIdentity.classifications.filter((entry) => entry.classification === "SQUIRREL_EXPECTED").length, 1);
  const installRecord = result.registryIdentity.classifications.find((entry) => entry.key === result.registryIdentity.nsisInstallRegistry.key);
  assert.equal(installRecord.installLocation, result.registryIdentity.identity.installLocation);
});

test("M3 NSIS uninstall identity does not require InstallLocation", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const fixture = baseFixture();
  delete fixture.registryFacts[2].InstallLocation;
  const result = runFixture(fixture);
  assert.equal(result.registryIdentity.nsisInstallRegistry.status, "NSIS_EXPECTED");
  assert.equal(result.registryIdentity.nsisUninstallRegistry.status, "NSIS_EXPECTED");
  assert.equal(result.legacyRegistration, "FOUND");
  assert.equal(result.cleanupEligible, true);
});

test("M3 NSIS registry identity fails closed on location, key, command, and version changes", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const wrongLocation = baseFixture();
  wrongLocation.registryFacts[1].InstallLocation = "C:\\fixture\\Programs\\other-review-workspace";
  let result = runFixture(wrongLocation);
  assert.equal(result.registryIdentity.nsisInstallRegistry.status, "INVALID");
  assert.equal(result.registryIdentity.nsisUninstallRegistry.status, "NSIS_EXPECTED");
  assert.ok(result.blockingReasons.includes("NSIS_INSTALL_REGISTRY_IDENTITY_INVALID"));
  assert.equal(result.cleanupEligible, false);

  const wrongKey = baseFixture();
  wrongKey.registryFacts[2].key = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\wrong-builder-guid";
  result = runFixture(wrongKey);
  assert.equal(result.legacyRegistration, "AMBIGUOUS");
  assert.ok(result.registryIdentity.unknownSameProduct.includes(wrongKey.registryFacts[2].key));
  assert.equal(result.cleanupEligible, false);

  const wrongCommand = baseFixture();
  wrongCommand.registryFacts[2].UninstallString = `"${wrongCommand.paths.legacyRoot}\\Update.exe" --uninstall`;
  result = runFixture(wrongCommand);
  assert.equal(result.registryIdentity.nsisUninstallRegistry.status, "INVALID");
  assert.ok(result.blockingReasons.includes("NSIS_UNINSTALL_REGISTRY_IDENTITY_INVALID"));
  assert.equal(result.cleanupEligible, false);

  const wrongVersion = baseFixture();
  wrongVersion.registryFacts[2].DisplayVersion = "0.2.3";
  result = runFixture(wrongVersion);
  assert.equal(result.registryIdentity.nsisUninstallRegistry.status, "INVALID");
  assert.ok(result.blockingReasons.includes("NSIS_UNINSTALL_REGISTRY_IDENTITY_INVALID"));
  assert.equal(result.cleanupEligible, false);
});

test("M3 unknown same-name registrations remain ambiguous and Squirrel-only facts remain classifiable", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const unknown = baseFixture();
  unknown.registryFacts.push({
    key: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\review-workspace-copy",
    hive: "HKCU",
    DisplayName: "错题复盘",
    DisplayVersion: "0.2.4",
    UninstallString: '"C:\\unknown\\uninstall.exe" /S',
    QuietUninstallString: '"C:\\unknown\\uninstall.exe" /S',
  });
  let result = runFixture(unknown);
  assert.equal(result.legacyRegistration, "AMBIGUOUS");
  assert.ok(result.blockingReasons.includes("LEGACY_REGISTRATION_INVALID"));
  assert.equal(result.cleanupEligible, false);

  const squirrelOnly = baseFixture();
  squirrelOnly.registryFacts = [squirrelOnly.registryFacts[0]];
  result = runFixture(squirrelOnly);
  assert.equal(result.legacyRegistration, "FOUND");
  assert.equal(result.registryIdentity.classifications[0].classification, "SQUIRREL_EXPECTED");
  assert.equal(result.cleanupEligible, false);
});

test("M3 cleanup authority is Squirrel-only and registry commands are never executed", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const fixture = baseFixture();
  const result = runFixture(fixture);
  const registryActions = result.cleanupPlan.filter((action) => action.type === "remove-registry-key");
  assert.deepEqual(registryActions.map((action) => action.path), [fixture.paths.legacyRegistryKey]);
  assert.equal(result.cleanupPlan.some((action) => action.path === fixture.paths.nsisInstallRegistryKey), false);
  assert.equal(result.cleanupPlan.some((action) => action.path === fixture.paths.nsisUninstallRegistryKey), false);
  assert.equal(result.cleanupPlan.some((action) => action.path.includes("Uninstall review-workspace.exe")), false);
  assert.doesNotMatch(helperSource, /Start-Process/);
  assert.doesNotMatch(helperSource, /Invoke-Expression/);
});

test("M3 snapshot contracts are fixture-only and non-destructive", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const fixture = baseFixture();
  const result = runFixture(fixture);
  assert.equal(result.mode, "inspect");
  assert.equal(result.defaultMode, "NON-DESTRUCTIVE");
  assert.equal(result.cleanupPerformed, false);
  assert.equal(result.cleanupEligible, true);
  assert.deepEqual(result.blockingReasons, []);
  assert.equal(result.desktopShortcut, "LEGACY_TARGET");
  assert.equal(result.startMenuShortcut, "NSIS_TARGET");
  assert.equal(result.userData.status, "PRESENT");
  assert.equal(result.nsisRoot, "FOUND");
  assert.ok(result.legacyResiduals.some((entry) => entry.name === ".dead"));
  assert.deepEqual(result.inertResiduals, []);
  assert.equal(result.activeLegacyState.present, true);
  assert.ok(result.cleanupPlan.some((action) => action.path.endsWith("app-0.2.4")));
  assert.ok(result.cleanupPlan.some((action) => action.path.endsWith("Desktop\\错题复盘.lnk")), JSON.stringify(result.cleanupPlan));
  assert.ok(result.cleanupPlan.every((action) => !action.path.includes("Roaming\\错题复盘")));
  assert.ok(result.cleanupPlan.every((action) => !action.path.includes("Programs\\review-workspace")));

  const fixtureDirectory = mkdtempSync(join(tmpdir(), "review-workspace-m3-"));
  const fixturePath = join(fixtureDirectory, "snapshot.json");
  writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
  try {
    let error;
    try {
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath, "-SnapshotPath", fixturePath, "-ExecuteCleanup", "-Stage1Verified"],
        { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
      );
      assert.fail("fixture cleanup unexpectedly succeeded");
    } catch (caught) {
      error = caught;
    }
    assert.match(String(error.stdout), /SNAPSHOT_CLEANUP_FORBIDDEN/);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

test("M3 path, identity, reparse, ambiguity, and process guards fail closed", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const sibling = baseFixture();
  sibling.legacyRoot.path = "C:\\fixture\\review_workspace-sibling";
  let result = runFixture(sibling);
  assert.ok(result.blockingReasons.includes("LEGACY_ROOT_MISMATCH"));
  assert.equal(result.cleanupEligible, false);

  const reparse = baseFixture();
  reparse.legacyRoot.isReparsePoint = true;
  result = runFixture(reparse);
  assert.ok(result.blockingReasons.includes("LEGACY_ROOT_REPARSE_POINT"));

  const wrongRegistration = baseFixture();
  delete wrongRegistration.registryFacts;
  wrongRegistration.legacyRegistration.status = "INVALID";
  result = runFixture(wrongRegistration);
  assert.ok(result.blockingReasons.includes("LEGACY_REGISTRATION_INVALID"));

  const ambiguous = baseFixture();
  ambiguous.ambiguities = ["AMBIGUOUS_LEGACY_REGISTRATION"];
  result = runFixture(ambiguous);
  assert.ok(result.blockingReasons.includes("AMBIGUOUS_LEGACY_REGISTRATION"));

  const running = baseFixture();
  running.legacyProcesses = {
    status: "VALID",
    count: 1,
    entries: [{ executablePath: "C:\\fixture\\review_workspace\\review-workspace.exe", commandLineObserved: true }],
  };
  result = runFixture(running);
  assert.ok(result.blockingReasons.includes("LEGACY_APP_RUNNING"));

  const processInspectionFailure = baseFixture();
  processInspectionFailure.legacyProcesses = { status: "INVALID", count: 0, entries: [] };
  result = runFixture(processInspectionFailure);
  assert.ok(result.blockingReasons.includes("LEGACY_PROCESS_INSPECTION_INVALID"));
  assert.equal(result.cleanupEligible, false);

  const unrelatedNode = baseFixture();
  unrelatedNode.legacyProcesses = {
    status: "VALID",
    count: 0,
    entries: [{ executablePath: "C:\\Program Files\\nodejs\\node.exe", commandLineObserved: true }],
  };
  result = runFixture(unrelatedNode);
  assert.equal(result.cleanupEligible, true);

  const missingNsisExecutable = baseFixture();
  missingNsisExecutable.nsisExecutable = { status: "ABSENT", path: missingNsisExecutable.paths.nsisExecutable, isDirectory: false, isReparsePoint: false };
  result = runFixture(missingNsisExecutable);
  assert.ok(result.blockingReasons.includes("NSIS_EXECUTABLE_NOT_PRESENT"));
  assert.equal(result.cleanupEligible, false);
});

test("M3 shortcut authorization is target-aware, not name-based", (t) => {
  if (process.platform !== "win32") {
    t.skip("PowerShell fixture execution is a Windows contract");
    return;
  }

  const nsisTarget = baseFixture();
  nsisTarget.desktopShortcut = {
    status: "NSIS_TARGET",
    path: nsisTarget.paths.desktopShortcut,
    targetPath: nsisTarget.paths.nsisExecutable,
  };
  let result = runFixture(nsisTarget);
  assert.equal(result.desktopShortcut, "NSIS_TARGET");
  assert.equal(result.cleanupPlan.some((action) => action.path === nsisTarget.paths.desktopShortcut), false);

  const otherTarget = baseFixture();
  otherTarget.desktopShortcut = {
    status: "OTHER_TARGET",
    path: otherTarget.paths.desktopShortcut,
    targetPath: "C:\\other\\review-workspace.exe",
  };
  result = runFixture(otherTarget);
  assert.equal(result.desktopShortcut, "OTHER_TARGET");
  assert.equal(result.cleanupPlan.some((action) => action.path === otherTarget.paths.desktopShortcut), false);

  const traversal = baseFixture();
  traversal.desktopShortcut = {
    status: "LEGACY_TARGET",
    path: "C:\\fixture\\outside\\错题复盘.lnk",
    targetPath: traversal.paths.legacyRoot + "\\review-workspace.exe",
  };
  result = runFixture(traversal);
  assert.ok(result.blockingReasons.includes("DESKTOP_SHORTCUT_PATH_NOT_EXPECTED"));
  assert.equal(result.cleanupEligible, false);
  assert.deepEqual(result.cleanupPlan, []);

  const traversalRoot = baseFixture();
  traversalRoot.legacyRoot.path = traversalRoot.paths.legacyRoot + "\\..\\other";
  result = runFixture(traversalRoot);
  assert.ok(result.blockingReasons.includes("LEGACY_ROOT_MISMATCH"));
  assert.equal(result.cleanupEligible, false);

  const unknownPath = baseFixture();
  unknownPath.unknownPaths = ["C:\\fixture\\review_workspace\\unexpected.bin"];
  result = runFixture(unknownPath);
  assert.ok(result.blockingReasons.includes("UNKNOWN_PATH_STATE"));
  assert.deepEqual(result.cleanupPlan, []);
});
