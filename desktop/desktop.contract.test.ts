import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./vault.contract.test.ts";
import "./runtime-spawn.contract.test.ts";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
const protocol = readFileSync(new URL("./protocol.ts", import.meta.url), "utf8");
const permissions = readFileSync(new URL("./permissions.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

test("桌面窗口保持隔离、沙箱与单实例边界", () => {
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
});

test("安装版通过稳定协议代理随机 loopback 且直连需要令牌", () => {
  assert.match(runtime, /listen\(0,\s*"127\.0\.0\.1"/);
  assert.match(runtime, /randomBytes\(32\)/);
  assert.match(protocol, /review-app/);
  assert.match(protocol, /targetProtocol\.isProtocolHandled\(DESKTOP_SCHEME\)/);
  assert.match(protocol, /targetProtocol\.unhandle\(DESKTOP_SCHEME\)/);
  assert.match(main, /session\.fromPartition\(partition\)/);
  assert.match(main, /installDesktopProtocol\(runtime\.baseUrl, runtime\.token, workspaceSession\.protocol\)/);
  assert.match(protocol, /x-review-runtime-token/);
  assert.match(proxy, /Desktop runtime access denied/);
});

test("桌面运行时验证资源并限制媒体权限来源", () => {
  assert.match(runtime, /verifyRuntimeIntegrity/);
  assert.match(runtime, /sha256/);
  assert.match(runtime, /DesktopRuntimeError/);
  assert.match(runtime, /INTEGRITY_HASH_MISMATCH/);
  assert.match(runtime, /RUNTIME_START_TIMEOUT/);
  assert.match(runtime, /TRANSIENT_FILE_CODES/);
  assert.match(runtime, /HASH_CONCURRENCY/);
  assert.doesNotMatch(runtime, /桌面运行资源不完整或已被修改/);
  assert.match(permissions, /setPermissionCheckHandler/);
  assert.match(permissions, /setDisplayMediaRequestHandler/);
  assert.match(permissions, /review-app:\/\/workspace/);
});
