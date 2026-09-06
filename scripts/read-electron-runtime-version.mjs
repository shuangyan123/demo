import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronProbeSource = [
  'const { app } = require("electron");',
  "app.whenReady().then(() => {",
  "  const versions = {",
  "    electronVersion: process.versions.electron,",
  "    embeddedNodeVersion: process.versions.node,",
  "  };",
  "  process.stdout.write(`${JSON.stringify(versions)}\\n`, () => app.exit(0));",
  "}).catch((error) => {",
  "  console.error(error instanceof Error ? error.stack : String(error));",
  "  app.exit(1);",
  "});",
].join("\n");

export function getElectronRuntimeExecutablePath({ workspaceRoot: root = workspaceRoot } = {}) {
  if (process.platform !== "win32") {
    throw new Error("Electron runtime readback requires a Windows runner");
  }

  const candidates = [
    path.join(root, ".cache", "electron", "electron.exe"),
    path.join(root, "node_modules", "electron", "dist", "electron.exe"),
  ];
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(`Electron runtime executable is missing: ${candidates.join(", ")}`);
  }
  return executablePath;
}

export function readElectronRuntimeVersions({
  workspaceRoot: root = workspaceRoot,
  executablePath = getElectronRuntimeExecutablePath({ workspaceRoot: root }),
} = {}) {
  if (process.platform !== "win32") {
    throw new Error("Electron runtime readback requires a Windows runner");
  }

  const probeDirectory = mkdtempSync(path.join(os.tmpdir(), "review-workspace-electron-runtime-"));
  const probePath = path.join(probeDirectory, "probe.cjs");
  writeFileSync(probePath, `${electronProbeSource}\n`, "utf8");

  try {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const output = execFileSync(executablePath, [probePath], {
      cwd: root,
      encoding: "utf8",
      env: environment,
      timeout: 30_000,
      windowsHide: true,
    });
    const lines = output.trim().split(/\r?\n/).filter(Boolean);
    const readback = JSON.parse(lines.at(-1) ?? "");
    if (
      typeof readback.electronVersion !== "string"
      || typeof readback.embeddedNodeVersion !== "string"
      || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(readback.electronVersion)
      || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(readback.embeddedNodeVersion)
    ) {
      throw new Error("Electron process.versions did not return valid Electron and Node versions");
    }

    return {
      executablePath,
      electronVersion: readback.electronVersion,
      embeddedNodeVersion: readback.embeddedNodeVersion,
      method: "Electron main process process.versions",
      pass: true,
    };
  } catch (error) {
    throw new Error(
      `Electron embedded Node runtime readback failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rmSync(probeDirectory, { force: true, recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(readElectronRuntimeVersions(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Electron runtime readback failed");
    process.exitCode = 1;
  }
}
