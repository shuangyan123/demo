import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalDiagnostics, type BrowserCapabilitySnapshot, type LocalDiagnosticsInput } from "./use-local-diagnostics.ts";
import type { AiConnectionSnapshot, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AutomationDefinition, AutomationRun, AutomationSnapshot } from "../../types/domains/automation.ts";
import type { ObsidianVaultSnapshot } from "../../types/domains/obsidian.ts";

const now = "2026-06-29T08:00:00.000Z";

function browser(overrides: Partial<BrowserCapabilitySnapshot> = {}): BrowserCapabilitySnapshot {
  return {
    clipboard: true,
    fileSystemAccess: true,
    host: "127.0.0.1:4320",
    indexedDb: true,
    notificationPermission: "default",
    notifications: true,
    online: true,
    secureContext: true,
    userAgent: "diagnostics-test",
    webLocks: true,
    ...overrides,
  };
}

function profile(id: string, capabilities: ApiConnectionProfile["capabilities"]): ApiConnectionProfile {
  return {
    id,
    apiFormat: "chat_completions",
    baseUrl: "http://127.0.0.1:9999/v1",
    capabilities,
    createdAt: now,
    encryptedKey: "secret-cipher",
    iv: "secret-iv",
    label: id,
    maskedKey: "sk-***",
    model: "test-model",
    provider: "custom",
    providerOptions: {},
    testStatus: "success",
    updatedAt: now,
  };
}

function aiSnapshot(overrides: Partial<AiConnectionSnapshot> = {}): AiConnectionSnapshot {
  return {
    defaults: { id: "default", updatedAt: now },
    profiles: [],
    ...overrides,
  };
}

function automationDefinition(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "automation-1",
    createdAt: now,
    enabled: true,
    name: "每日复盘",
    prompt: "生成复盘摘要",
    schedule: { kind: "daily", time: "08:00" },
    sourceScopes: ["mistakes"],
    templateId: "daily_review",
    timeZone: "Asia/Shanghai",
    updatedAt: now,
    ...overrides,
  };
}

function failedRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "automation-1",
    automationName: "每日复盘",
    createdAt: now,
    error: "模型请求失败",
    missedCount: 0,
    proposalIds: [],
    scheduledAt: now,
    status: "failed",
    trigger: "manual",
    unread: true,
    ...overrides,
  };
}

function automationSnapshot(overrides: Partial<AutomationSnapshot> = {}): AutomationSnapshot {
  return {
    definitions: [],
    runs: [],
    unreadCount: 0,
    ...overrides,
  };
}

function obsidianSnapshot(overrides: Partial<ObsidianVaultSnapshot> = {}): ObsidianVaultSnapshot {
  return {
    id: "default",
    connected: false,
    conflictCount: 0,
    createdAt: now,
    managedRoot: "AI知识库",
    mappedCount: 0,
    pendingProposalCount: 0,
    permission: "denied",
    recovery: "none",
    updatedAt: now,
    vaultName: "",
    ...overrides,
  };
}

function input(overrides: Partial<LocalDiagnosticsInput> = {}): LocalDiagnosticsInput {
  return {
    aiSnapshot: aiSnapshot(),
    appVersion: "0.1.0",
    automationSnapshot: automationSnapshot(),
    browserCapabilities: browser(),
    generatedAt: now,
    importJobs: [],
    knowledgeEntryCount: 0,
    mistakeCount: 0,
    obsidianSnapshot: obsidianSnapshot(),
    ...overrides,
  };
}

test("诊断在缺少默认文本、多模态和语音连接时给出对应状态和恢复入口", () => {
  const diagnostics = buildLocalDiagnostics(input());
  const ai = diagnostics.sections.find((section) => section.id === "ai");

  assert.equal(diagnostics.status, "error");
  assert.equal(ai?.items.find((item) => item.id === "ai-text")?.status, "error");
  assert.equal(ai?.items.find((item) => item.id === "ai-vision")?.status, "warning");
  assert.equal(ai?.items.find((item) => item.id === "ai-speech")?.status, "warning");
  assert.equal(ai?.items.find((item) => item.id === "ai-text")?.action, "ai-connections");
});

test("诊断能识别 Obsidian unsupported、未连接、权限异常、冲突和待确认提案", () => {
  const unsupported = buildLocalDiagnostics(input({ obsidianSnapshot: obsidianSnapshot({ permission: "unsupported", recovery: "unsupported" }) }));
  const disconnected = buildLocalDiagnostics(input());
  const permission = buildLocalDiagnostics(input({ obsidianSnapshot: obsidianSnapshot({ connected: true, permission: "prompt", vaultName: "Vault" }) }));
  const conflict = buildLocalDiagnostics(input({ obsidianSnapshot: obsidianSnapshot({ connected: true, conflictCount: 2, permission: "granted", vaultName: "Vault" }) }));
  const proposal = buildLocalDiagnostics(input({ obsidianSnapshot: obsidianSnapshot({ connected: true, pendingProposalCount: 1, permission: "granted", vaultName: "Vault" }) }));

  assert.match(unsupported.report, /浏览器不支持目录桥接/);
  assert.match(disconnected.report, /尚未连接 Vault/);
  assert.match(permission.report, /Vault 权限需要恢复/);
  assert.match(conflict.report, /存在同步冲突/);
  assert.match(proposal.report, /存在待确认提案/);
});

test("诊断读取错误会进入报告且不阻断其他分组", () => {
  const diagnostics = buildLocalDiagnostics(input({ aiReadError: "AI 表读取失败", dataReadError: "IndexedDB 读取失败", obsidianError: "Vault 快照失败" }));

  assert.match(diagnostics.report, /AI 表读取失败/);
  assert.match(diagnostics.report, /IndexedDB 读取失败/);
  assert.match(diagnostics.report, /Vault 快照失败/);
  assert.equal(diagnostics.sections.length, 6);
});

test("诊断能展示自动化失败运行、未读结果和缺默认文本连接", () => {
  const diagnostics = buildLocalDiagnostics(
    input({
      automationSnapshot: automationSnapshot({
        definitions: [automationDefinition()],
        runs: [failedRun()],
        unreadCount: 1,
      }),
    }),
  );
  const automation = diagnostics.sections.find((section) => section.id === "automation");

  assert.equal(automation?.items.find((item) => item.id === "automation-no-text")?.status, "error");
  assert.match(diagnostics.report, /最近失败：每日复盘/);
  assert.match(diagnostics.report, /有未读运行结果/);
});

test("诊断能报告浏览器能力缺口", () => {
  const diagnostics = buildLocalDiagnostics(
    input({
      browserCapabilities: browser({
        clipboard: false,
        fileSystemAccess: false,
        indexedDb: false,
        notifications: false,
        online: false,
        secureContext: false,
        webLocks: false,
      }),
    }),
  );

  assert.match(diagnostics.report, /IndexedDB 不可用/);
  assert.match(diagnostics.report, /File System Access 不可用/);
  assert.match(diagnostics.report, /Web Locks 不可用/);
  assert.match(diagnostics.report, /剪贴板 API 不可用/);
});

test("诊断报告只包含脱敏字段，不输出密钥、IV 或目录句柄", () => {
  const text = profile("text", ["text"]);
  const diagnostics = buildLocalDiagnostics(
    input({
      aiSnapshot: aiSnapshot({
        defaults: { id: "default", textConnectionId: text.id, textModelId: "test-model", updatedAt: now },
        profiles: [text],
      }),
      obsidianSnapshot: obsidianSnapshot({ connected: true, permission: "granted", vaultName: "Vault" }),
    }),
  );

  assert.match(diagnostics.report, /text \/ custom \/ test-model/);
  assert.doesNotMatch(diagnostics.report, /secret-cipher|secret-iv|encryptedKey|directoryHandle|sk-\*\*\*/);
});
