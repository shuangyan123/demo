/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this config as CommonJS. */
const path = require("node:path");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

const projectRoot = __dirname;
const electronVersion = "43.4.1";

/**
 * M0 is an additive packaging proof of concept. It consumes the host and
 * runtime prepared by desktop:prepare and never participates in the Forge
 * Squirrel release path.
 */
async function applyM0Fuses(context) {
  if (context.electronPlatformName !== "win32") return;

  // electron-builder 26.15.3 resolves its nested @electron/fuses 1.8.0,
  // which cannot describe Electron 43's ninth WasmTrapHandlers fuse. Use
  // the repository-pinned @electron/fuses API so strict mode covers all
  // nine fuses before the unsigned binary can proceed to a later signing stage.
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
    output: path.join(projectRoot, "out", "builder-m0"),
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
  artifactName: "ReviewWorkspace-${version}-NSIS-M0-POC.${ext}",
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
  },
  nsis: {
    oneClick: false,
    runAfterFinish: false,
    differentialPackage: false,
  },
  afterPack: applyM0Fuses,
};
