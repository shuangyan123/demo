import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronProbeSource = [
  'const { app } = require("electron");',
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  'const profile = path.join(__dirname, "profile");',
  'fs.mkdirSync(profile, { recursive: true });',
  'app.setPath("appData", __dirname);',
  'app.setPath("userData", profile);',
  'app.setPath("sessionData", profile);',
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

const diagnosticCodes = new Set([
  "ENOENT", "EACCES", "EPERM", "EAGAIN", "EMFILE", "ENFILE", "ENOMEM", "EINVAL",
  "ETIMEDOUT", "ENOBUFS", "UNKNOWN", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
]);
const diagnosticSignals = new Set([
  "SIGHUP", "SIGINT", "SIGQUIT", "SIGILL", "SIGTRAP", "SIGABRT", "SIGBUS", "SIGFPE",
  "SIGKILL", "SIGUSR1", "SIGSEGV", "SIGUSR2", "SIGPIPE", "SIGALRM", "SIGTERM", "SIGBREAK",
]);

function failureField(error, key) {
  // 不执行不可信 Error 上的 getter，也不保留其原型、cause 或自定义字段。
  try { return Object.getOwnPropertyDescriptor(error, key)?.value; } catch { return undefined; }
}

function diagnosticInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function outputMetadata(value) {
  // 输出正文永不进入异常或日志；长度封顶，不尝试识别任意格式的秘密。
  const bytes = typeof value === "string" ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.length : 0;
  return { present: bytes > 0, bytes: Math.min(bytes, 1_048_576), capped: bytes > 1_048_576 };
}

export function getElectronRuntimeExecutablePath({ workspaceRoot: root = workspaceRoot } = {}) {
  if (process.platform !== "win32") {
    throw new Error("Electron runtime readback requires a Windows runner");
  }

  const electronVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).devDependencies.electron;
  const candidates = [
    path.join(root, ".cache", "electron", electronVersion, "electron.exe"),
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
  const probeDirectoryCanonical = realpathSync.native(probeDirectory) === probeDirectory;

  let phase = "launch";
  let output = "";
  try {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    output = execFileSync(executablePath, [probePath], {
      cwd: root,
      encoding: "utf8",
      env: environment,
      timeout: 30_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    phase = "decode";
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
    // 严格白名单：禁止复制 message/stack/stdout/stderr 正文、路径或任意错误字符串。
    const status = phase === "decode" ? 0 : diagnosticInteger(failureField(error, "status"), -0x80000000, 0xffffffff);
    const code = failureField(error, "code");
    const signal = failureField(error, "signal");
    const diagnostics = {
      phase,
      errorType: phase === "decode" ? "invalid_readback" : "child_process_failed",
      status,
      windowsStatusHex: status === null ? null : `0x${(status >>> 0).toString(16).padStart(8, "0")}`,
      signal: diagnosticSignals.has(signal) ? signal : null,
      code: diagnosticCodes.has(code) ? code : null,
      pid: diagnosticInteger(failureField(error, "pid"), 1, 0xffffffff),
      output: { stdout: outputMetadata(failureField(error, "stdout") ?? output), stderr: outputMetadata(failureField(error, "stderr")) },
      launch: { probeDirectoryCanonical,
        timeoutMs: 30_000, windowsHide: true, parentNodeVersion: process.versions.node,
        nodeOptionsPresent: Boolean(process.env.NODE_OPTIONS), electronRunAsNodeRemoved: true },
    };
    throw Object.assign(new Error(`Electron embedded Node runtime readback failed: ${JSON.stringify(diagnostics)}`), { diagnostics });
  } finally {
    if (path.dirname(probeDirectory) !== path.resolve(os.tmpdir())
      || !path.basename(probeDirectory).startsWith("review-workspace-electron-runtime-")) {
      throw new Error("Refusing to remove an unowned Electron probe directory");
    }
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
