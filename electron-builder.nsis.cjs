/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this config as CommonJS. */
const path = require("node:path");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

const projectRoot = __dirname;
const electronVersion = "43.4.1";
const recallWindowsIconPath = path.join(projectRoot, "public", "brand", "recall", "app", "recall.ico");

/**
 * This is the canonical production/default Windows installer path. It consumes
 * the same prepared desktop host and runtime as the retained Forge/Squirrel
 * compatibility path without duplicating its security or identity policy.
 */
async function applyProductionFuses(context) {
  if (context.electronPlatformName !== "win32") return;

  // electron-builder 26.16.0 still resolves an older nested @electron/fuses package
  // that cannot describe Electron 43's ninth V1 fuse. Keep the repository-
  // pinned writer and the complete strict wire used by the M0 proof.
  await flipFuses(path.join(context.appOutDir, "review-workspace.exe"), {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
}

module.exports = {
  appId: "com.squirrel.review_workspace.review-workspace",
  productName: "错题复盘",
  executableName: "review-workspace",
  electronVersion,
  electronDist: path.join(projectRoot, ".cache", "electron"),
  directories: {
    app: path.join(projectRoot, ".desktop-app"),
    output: path.join(projectRoot, "out", "builder-nsis"),
  },
  asar: true,
  files: [".desktop/**/*"],
  extraResources: [
    {
      from: path.join(projectRoot, ".desktop-runtime"),
      to: ".desktop-runtime",
      filter: ["**/*"],
    },
  ],
  npmRebuild: false,
  nodeGypRebuild: false,
  publish: null,
  artifactName: "ReviewWorkspace-${version}-Windows-x64-Setup.${ext}",
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    icon: recallWindowsIconPath,
    // Keep resource/version editing while making the intentionally unsigned
    // production-v1 boundary explicit.
    signAndEditExecutable: true,
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    selectPerMachineByDefault: false,
    runAfterFinish: false,
    differentialPackage: false,
    installerIcon: recallWindowsIconPath,
    uninstallerIcon: recallWindowsIconPath,
    shortcutName: "错题复盘",
    uninstallDisplayName: "错题复盘",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  afterPack: applyProductionFuses,
};
