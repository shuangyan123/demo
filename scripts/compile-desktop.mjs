import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(workspaceRoot, ".desktop");
const typeScriptCompiler = resolve(workspaceRoot, "node_modules", "typescript", "bin", "tsc");

// 清理旧输出，避免重命名 preload 后旧的 ESM preload.js 被误复制进 staging 或 ASAR。
await rm(outputDirectory, { recursive: true, force: true });

await new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [typeScriptCompiler, "-p", resolve(workspaceRoot, "desktop", "tsconfig.json")], {
    cwd: workspaceRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolvePromise();
      return;
    }
    reject(new Error(`Desktop TypeScript compilation failed (${signal ?? `exit ${code ?? "unknown"}`})`));
  });
});
