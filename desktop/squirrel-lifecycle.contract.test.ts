import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifySquirrelLifecycleInvocation,
  isSquirrelLifecycleInvocation,
} from "./squirrel-lifecycle.ts";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

test("Squirrel lifecycle arguments have an explicit classification", () => {
  const cases = [
    ["--squirrel-install", "install"],
    ["--squirrel-updated", "updated"],
    ["--squirrel-uninstall", "uninstall"],
    ["--squirrel-obsolete", "obsolete"],
  ] as const;

  for (const [argument, expected] of cases) {
    assert.equal(classifySquirrelLifecycleInvocation(["review-workspace.exe", argument]), expected);
    assert.equal(isSquirrelLifecycleInvocation([argument]), true);
  }
});

test("Squirrel first-run is a normal launch, not a lifecycle quit", () => {
  assert.equal(classifySquirrelLifecycleInvocation(["--squirrel-firstrun"]), undefined);
  assert.equal(isSquirrelLifecycleInvocation(["--squirrel-firstrun"]), false);
  assert.equal(isSquirrelLifecycleInvocation(["--squirrel-unknown"]), false);
});

test("lifecycle exit is decided before single-instance lock and app readiness", () => {
  const lifecycleCheck = main.indexOf("if (isSquirrelLifecycleInvocation(process.argv))");
  const lock = main.indexOf("app.requestSingleInstanceLock()");
  const ready = main.indexOf("app.whenReady()");

  assert.ok(lifecycleCheck >= 0);
  assert.ok(lock > lifecycleCheck);
  assert.ok(ready > lifecycleCheck);
  assert.match(main, /app\.whenReady\(\)\s*\.then\(launchMainWindowWithRecovery\)/);
  assert.match(main, /if \(isSquirrelLifecycleInvocation\(process\.argv\)\) \{[\s\S]*?app\.quit\(\)/);
});

test("lifecycle exit does not launch the renderer or perform app-side userData cleanup", () => {
  const lifecycleCheck = main.indexOf("if (isSquirrelLifecycleInvocation(process.argv))");
  const normalLaunch = main.indexOf("} else {", lifecycleCheck);
  const lifecycleBranch = main.slice(lifecycleCheck, normalLaunch);

  assert.ok(lifecycleCheck >= 0);
  assert.ok(normalLaunch > lifecycleCheck);
  assert.match(lifecycleBranch, /app\.quit\(\)/);
  assert.doesNotMatch(lifecycleBranch, /BrowserWindow|createMainWindow|startDesktopRuntime|app\.whenReady/);
  assert.doesNotMatch(main, /app\.setPath\(\s*["']userData["']/);
  assert.doesNotMatch(main, /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/);
  assert.doesNotMatch(main, /\b(?:delete|clear|reset)[A-Za-z0-9_$]*UserData\b/);
});
