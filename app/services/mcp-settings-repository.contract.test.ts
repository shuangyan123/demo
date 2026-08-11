import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";
import { clearAllMcpSessionPermissionsForTest } from "./mcp-session-permission-store.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";

const values = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => void values.delete(key), setItem: (key, value) => void values.set(key, value),
};

Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: localStorageMock } });

test("MCP settings persist encrypted profiles and sanitized discovery summaries without Dexie", async () => {
  values.clear();
  clearAllMcpSessionPermissionsForTest();
  const originalFetch = globalThis.fetch;
  let callRequests = 0;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body || "{}")) as { tool?: string };
    const body = payload.tool
      ? (callRequests += 1, { result: { content: [{ type: "text", text: "https://www.gov.cn/" }] } })
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

    mcpSettingsRepository.setToolPermission(profile.id, "future-tool", "allow_session");
    const futureToolSnapshot = JSON.parse(values.get(secretStorageLocations.mcpSettings) ?? "{}") as { discovery: Record<string, { tools: string[]; toolDescriptors: Array<{ name: string; permission: string }> }> };
    futureToolSnapshot.discovery[profile.id].tools.push("future-tool");
    futureToolSnapshot.discovery[profile.id].toolDescriptors.push({ name: "future-tool", permission: "ask" });
    values.set(secretStorageLocations.mcpSettings, JSON.stringify(futureToolSnapshot));
    assert.equal(mcpSettingsRepository.load().discovery[profile.id]?.toolDescriptors?.find((tool) => tool.name === "future-tool")?.permission, "ask");

    mcpSettingsRepository.setToolPermission(profile.id, "search", "deny");
    const validDeniedSnapshot = values.get(secretStorageLocations.mcpSettings) ?? "";
    const invalidCredentialSnapshot = JSON.parse(validDeniedSnapshot) as { profiles: Array<{ id: string; encryptedToken?: string; encryptedTokenIv?: string }> };
    const invalidCredentialProfile = invalidCredentialSnapshot.profiles.find((item) => item.id === profile.id);
    if (invalidCredentialProfile) {
      invalidCredentialProfile.encryptedToken = "invalid-ciphertext";
      invalidCredentialProfile.encryptedTokenIv = "invalid-iv";
      values.set(secretStorageLocations.mcpSettings, JSON.stringify(invalidCredentialSnapshot));
    }
    await assert.rejects(
      () => mcpSettingsRepository.callTool(profile, "search", {}, { mode: "interactive", confirmed: true }),
      /禁止/,
    );
    assert.equal(callRequests, 0);

    values.set(secretStorageLocations.mcpSettings, validDeniedSnapshot);
    mcpSettingsRepository.setToolPermission(profile.id, "search", "ask");
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", { query: "申论" }), /未获得定时任务授权/);
    await assert.rejects(
      () => mcpSettingsRepository.callTool(profile, "search", {}, { mode: "interactive", confirmed: false }),
      /需要本次用户确认/,
    );
    assert.equal(callRequests, 0);

    const confirmedResult = await mcpSettingsRepository.callTool(profile, "search", {}, { mode: "interactive", confirmed: true });
    assert.equal(typeof confirmedResult, "object");
    assert.equal(callRequests, 1);
    assert.equal([...values.values()].some((value) => value.includes("https://www.gov.cn/")), false);

    mcpSettingsRepository.setToolPermission(profile.id, "search", "allow_session");
    assert.equal(mcpSettingsRepository.load().discovery[profile.id]?.toolDescriptors?.[0]?.permission, "allow_session");
    const persistedAfterSessionGrant = JSON.parse(values.get(secretStorageLocations.mcpSettings) ?? "{}") as { discovery?: Record<string, { toolDescriptors?: Array<{ permission?: string }> }> };
    assert.equal(persistedAfterSessionGrant.discovery?.[profile.id]?.toolDescriptors?.[0]?.permission, "ask");
    await mcpSettingsRepository.callTool(profile, "search", {}, { mode: "interactive", confirmed: false });
    assert.equal(callRequests, 2);
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", {}), /未获得定时任务授权/);
    assert.equal(callRequests, 2);

    const legacySnapshot = JSON.parse(values.get(secretStorageLocations.mcpSettings) ?? "{}") as { discovery: Record<string, { toolDescriptors: Array<{ permission: string }> }> };
    legacySnapshot.discovery[profile.id].toolDescriptors[0].permission = "allow_session";
    values.set(secretStorageLocations.mcpSettings, JSON.stringify(legacySnapshot));
    clearAllMcpSessionPermissionsForTest();
    assert.equal(mcpSettingsRepository.load().discovery[profile.id]?.toolDescriptors?.[0]?.permission, "ask");
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", {}), /未获得定时任务授权/);
    mcpSettingsRepository.setToolPermission(profile.id, "search", "ask");
    const canonicalSnapshot = JSON.parse(values.get(secretStorageLocations.mcpSettings) ?? "{}") as { discovery: Record<string, { toolDescriptors: Array<{ permission: string }> }> };
    assert.equal(canonicalSnapshot.discovery[profile.id].toolDescriptors[0].permission, "ask");

    mcpSettingsRepository.setToolPermission(profile.id, "search", "allow_scheduled");
    const scheduledResult = await mcpSettingsRepository.callScheduledTool(profile.id, "search", { query: "申论" });
    assert.equal(typeof scheduledResult, "object");
    assert.equal(callRequests, 3);
    await mcpSettingsRepository.callTool(profile, "search", {}, { mode: "interactive", confirmed: true });
    assert.equal(callRequests, 4);

    const readySnapshot = values.get(secretStorageLocations.mcpSettings) ?? "";
    const staleToolSnapshot = JSON.parse(readySnapshot) as { discovery: Record<string, { status: string; tools: string[]; toolDescriptors?: Array<{ name: string; permission: string }> }> };
    staleToolSnapshot.discovery[profile.id].tools = [];
    staleToolSnapshot.discovery[profile.id].toolDescriptors = [];
    values.set(secretStorageLocations.mcpSettings, JSON.stringify(staleToolSnapshot));
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", {}), /不存在或已从 Server 移除/);
    assert.equal(callRequests, 4);

    const notReadySnapshot = JSON.parse(readySnapshot) as { discovery: Record<string, { status: string }> };
    notReadySnapshot.discovery[profile.id].status = "untested";
    values.set(secretStorageLocations.mcpSettings, JSON.stringify(notReadySnapshot));
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", {}), /尚未通过连接发现/);
    assert.equal(callRequests, 4);
    values.set(secretStorageLocations.mcpSettings, readySnapshot);

    await mcpSettingsRepository.saveProfile({ id: profile.id, label: profile.label, endpoint: profile.endpoint, enabled: false, authMode: "bearer" });
    await assert.rejects(() => mcpSettingsRepository.callScheduledTool(profile.id, "search", {}), /Server 未启用/);
    await assert.rejects(() => mcpSettingsRepository.callTool(profile, "search", {}, { mode: "interactive", confirmed: true }), /Server 未启用/);
    mcpSettingsRepository.removeProfile(profile.id);
    const stable = await mcpSettingsRepository.saveProfile({ id: "ui-review:integrations:mcp-search", label: "UI 审查", endpoint: "https://ui-review.invalid/mcp", enabled: false, authMode: "none" });
    assert.equal(stable.id, "ui-review:integrations:mcp-search");
    await mcpSettingsRepository.saveProfile({ id: stable.id, label: stable.label, endpoint: stable.endpoint, enabled: false, authMode: "none" });
    assert.equal(mcpSettingsRepository.load().profiles.filter((item) => item.id === stable.id).length, 1);
    mcpSettingsRepository.removeProfile(stable.id);
    assert.equal(mcpSettingsRepository.load().profiles.length, 0);
  } finally {
    clearAllMcpSessionPermissionsForTest();
    globalThis.fetch = originalFetch;
  }
});

test.after(() => {
  clearAllMcpSessionPermissionsForTest();
  Reflect.deleteProperty(globalThis, "window");
});
