import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { desktopProtocolTarget } from "./protocol-target.ts";

test("desktop protocol paths cannot replace the owned loopback authority or leak its runtime token", () => {
  const base = "http://127.0.0.1:43123/";
  for (const pathname of ["/", "/diagnostic/resume?x=1", "//169.254.169.254/latest", "///external.test/path", "/\\external.test/path", "/%2f%2fexternal.test/path", "//user:secret@external.test/path", "//[::1]:43124/leak"]) {
    const result = desktopProtocolTarget(`review-app://workspace${pathname}`, base);
    assert.ok(result); assert.equal(result.origin, new URL(base).origin, pathname);
    assert.equal(result.username, ""); assert.equal(result.password, "");
  }
  for (const request of ["https://workspace/", "review-app://foreign/", "review-app://user@workspace/", "review-app://workspace:444/"]) assert.equal(desktopProtocolTarget(request, base), undefined);
  for (const target of ["http://localhost:43123/", "http://10.0.0.1:43123", "http://127.0.0.1/", "http://127.0.0.1:0/", "https://127.0.0.1:43123", "http://user:secret@127.0.0.1:43123"]) assert.throws(() => desktopProtocolTarget("review-app://workspace/", target), /owned loopback/);
});

if (process.platform === "win32") test("actual Electron protocol sends hostile authority-shaped GET/POST paths only to owned runtime", () => {
  const root = mkdtempSync(path.join(tmpdir(), "recall-protocol-target-test-"));
  try {
    const result = JSON.parse(execFileSync(path.resolve("node_modules/electron/dist/electron.exe"), ["test-support/protocol-target-native.cjs", root], { windowsHide: true, timeout: 25_000, encoding: "utf8" }).trim());
    assert.equal(result.escapedRequests, 0);
    assert.equal(result.ownedRequests, 3);
    assert.equal(result.postBody, "manufactured body");
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.match(path.basename(root), /^recall-protocol-target-test-/);
    rmSync(root, { recursive: true, force: true });
  }
});
