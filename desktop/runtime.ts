import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { app } from "electron";

type IntegrityManifest = {
  algorithm: "sha256";
  files: Record<string, string>;
};

export type DesktopRuntimeErrorCode =
  | "INTEGRITY_MANIFEST_INVALID"
  | "INTEGRITY_PATH_INVALID"
  | "INTEGRITY_FILE_MISSING"
  | "INTEGRITY_HASH_MISMATCH"
  | "INTEGRITY_READ_FAILED"
  | "RUNTIME_PORT_FAILED"
  | "RUNTIME_SPAWN_FAILED"
  | "RUNTIME_EXITED"
  | "RUNTIME_START_TIMEOUT";

type DesktopRuntimeErrorDetails = {
  relativePath?: string;
  exitCode?: number | null;
  stderr?: string;
};

/** 桌面启动错误只暴露稳定错误码和脱敏后的有限诊断信息。 */
export class DesktopRuntimeError extends Error {
  readonly code: DesktopRuntimeErrorCode;
  readonly details: DesktopRuntimeErrorDetails;

  constructor(code: DesktopRuntimeErrorCode, message: string, details: DesktopRuntimeErrorDetails = {}, cause?: unknown) {
    super(message, { cause });
    this.name = "DesktopRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export type DesktopRuntime = {
  baseUrl: string;
  token: string;
  stop: () => Promise<void>;
};

const TRANSIENT_FILE_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
const HASH_CONCURRENCY = 12;
const RETRY_DELAY_MS = 120;
const STDERR_LIMIT = 2_000;

/** 启动前验证 Node 与 standalone 资源，随后只监听随机 loopback 端口。 */
export async function startDesktopRuntime(): Promise<DesktopRuntime> {
  const root = path.join(process.resourcesPath, ".desktop-runtime");
  await verifyRuntimeIntegrity(root);
  const port = await reserveLoopbackPort();
  const token = randomBytes(32).toString("base64url");
  const executable = path.join(root, "node", "node.exe");
  const server = path.join(root, "app", "server.js");
  let child: ChildProcess;
  try {
    child = spawn(executable, [server], {
      cwd: path.join(root, "app"),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        REVIEW_DESKTOP_RUNTIME_TOKEN: token,
      },
    });
  } catch (error) {
    throw new DesktopRuntimeError("RUNTIME_SPAWN_FAILED", "无法启动桌面运行进程", {}, error);
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForRuntime(child, baseUrl, token);
  return {
    baseUrl,
    token,
    stop: () => stopChild(child),
  };
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => reject(new DesktopRuntimeError("RUNTIME_PORT_FAILED", "无法分配桌面运行端口", {}, error)));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new DesktopRuntimeError("RUNTIME_PORT_FAILED", "无法分配桌面运行端口"));
        return;
      }
      server.close((error) => error
        ? reject(new DesktopRuntimeError("RUNTIME_PORT_FAILED", "无法释放桌面预留端口", {}, error))
        : resolve(address.port));
    });
  });
}

async function waitForRuntime(child: ChildProcess, baseUrl: string, token: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_LIMIT);
  });
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", (error) => reject(new DesktopRuntimeError("RUNTIME_SPAWN_FAILED", "桌面运行进程启动失败", {}, error)));
  });

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new DesktopRuntimeError("RUNTIME_EXITED", "Next standalone 提前退出", {
        exitCode: child.exitCode,
        stderr: sanitizeDiagnostic(stderr),
      });
    }
    try {
      const response = await Promise.race([
        fetch(baseUrl, { headers: { "x-review-runtime-token": token } }),
        spawnError,
      ]);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      if (error instanceof DesktopRuntimeError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(150);
  }
  await stopChild(child);
  throw new DesktopRuntimeError("RUNTIME_START_TIMEOUT", "Next standalone 启动超时", {
    stderr: sanitizeDiagnostic(stderr || lastError),
  });
}

export async function verifyRuntimeIntegrity(root: string): Promise<void> {
  let manifest: IntegrityManifest;
  try {
    manifest = JSON.parse(await readWithTransientRetry(() => readFile(path.join(root, "manifest.json"), "utf8"))) as IntegrityManifest;
  } catch (error) {
    if (error instanceof DesktopRuntimeError) throw error;
    throw new DesktopRuntimeError("INTEGRITY_MANIFEST_INVALID", "桌面资源哈希清单无法读取", { relativePath: "manifest.json" }, error);
  }
  if (manifest.algorithm !== "sha256" || !manifest.files || !Object.keys(manifest.files).length) {
    throw new DesktopRuntimeError("INTEGRITY_MANIFEST_INVALID", "桌面资源哈希清单无效", { relativePath: "manifest.json" });
  }

  const entries = Object.entries(manifest.files);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const [relativePath, expected] = entries[cursor++];
      await verifyRuntimeFile(root, relativePath, expected);
    }
  }
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, entries.length) }, () => worker()));
}

async function verifyRuntimeFile(root: string, relativePath: string, expected: string): Promise<void> {
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new DesktopRuntimeError("INTEGRITY_PATH_INVALID", "桌面资源清单包含越界路径", { relativePath });
  }
  try {
    const fileStat = await readWithTransientRetry(() => stat(absolutePath));
    if (!fileStat.isFile()) {
      throw new DesktopRuntimeError("INTEGRITY_FILE_MISSING", "桌面运行文件缺失", { relativePath });
    }
    const actual = await readWithTransientRetry(() => hashFile(absolutePath));
    if (actual !== expected) {
      throw new DesktopRuntimeError("INTEGRITY_HASH_MISMATCH", "桌面运行文件哈希不匹配", { relativePath });
    }
  } catch (error) {
    if (error instanceof DesktopRuntimeError) throw error;
    const code = getNodeErrorCode(error);
    if (code === "ENOENT") {
      throw new DesktopRuntimeError("INTEGRITY_FILE_MISSING", "桌面运行文件缺失", { relativePath }, error);
    }
    throw new DesktopRuntimeError("INTEGRITY_READ_FAILED", "桌面运行文件无法读取", { relativePath }, error);
  }
}

async function readWithTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!TRANSIENT_FILE_CODES.has(getNodeErrorCode(error) ?? "")) throw error;
    await delay(RETRY_DELAY_MS);
    return operation();
  }
}

function getNodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function sanitizeDiagnostic(value: string): string {
  return value
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STDERR_LIMIT);
}

function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function runtimeFailureCopy(error: DesktopRuntimeError): { message: string; detail: string } {
  const detailParts = [`错误码：${error.code}`];
  if (error.details.relativePath) detailParts.push(`文件：${error.details.relativePath}`);
  if (error.details.exitCode !== undefined) detailParts.push(`退出码：${error.details.exitCode ?? "unknown"}`);
  if (error.details.stderr) detailParts.push(`日志：${error.details.stderr}`);
  if (error.code.startsWith("INTEGRITY_")) {
    return { message: "桌面运行资源校验失败。", detail: detailParts.join("\n") };
  }
  return { message: "桌面服务未能启动。", detail: detailParts.join("\n") };
}

export function showRuntimeFailure(error: unknown): Promise<number> {
  const runtimeError = error instanceof DesktopRuntimeError
    ? error
    : new DesktopRuntimeError("RUNTIME_SPAWN_FAILED", "桌面运行发生未知错误", {}, error);
  const copy = runtimeFailureCopy(runtimeError);
  return import("electron").then(({ dialog }) => dialog.showMessageBox({
    type: "error",
    title: "错题复盘无法启动",
    message: copy.message,
    detail: `${copy.detail}\n\n请重新运行完整安装器进行覆盖安装；现有用户数据不会被删除。`,
    buttons: ["退出"],
  }).then((result) => result.response));
}

export function isPackagedDesktop(): boolean {
  return app.isPackaged && !process.env.ELECTRON_RENDERER_URL;
}
