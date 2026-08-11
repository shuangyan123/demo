import assert from "node:assert/strict";
import test from "node:test";
import { trialAutomationDefinition } from "./automation-executor.ts";
import {
  AutomationAuthorizationError,
  createUnattendedExecutionAuditSummary,
  resolveAutomationExternalAuthorization,
  type McpAuthorizationResource,
} from "./automation-external-authorization.ts";
import {
  automationExecutionCause,
  automationExternalExecution,
  AutomationExecutionProgressError,
  mergeAutomationExternalExecution,
  wrapAutomationExecutionProgress,
} from "./automation-errors.ts";
import type { AutomationDefinition, AutomationExternalExecutionSummary } from "../types/domains/automation.ts";
import type { AcquisitionMcpSource, AcquisitionUrlSource } from "../types/domains/acquisition.ts";
import { createDefaultPersonalizationSettings } from "./personalization-settings-repository.ts";

const now = "2026-08-11T00:00:00.000Z";

function definition(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "task-1",
    name: "外部采集",
    templateId: "xingce_collection",
    prompt: "整理白名单资料",
    sourceScopes: [],
    collectionConfig: {
      domain: "xingce",
      queries: ["行测 方法"],
      allowedOrigins: ["https://example.com"],
      sources: [{
        id: "source-1",
        label: "公开来源",
        enabled: true,
        kind: "url",
        urls: ["https://example.com/article"],
        allowedOrigins: ["https://example.com"],
        authority: "official",
        contentPolicy: "summary_only",
      }],
      freshnessDays: 30,
      maxDocuments: 10,
    },
    enabled: true,
    timeZone: "Asia/Shanghai",
    schedule: { kind: "daily", time: "08:00" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mcpDefinition(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return definition({
    collectionConfig: {
      domain: "xingce",
      queries: ["行测 方法"],
      allowedOrigins: ["https://example.com"],
      sources: [{
        id: "mcp-source",
        label: "MCP 搜索",
        enabled: true,
        kind: "mcp_search",
        serverId: "server-a",
        toolName: "search-y",
        argumentTemplate: '{"query":"{{query}}"}',
        allowedOrigins: ["https://example.com"],
        authority: "other",
        contentPolicy: "summary_only",
      }],
      freshnessDays: 30,
      maxDocuments: 10,
    },
    ...overrides,
  });
}

function mcpResource(overrides: Partial<McpAuthorizationResource> = {}): McpAuthorizationResource {
  return {
    serverId: "server-a",
    enabled: true,
    discoveryStatus: "ready",
    tools: [{ name: "search-y", permission: "allow_scheduled" }],
    ...overrides,
  };
}

test("没有外部来源声明的普通自动化无需新增无人值守权限", () => {
  const result = resolveAutomationExternalAuthorization({ ...definition(), collectionConfig: undefined, templateId: "daily_review", sourceScopes: ["mistakes"] });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.requirements, []);
  assert.deepEqual(result.reasonCodes, ["authorization_ready"]);
});

test("声明的 MCP server/tool、启用状态、发现状态和 allow_scheduled 全部满足才 ready", () => {
  const result = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource()] });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.requirements.map((item) => item.kind), ["mcp_tool", "http_origin"]);
  assert.deepEqual(result.reasonCodes, ["authorization_ready"]);
});

test("ask、deny 和 session grant 都不能作为 scheduled backdoor", () => {
  for (const permission of ["ask", "deny", "allow_session"] as const) {
    const result = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ tools: [{ name: "search-y", permission }] })] });
    assert.equal(result.status, "blocked", permission);
    assert.deepEqual(result.missingPermissions, ["server-a:search-y"]);
    assert.equal(result.reasonCodes.includes("mcp_permission_missing"), true);
  }
});

test("Server disabled、discovery stale 和 tool removed 都保留配置但阻断本次执行", () => {
  const disabled = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ enabled: false })] });
  assert.equal(disabled.status, "blocked");
  assert.deepEqual(disabled.disabledResources, ["server-a"]);
  assert.equal(disabled.reasonCodes.includes("mcp_server_disabled"), true);

  const stale = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ discoveryStatus: "error" })] });
  assert.equal(stale.status, "blocked");
  assert.deepEqual(stale.staleResources, ["server-a"]);
  assert.equal(stale.reasonCodes.includes("mcp_discovery_not_ready"), true);

  const removed = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ tools: [] })] });
  assert.equal(removed.status, "blocked");
  assert.deepEqual(removed.staleResources, ["server-a:search-y"]);
  assert.equal(removed.reasonCodes.includes("mcp_tool_missing"), true);
});

test("任务声明 A/Y 不会因 A/X 拥有 allow_scheduled 而越权", () => {
  const result = resolveAutomationExternalAuthorization(mcpDefinition(), {
    mcpResources: [mcpResource({ tools: [{ name: "search-x", permission: "allow_scheduled" }] })],
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.staleResources, ["server-a:search-y"]);
  assert.deepEqual(result.missingPermissions, []);
});

test("无效 origin、空来源和非法 MCP JSON 模板在任何外部调用前 invalid", () => {
  const urlSource = definition().collectionConfig!.sources[0] as AcquisitionUrlSource;
  const outside = resolveAutomationExternalAuthorization(definition({ collectionConfig: {
    ...definition().collectionConfig!,
    sources: [{ ...urlSource, urls: ["https://outside.test/article"] }],
  } }));
  assert.equal(outside.status, "invalid");
  assert.equal(outside.reasonCodes.includes("origin_not_allowed"), true);

  const mcpSource = mcpDefinition().collectionConfig!.sources[0] as AcquisitionMcpSource;
  const invalidTemplate = resolveAutomationExternalAuthorization(mcpDefinition({ collectionConfig: {
    ...mcpDefinition().collectionConfig!,
    sources: [{ ...mcpSource, argumentTemplate: "[]" }],
  } }));
  assert.equal(invalidTemplate.status, "invalid");
  assert.equal(invalidTemplate.reasonCodes.includes("source_invalid"), true);
});

test("损坏的 collection 定义在解析阶段 invalid，而不是落入运行期异常", () => {
  const malformed = definition({ collectionConfig: {
    ...definition().collectionConfig!,
    queries: undefined as unknown as string[],
  } });
  const result = resolveAutomationExternalAuthorization(malformed);
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.invalidScopes, ["collectionConfig"]);
  assert.deepEqual(result.reasonCodes, ["source_invalid"]);
});

test("授权撤销和 origin 变更在下一次解析立即生效", () => {
  const ready = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource()] });
  assert.equal(ready.status, "ready");
  assert.equal(resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ tools: [{ name: "search-y", permission: "ask" }] })] }).status, "blocked");
  assert.equal(resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ enabled: false })] }).status, "blocked");
  assert.equal(resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ tools: [] })] }).status, "blocked");
  const changedOrigin = mcpDefinition({ collectionConfig: { ...mcpDefinition().collectionConfig!, allowedOrigins: ["https://new.example"] } });
  assert.equal(resolveAutomationExternalAuthorization(changedOrigin, { mcpResources: [mcpResource()] }).status, "invalid");
});

test("blocked trial 在 preflight 失败，不读取连接、不请求 MCP 或 acquisition route", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("external call must not happen");
  }) as typeof fetch;
  try {
    await assert.rejects(() => trialAutomationDefinition({
      definition: mcpDefinition(),
      personalization: createDefaultPersonalizationSettings(new Date(now)),
    }), AutomationAuthorizationError);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("最小审计包含身份、资源计数与终态，但不包含秘密、参数、原始结果或正文", () => {
  const authorization = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource()] });
  const audit = createUnattendedExecutionAuditSummary({
    taskId: "task-1",
    runId: "run-1",
    mode: "scheduled",
    startedAt: now,
    finishedAt: now,
    authorization,
    execution: {
      sourceKinds: ["mcp_search", "url"],
      mcpTools: [{ serverId: "server-a", toolName: "search-y" }],
      httpOrigins: ["https://example.com"],
      externalCallCount: 3,
      successfulCallCount: 2,
      failedCallCount: 1,
    },
    proposalCount: 2,
    terminalState: "succeeded",
  });
  assert.equal(audit.taskId, "task-1");
  assert.equal(audit.runId, "run-1");
  assert.deepEqual(audit.mcpTools, [{ serverId: "server-a", toolName: "search-y" }]);
  assert.deepEqual(audit.httpOrigins, ["https://example.com"]);
  assert.equal(audit.externalCallCount, 3);
  assert.equal(audit.proposalCount, 2);
  assert.equal(audit.terminalState, "succeeded");
  assert.equal(audit.reasonCodes.includes("completed"), true);
  const serialized = JSON.stringify(audit);
  assert.doesNotMatch(serialized, /secret|bearer|raw-result|完整正文|query-value/);
});

test("blocked audit 明确原因且外部调用数为零；部分运行保留失败计数", () => {
  const blockedAuthorization = resolveAutomationExternalAuthorization(mcpDefinition(), { mcpResources: [mcpResource({ tools: [{ name: "search-y", permission: "ask" }] })] });
  const blocked = createUnattendedExecutionAuditSummary({ taskId: "task-1", runId: "run-blocked", mode: "scheduled", startedAt: now, authorization: blockedAuthorization, proposalCount: 0, terminalState: "blocked" });
  assert.equal(blocked.authorization, "blocked");
  assert.equal(blocked.externalCallCount, 0);
  assert.equal(blocked.failedCallCount, 0);
  assert.equal(blocked.reasonCodes.includes("mcp_permission_missing"), true);

  const partial = createUnattendedExecutionAuditSummary({
    taskId: "task-1", runId: "run-partial", mode: "scheduled", startedAt: now,
    authorization: resolveAutomationExternalAuthorization(definition()),
    execution: { sourceKinds: ["url"], mcpTools: [], httpOrigins: ["https://example.com"], externalCallCount: 2, successfulCallCount: 1, failedCallCount: 1 },
    proposalCount: 1,
    terminalState: "succeeded",
  });
  assert.equal(partial.failedCallCount, 1);
  assert.equal(partial.reasonCodes.includes("runtime_failed"), true);
});

test("typed external progress preserves the sanitized summary without double counting", () => {
  const cause = new Error("provider-raw-result secret-token-123");
  const summary: AutomationExternalExecutionSummary = {
    sourceKinds: ["mcp_search"],
    mcpTools: [{ serverId: "server-a", toolName: "search-y" }],
    httpOrigins: ["https://example.com"],
    externalCallCount: 1,
    successfulCallCount: 1,
    failedCallCount: 0,
  };
  const progress = new AutomationExecutionProgressError(cause, summary);
  const wrapped = wrapAutomationExecutionProgress(progress, summary);

  assert.equal(wrapped, progress);
  assert.equal(automationExecutionCause(progress), cause);
  assert.deepEqual(automationExternalExecution(progress), summary);
  assert.deepEqual(mergeAutomationExternalExecution(summary, {
    ...summary,
    sourceKinds: ["ai"],
    mcpTools: [],
    httpOrigins: [],
    externalCallCount: 1,
    successfulCallCount: 0,
    failedCallCount: 1,
  }), {
    sourceKinds: ["mcp_search", "ai"],
    mcpTools: summary.mcpTools,
    httpOrigins: summary.httpOrigins,
    externalCallCount: 2,
    successfulCallCount: 1,
    failedCallCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(automationExternalExecution(progress)), /provider-raw-result|secret-token-123/);
});
