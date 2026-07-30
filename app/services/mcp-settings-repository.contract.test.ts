import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";

const values = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => void values.delete(key), setItem: (key, value) => void values.set(key, value),
};

Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: localStorageMock } });

test("MCP settings persist encrypted profiles and sanitized discovery summaries without Dexie", async () => {
  values.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body || "{}")) as { tool?: string };
    const body = payload.tool
      ? { result: { content: [{ type: "text", text: "https://www.gov.cn/" }] } }
      : { tools: [{ name: "search", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }], resources: [{ name: "docs" }], prompts: [{ name: "summarize" }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const profile = await mcpSettingsRepository.saveProfile({ label: "Bridge", endpoint: "http://127.0.0.1:8765/mcp?token=secret", enabled: true, authMode: "bearer", token: "secret-token" });
    assert.equal(profile.endpoint, "http://127.0.0.1:8765/mcp");
    assert.equal(profile.enabled, false);
    assert.equal(profile.encryptedToken?.includes("secret-token"), false);
    const result = await mcpSettingsRepository.discover(profile);
    assert.equal(result.status, "ready");
    assert.equal(result.toolDescriptors?.[0]?.permission, "ask");
    assert.equal(values.values().next().value?.includes("secret-token"), false);
    await mcpSettingsRepository.saveProfile({ id: profile.id, label: profile.label, endpoint: profile.endpoint, enabled: true, authMode: "bearer" });
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", { query: "申论" }), /未获得定时任务授权/);
    mcpSettingsRepository.setToolPermission(profile.id, "search", "allow_scheduled");
    const scheduledResult = await mcpSettingsRepository.callScheduledTool(profile.id, "search", { query: "申论" });
    assert.equal(typeof scheduledResult, "object");
    await mcpSettingsRepository.saveProfile({ id: profile.id, label: profile.label, endpoint: profile.endpoint, enabled: false, authMode: "bearer" });
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", {}), /Server 未启用/);
    mcpSettingsRepository.removeProfile(profile.id);
    const stable = await mcpSettingsRepository.saveProfile({ id: "ui-review:integrations:mcp-search", label: "UI 审查", endpoint: "https://ui-review.invalid/mcp", enabled: false, authMode: "none" });
    assert.equal(stable.id, "ui-review:integrations:mcp-search");
    await mcpSettingsRepository.saveProfile({ id: stable.id, label: stable.label, endpoint: stable.endpoint, enabled: false, authMode: "none" });
    assert.equal(mcpSettingsRepository.load().profiles.filter((item) => item.id === stable.id).length, 1);
    mcpSettingsRepository.removeProfile(stable.id);
    assert.equal(mcpSettingsRepository.load().profiles.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test.after(() => { Reflect.deleteProperty(globalThis, "window"); });
