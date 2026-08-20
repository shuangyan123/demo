/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this config as CommonJS. */
const path = require("node:path");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

const projectRoot = __dirname;
const electronVersion = "43.2.0";

/**
 * M1 is an additive candidate path. It consumes the same prepared desktop host
 * and runtime as the accepted Forge/Squirrel path, but never becomes a release
 * default or performs installation/migration work.
 */
async function applyM1Fuses(context) {
  if (context.electronPlatformName !== "win32") return;

  // electron-builder 26.15.3 resolves an older nested @electron/fuses package
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
  artifactName: "ReviewWorkspace-${version}-Windows-x64-NSIS-M1-Candidate.${ext}",
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    // Keep resource/version editing, but make the unsigned M1 boundary explicit.
    signAndEditExecutable: true,
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    selectPerMachineByDefault: false,
    runAfterFinish: false,
    differentialPackage: false,
    shortcutName: "错题复盘",
    uninstallDisplayName: "错题复盘",
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  afterPack: applyM1Fuses,
};
