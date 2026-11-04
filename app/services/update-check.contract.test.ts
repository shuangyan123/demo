import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "../api/updates/mock/route.ts";
import { readMockUpdate } from "../server/updates/mock-source.ts";
import { REVIEW_WORKSPACE_VERSION } from "../config/app-metadata.ts";
import { assessMockUpdate, UPDATE_METADATA_MAX_BYTES } from "./update-metadata.ts";
import { checkMockUpdate } from "./update-check-client.ts";

const source = readMockUpdate("available").source;
const metadata = JSON.parse(source);
const assess = (change: object, current = "0.3.1") => assessMockUpdate(JSON.stringify({ ...metadata, ...change }), current);

test("stable version comparison is numeric, current and older never become upgrades", () => {
  assert.equal(assess({ version: "0.3.10" }, "0.3.9").kind, "available");
  assert.equal(assess({}, "0.3.2").kind, "current");
  assert.equal(assess({}, "0.4.0").kind, "ahead");
  assert.equal(assess({ version: "0.3.0", minimumCurrentVersion: "0.3.0" }).kind, "ahead");
});
test("unsupported targets, major version, minimum version and current version fail closed", () => {
  for (const change of [{ platform: "linux" }, { arch: "arm64" }, { installer: "squirrel" },
    { version: "1.0.0" }, { minimumCurrentVersion: "0.3.2" }]) assert.equal(assess(change).kind, "incompatible");
  assert.equal(assess({}, "unavailable").kind, "incompatible");
});
for (const invalid of ["v0.3.2", "0.03.2", "0.3", "0.3.2-rc.1", "0.3.2+build", "0.3.2\n", "0.3.-2", "9007199254740992.0.0", 302])
  test(`version syntax rejects ${JSON.stringify(invalid)}`, () => assert.equal(assess({ version: invalid }).kind, "invalid"));
test("strict schema denies unknown fields, sources, installer URLs, malformed and oversized payloads", () => {
  for (const change of [{ schemaVersion: 2 }, { product: "foreign" }, { channel: "stable" }, { downloadUrl: "https://unapproved.test/setup.exe" },
    { sha256: "0".repeat(64) }, { arch: null }, { releaseNotes: "" }, { releaseNotes: "secret\u0000" },
    { releaseNotes: "x".repeat(2001) }, { minimumCurrentVersion: "0.4.0" }]) assert.equal(assess(change).kind, "invalid");
  for (const value of ["{}", "[]", "null", "{", " ".repeat(UPDATE_METADATA_MAX_BYTES) + source])
    assert.equal(assessMockUpdate(value, "0.3.1").kind, "invalid");
});
test("duplicate keys including Unicode aliases are rejected, quoted prose remains plain data", () => {
  for (const key of ['"version"', '"ver\\u0073ion"'])
    assert.equal(assessMockUpdate(source.replace('{', `{${key}:"9.0.0",`), "0.3.1").kind, "invalid");
  assert.equal(assess({ releaseNotes: '示例："version": "0.3.2"\n<script>no execution</script>' }).kind, "available");
});
test("fixed mock source is disabled by default; invalid env cannot select a URL", async () => {
  for (const value of [undefined, "", "https://example.test", "file:///secret", "../../private"])
    assert.equal(readMockUpdate(value).status, 409);
  for (const value of ["available", "current", "older", "incompatible", "invalid"]) assert.equal(readMockUpdate(value).status, 200);
  assert.equal(readMockUpdate("failure").status, 503);
  const response = GET(new Request("http://localhost/api/updates/mock?url=https://example.test"));
  assert.equal(response.status, 400); assert.equal(response.headers.get("cache-control"), "no-store");
});
test("packaged standalone denies every explicit mock scenario, including authenticated requests", async t => {
  const token = "synthetic-packaged-runtime-token";
  t.mock.property(process, "env", { ...process.env, REVIEW_DESKTOP_RUNTIME_TOKEN: token });
  const request = new Request("http://localhost/api/updates/mock", { headers: { "x-review-runtime-token": token } });
  for (const scenario of ["available", "current", "older", "incompatible", "invalid", "failure"]) {
    process.env.RECALL_UPDATE_MOCK_SCENARIO = scenario;
    const response = GET(request);
    assert.equal(response.status, 409, scenario);
    assert.deepEqual(await response.json(), { code: "mock_disabled" });
  }
});
for (const mode of ["development", "test", "production"] as const) {
  test(`independent Web server preserves controlled mock scenarios in ${mode} mode`, async t => {
    t.mock.property(process, "env", { ...process.env, NODE_ENV: mode });
    delete process.env.REVIEW_DESKTOP_RUNTIME_TOKEN;
    const request = new Request("http://localhost/api/updates/mock");
    for (const scenario of ["available", "current", "older", "incompatible", "invalid", "failure", "unknown"]) {
      process.env.RECALL_UPDATE_MOCK_SCENARIO = scenario;
      const response = GET(request);
      const expected = readMockUpdate(scenario);
      assert.equal(response.status, expected.status, scenario);
      assert.equal(await response.text(), expected.source, scenario);
    }
  });
}
test("packaged Main cannot switch to a development renderer and always supplies the child token", () => {
  const main = readFileSync("desktop/main.ts", "utf8");
  assert.match(main, /developmentUrl = app\.isPackaged \? undefined : process\.env\.ELECTRON_RENDERER_URL/);
  assert.match(main, /if \(app\.isPackaged\) \{\s*runtime = await startDesktopRuntime\(storageConfig\)/);
  assert.match(main, /mainWindow\.loadURL\(developmentUrl \?\? DESKTOP_ENTRY_URL\)/);
  const host = readFileSync("desktop/runtime.ts", "utf8");
  assert.match(host, /const token = randomBytes\(32\)/);
  assert.match(host, /\.\.\.desktopRuntimeEnvironment\(process\.env\),[^}]+REVIEW_DESKTOP_RUNTIME_TOKEN: token/);
});
test("client calls only the fixed same-origin metadata endpoint without credentials or redirects", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++; assert.equal(url, "/api/updates/mock"); assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); assert.ok(init.signal);
    return new Response(source, { headers: { "content-type": "application/json" } });
  });
  assert.equal((await checkMockUpdate()).kind, "available"); assert.equal(calls, 1);
});
test("client distinguishes disabled, failed and invalid, with no automatic retries", async t => {
  let status = 409, calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("broken", { status, headers: { "content-type": "application/json" } }); });
  assert.equal((await checkMockUpdate()).kind, "disabled");
  status = 503; assert.equal((await checkMockUpdate()).kind, "failed");
  status = 200; assert.equal((await checkMockUpdate()).kind, "invalid"); assert.equal(calls, 3);
});
test("streaming limit cancels undeclared oversized responses and rejects HTML", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(UPDATE_METADATA_MAX_BYTES + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } }));
  assert.equal((await checkMockUpdate()).kind, "invalid"); assert.equal(cancelled, true);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response(source, { headers: { "content-type": "text/html" } }));
  assert.equal((await checkMockUpdate()).kind, "invalid");
});
test("network rejection and caller abort return a stable failure without leaking errors", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    init.signal?.throwIfAborted(); throw new Error("secret internal address");
  });
  assert.deepEqual(await checkMockUpdate(), { kind: "failed" });
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await checkMockUpdate(controller.signal), { kind: "failed" });
});
test("slice has no download/install/IO capability and reuses the existing version source", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(REVIEW_WORKSPACE_VERSION, pkg.version);
  for (const file of ["app/server/updates/mock-source.ts", "app/api/updates/mock/route.ts", "app/services/update-metadata.ts", "app/services/update-check-client.ts", "app/features/settings/update-check-panel.tsx"]) {
    const code = readFileSync(file, "utf8");
    assert.doesNotMatch(code, /node:fs|node:child_process|electron-updater|autoUpdater|reviewDesktop|localStorage|indexedDB|\/db\/|downloadURL|shell\.|dangerouslySetInnerHTML/);
    if (file.includes("/server/") || file.includes("/api/")) assert.doesNotMatch(code, /\bfetch\(|https?:\/\//);
  }
});
