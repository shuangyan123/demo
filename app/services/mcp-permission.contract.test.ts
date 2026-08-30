import assert from "node:assert/strict";
import test from "node:test";
import { decideMcpToolPermission, normalizeMcpPersistedPermission, summarizeMcpPermission } from "./mcp-permission.ts";
import { executeMcpTool } from "./mcp-execution.ts";
import { clearAllMcpSessionPermissionsForTest, clearMcpSessionPermissions, grantMcpSessionPermission, hasMcpSessionPermission, retainMcpSessionPermissions, revokeMcpSessionPermission } from "./mcp-session-permission-store.ts";

test("MCP permission core covers the four policies without side effects", () => {
  assert.equal(decideMcpToolPermission({ policy: "deny", sessionGrantPresent: true, mode: "interactive", confirmed: true }), "denied");
  assert.equal(decideMcpToolPermission({ policy: "deny", sessionGrantPresent: false, mode: "scheduled", confirmed: false }), "denied");

  assert.equal(decideMcpToolPermission({ policy: "ask", sessionGrantPresent: false, mode: "interactive", confirmed: false }), "confirmation_required");
  assert.equal(decideMcpToolPermission({ policy: "ask", sessionGrantPresent: false, mode: "interactive", confirmed: true }), "allowed");
  assert.equal(decideMcpToolPermission({ policy: "ask", sessionGrantPresent: false, mode: "scheduled", confirmed: true }), "denied");

  assert.equal(decideMcpToolPermission({ policy: "ask", sessionGrantPresent: true, mode: "interactive", confirmed: false }), "allowed");
  assert.equal(decideMcpToolPermission({ policy: "ask", sessionGrantPresent: true, mode: "scheduled", confirmed: false }), "denied");

  assert.equal(decideMcpToolPermission({ policy: "allow_scheduled", sessionGrantPresent: false, mode: "scheduled", confirmed: false }), "allowed");
  assert.equal(decideMcpToolPermission({ policy: "allow_scheduled", sessionGrantPresent: false, mode: "interactive", confirmed: false }), "confirmation_required");
  assert.equal(decideMcpToolPermission({ policy: "allow_scheduled", sessionGrantPresent: false, mode: "interactive", confirmed: true }), "allowed");
});

test("legacy persisted allow_session is a conservative ask policy", () => {
  assert.equal(normalizeMcpPersistedPermission("allow_session"), "ask");
  assert.equal(normalizeMcpPersistedPermission("unexpected"), "ask");
  assert.equal(normalizeMcpPersistedPermission("deny"), "deny");
  assert.equal(normalizeMcpPersistedPermission("allow_scheduled"), "allow_scheduled");
});

test("Composer 权限摘要只投影真实 MCP 工具策略，不伪造完全访问等级", () => {
  const base = { profiles: [{ id: "server-a" }], discovery: {} };
  assert.equal(summarizeMcpPermission({ profiles: [], discovery: {} }), "未配置");
  assert.equal(summarizeMcpPermission(base), "未发现工具");
  assert.equal(summarizeMcpPermission({
    profiles: base.profiles,
    discovery: { "server-a": { toolDescriptors: [{ permission: "ask" }, { permission: "ask" }] } },
  }), "每次询问");
  assert.equal(summarizeMcpPermission({
    profiles: base.profiles,
    discovery: { "server-a": { toolDescriptors: [{ permission: "allow_session" }] } },
  }), "本次会话允许");
  assert.equal(summarizeMcpPermission({
    profiles: base.profiles,
    discovery: { "server-a": { toolDescriptors: [{ permission: "allow_scheduled" }] } },
  }), "允许已安排任务");
  assert.equal(summarizeMcpPermission({
    profiles: base.profiles,
    discovery: { "server-a": { toolDescriptors: [{ permission: "deny" }] } },
  }), "禁止");
  assert.equal(summarizeMcpPermission({
    profiles: base.profiles,
    discovery: { "server-a": { toolDescriptors: [{ permission: "ask" }, { permission: "deny" }] } },
  }), "按工具设置");
});

test("session grants are exact server/tool pairs and can be revoked", () => {
  clearAllMcpSessionPermissionsForTest();
  grantMcpSessionPermission("server-a", "tool-x");
  assert.equal(hasMcpSessionPermission("server-a", "tool-x"), true);
  assert.equal(hasMcpSessionPermission("server-a", "tool-y"), false);
  assert.equal(hasMcpSessionPermission("server-b", "tool-x"), false);

  revokeMcpSessionPermission("server-a", "tool-x");
  assert.equal(hasMcpSessionPermission("server-a", "tool-x"), false);

  grantMcpSessionPermission("server-a", "tool-x");
  grantMcpSessionPermission("server-a", "tool-y");
  retainMcpSessionPermissions("server-a", ["tool-x"]);
  assert.equal(hasMcpSessionPermission("server-a", "tool-x"), true);
  assert.equal(hasMcpSessionPermission("server-a", "tool-y"), false);
  clearMcpSessionPermissions("server-a");
  assert.equal(hasMcpSessionPermission("server-a", "tool-x"), false);
  clearAllMcpSessionPermissionsForTest();
});

test("execution boundary rejects deny without resolving credentials or requesting the route", async () => {
  let tokenCalls = 0;
  let requestCalls = 0;
  await assert.rejects(
    () => executeMcpTool(
      "server-a",
      "tool-x",
      {},
      { mode: "interactive", confirmed: true },
      {
        readSnapshot: () => ({
          profiles: [{ id: "server-a", label: "Server A", endpoint: "https://mcp.example.com/mcp", enabled: true, authMode: "none", createdAt: "", updatedAt: "" }],
          discovery: {
            "server-a": { serverId: "server-a", status: "ready", tools: ["tool-x"], resources: [], prompts: [], message: "ready", toolDescriptors: [{ name: "tool-x", permission: "deny" }],
            },
          },
        }),
        tokenFor: async () => { tokenCalls += 1; return "secret"; },
        requestJson: async () => { requestCalls += 1; return { result: {} }; },
      },
    ),
    /禁止/,
  );
  assert.equal(tokenCalls, 0);
  assert.equal(requestCalls, 0);
});
