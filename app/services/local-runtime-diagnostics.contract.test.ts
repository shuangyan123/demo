import assert from "node:assert/strict";
import test from "node:test";
import {
  clearLocalRuntimeDiagnostics,
  fetchLocalApi,
  listLocalRuntimeDiagnostics,
} from "./local-runtime-diagnostics.ts";

test("本机 API 诊断只记录路由类别、阶段、耗时、状态和错误类别", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: "rate_limited", token: "should-not-be-recorded" }, { status: 429 });
  try {
    clearLocalRuntimeDiagnostics();
    await fetchLocalApi("/api/ai/generate?credential=hidden", {
      body: JSON.stringify({ prompt: "private prompt", apiKey: "sk-secret" }),
      method: "POST",
    });
    const [entry] = listLocalRuntimeDiagnostics();
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["createdAt", "durationMs", "errorCode", "id", "route", "stage", "status"].sort(),
    );
    assert.equal(entry.route, "/api/ai/generate");
    assert.equal(entry.errorCode, "rate_limited");
    assert.equal(entry.status, 429);
    assert.doesNotMatch(JSON.stringify(entry), /private prompt|sk-secret|should-not-be-recorded|credential/);
  } finally {
    globalThis.fetch = originalFetch;
    clearLocalRuntimeDiagnostics();
  }
});

test("本机 API 诊断始终保持 50 条有界快照", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    clearLocalRuntimeDiagnostics();
    for (let index = 0; index < 55; index += 1) {
      await fetchLocalApi(`/api/test/${index}`);
    }
    const entries = listLocalRuntimeDiagnostics();
    assert.equal(entries.length, 50);
    assert.equal(entries[0]?.route, "/api/test/5");
    entries.splice(0);
    assert.equal(listLocalRuntimeDiagnostics().length, 50);
  } finally {
    globalThis.fetch = originalFetch;
    clearLocalRuntimeDiagnostics();
  }
});
