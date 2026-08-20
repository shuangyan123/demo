import type { ForgeConfig } from "@electron-forge/shared-types";
import {
  flipFuses,
  FuseV1Options,
  FuseVersion,
} from "@electron/fuses";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { getRawHeader } from "@electron/asar";

const execFileAsync = (file: string, args: string[]): Promise<void> => (
  new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  })
);

const squirrelNuspecTemplate = join(process.cwd(), "scripts", "squirrel.nuspec.template");

async function embedWindowsAsarIntegrity(buildPath: string): Promise<void> {
  const executablePath = join(buildPath, "review-workspace.exe");
  const asarPath = join(buildPath, "resources", "app.asar");
  const { headerString } = getRawHeader(asarPath);
  const integrityPayload = JSON.stringify([
    {
      file: "resources\\app.asar",
      alg: "SHA256",
      value: createHash("sha256").update(headerString).digest("hex"),
    },
  ]);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "review-workspace-integrity-"));
  const payloadPath = join(temporaryDirectory, "integrity.json");

  try {
    await flipFuses(executablePath, {
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
    await writeFile(payloadPath, integrityPayload, "utf8");
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(process.cwd(), "scripts", "embed-electron-asar-integrity.ps1"),
      "-ExecutablePath",
      executablePath,
      "-IntegrityPayloadPath",
      payloadPath,
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const config: ForgeConfig = {
  outDir: "../out",
  packagerConfig: {
    name: "review-workspace",
    executableName: "review-workspace",
    asar: true,
    prune: false,
    electronZipDir: join(process.cwd(), ".cache", "electron"),
    extraResource: existsSync(".desktop-runtime") ? [".desktop-runtime"] : [],
    afterComplete: [
      (buildPath, _electronVersion, platform, _arch, done) => {
        if (platform !== "win32") {
          done();
          return;
        }

        embedWindowsAsarIntegrity(buildPath).then(
          () => done(),
          (error: Error) => done(error),
        );
      },
    ],
  },
  makers: [
    new MakerSquirrel({
      name: "review_workspace",
      authors: "Private",
      description: "本地优先的错题复盘与 AI 学习工作台",
      nuspecTemplate: squirrelNuspecTemplate,
      setupExe: `ReviewWorkspace-${process.env.npm_package_version ?? "0.2.3"}-Windows-x64-Setup.exe`,
    }),
  ],
};

export default config;
