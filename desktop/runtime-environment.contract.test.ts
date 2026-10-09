import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { desktopRuntimeEnvironment } from "./runtime-environment.ts";

// 使用实际安装的 NextResponse/debug，合成凭据只在 child 内存中，不进入输出。
const probe = `const {NextResponse}=require('next/dist/server/web/spec-extension/response.js');
  const debug=require('next/dist/compiled/debug'); const {format}=require('node:util');
  const synthetic='synthetic-authorization-only'.padEnd(43,'x');
  const headers=new Headers({'x-review-startup-token':synthetic});
  const response=NextResponse.next({request:{headers}}); let raw='';
  const router=debug('next:router-server:resolve-routes');router.log=(...args)=>{raw+=format(...args)};
  router('middleware res',response.status,Object.fromEntries(response.headers));
  process.stdout.write(JSON.stringify({sensitiveHeaderPresent:response.headers.get('x-middleware-request-x-review-startup-token')===synthetic,
    disclosed:raw.includes(synthetic),routerEnabled:router.enabled,applicationEnabled:debug('review:diagnostics').enabled}));`;
function inspect(env: NodeJS.ProcessEnv) {
  const child = spawnSync(process.execPath, ["-e", probe], { cwd: process.cwd(), env, windowsHide: true, encoding: "utf8" });
  assert.equal(child.status, 0, "DEBUG probe must execute without printing credentials");
  return JSON.parse(child.stdout);
}

test("actual installed Next DEBUG positive control detects the synthetic header exposure", () => {
  const result = inspect({ ...process.env, DEBUG: "next:router-server:resolve-routes" });
  assert.equal(result.sensitiveHeaderPresent, true); assert.equal(result.disclosed, true);
});
for (const debug of ["next:router-server:resolve-routes", "next:*", "*", "*,review:*", "review:*,next:*", "review:*"]) {
  test(`Desktop child blocks Next DEBUG for ${debug} and preserves application diagnostics`, () => {
    const env = desktopRuntimeEnvironment({ ...process.env, DEBUG: debug });
    const result = inspect(env);
    assert.equal(result.sensitiveHeaderPresent, true); assert.equal(result.disclosed, false); assert.equal(result.routerEnabled, false);
    assert.equal(result.applicationEnabled, debug.includes("*") && (debug === "*" || debug.includes("review") || debug.startsWith("*,")));
  });
}
test("Desktop environment canonicalizes Windows DEBUG casing and is used by the real spawn seam", () => {
  const parent = { Debug: "*", PATH: "preserved", NODE_ENV: "test" as const };
  const env = desktopRuntimeEnvironment(parent);
  assert.equal(env.Debug, undefined); assert.equal(env.DEBUG, "*,-next:*"); assert.equal(env.PATH, "preserved");
  assert.deepEqual(parent, { Debug: "*", PATH: "preserved", NODE_ENV: "test" });
  assert.equal(inspect(desktopRuntimeEnvironment({ ...process.env, DEBUG: undefined })).disclosed, false);
  assert.match(readFileSync(new URL("./runtime.ts", import.meta.url), "utf8"), /\.\.\.desktopRuntimeEnvironment\(process\.env\)/);
});
