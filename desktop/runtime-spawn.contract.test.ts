import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyRuntimeSpawnFailure, runWithRuntimeSpawnRetry, RuntimeSpawnFailure } from "./runtime-spawn.ts";

function nodeError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code, syscall: "spawn" });
}

test("首次 EBUSY 或 EACCES 后自动延迟重试一次并成功", async () => {
  for (const code of ["EBUSY", "EACCES"]) {
    let attempts = 0;
    const delays: number[] = [];
    const result = await runWithRuntimeSpawnRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw nodeError(code);
      return "started";
    }, async (milliseconds) => { delays.push(milliseconds); });
    assert.equal(result, "started");
    assert.equal(attempts, 2);
    assert.equal(delays.length, 1);
  }
});

test("无效可执行文件不自动重试并保留稳定分类", async () => {
  let attempts = 0;
  await assert.rejects(
    () => runWithRuntimeSpawnRetry(async () => {
      attempts += 1;
      throw nodeError("UNKNOWN", "%1 is not a valid Win32 application");
    }, async () => undefined),
    (error: unknown) => {
      assert.equal(error instanceof RuntimeSpawnFailure, true);
      assert.equal((error as RuntimeSpawnFailure).details.code, "RUNTIME_SPAWN_INVALID_EXECUTABLE");
      assert.equal((error as RuntimeSpawnFailure).attempts, 1);
      return true;
    },
  );
  assert.equal(attempts, 1);
  assert.equal(classifyRuntimeSpawnFailure(nodeError("ENOENT")).code, "RUNTIME_SPAWN_MISSING");
});

test("桌面失败对话提供重试、复制诊断、退出及有界本地日志", () => {
  const runtime = readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  assert.match(runtime, /--squirrel-firstrun/);
  assert.match(runtime, /buttons: \["重试", "复制诊断", "退出"\]/);
  assert.match(runtime, /DIAGNOSTIC_FILE_LIMIT/);
  assert.match(runtime, /app\.getPath\("logs"\)/);
  assert.match(main, /cleanupFailedLaunch/);
  assert.match(main, /if \(response === 0\) continue/);
});
