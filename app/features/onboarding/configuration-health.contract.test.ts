import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { buildConfigurationHealth, type ConfigurationHealthInput } from "./use-configuration-health.ts";
import type { AiConnectionSnapshot, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AutomationDefinition, AutomationSnapshot } from "../../types/domains/automation.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import type { ObsidianVaultSnapshot } from "../../types/domains/obsidian.ts";

const now = "2026-06-29T00:00:00.000Z";

function profile(id: string, capabilities: ApiConnectionProfile["capabilities"]): ApiConnectionProfile {
  return {
    id,
    apiFormat: "chat_completions",
    baseUrl: "http://127.0.0.1:9999/v1",
    capabilities,
    createdAt: now,
    encryptedKey: "",
    iv: "",
    label: id,
    maskedKey: "",
    model: "test-model",
    provider: "custom",
    providerOptions: {},
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

function mistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: "mistake-1",
    answer: "A",
    board: "常识判断",
    createdAt: now,
    explanation: "解析",
    mastery: 2,
    nextReviewAt: "2026-06-29",
    reasons: ["概念混淆"],
    source: "手动录入",
    stem: "题干",
    tags: ["测试"],
    updatedAt: now,
    ...overrides,
  };
}

function knowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "knowledge-1",
    category: "常识判断",
    content: "知识内容",
    createdAt: now,
    favorite: false,
    lastReviewedAt: undefined,
    mastery: 3,
    nextReviewAt: "2026-06-29",
    reviewCount: 0,
    source: "手动整理",
    summary: "摘要",
    tags: ["测试"],
    title: "知识资料",
    updatedAt: now,
    ...overrides,
  };
}

function input(overrides: Partial<ConfigurationHealthInput> = {}): ConfigurationHealthInput {
  return {
    aiSnapshot: aiSnapshot(),
    automationSnapshot: automationSnapshot(),
    dueKnowledgeCount: 0,
    dueMistakeCount: 0,
    importJobs: [],
    knowledgeEntries: [],
    mistakes: [],
    obsidianSnapshot: obsidianSnapshot(),
    ...overrides,
  };
}

test("配置健康在缺少默认文本、多模态和语音连接时返回对应缺项", () => {
  const health = buildConfigurationHealth(input());
  const aiItems = health.sections.find((section) => section.id === "ai")?.items ?? [];

  assert.equal(health.status, "missing");
  assert.equal(aiItems.find((item) => item.id === "ai-text")?.status, "missing");
  assert.equal(aiItems.find((item) => item.id === "ai-vision")?.status, "warning");
  assert.equal(aiItems.find((item) => item.id === "ai-speech")?.status, "warning");
});

test("配置健康能识别 Obsidian 未连接、权限异常、冲突和待确认提案", () => {
  const disconnected = buildConfigurationHealth(input()).sections.find((section) => section.id === "obsidian");
  const permission = buildConfigurationHealth(
    input({ obsidianSnapshot: obsidianSnapshot({ connected: true, permission: "prompt", vaultName: "Vault" }) }),
  ).sections.find((section) => section.id === "obsidian");
  const conflict = buildConfigurationHealth(
    input({ obsidianSnapshot: obsidianSnapshot({ connected: true, conflictCount: 2, permission: "granted", vaultName: "Vault" }) }),
  ).sections.find((section) => section.id === "obsidian");
  const proposals = buildConfigurationHealth(
    input({ obsidianSnapshot: obsidianSnapshot({ connected: true, pendingProposalCount: 3, permission: "granted", vaultName: "Vault" }) }),
  ).sections.find((section) => section.id === "obsidian");

  assert.equal(disconnected?.items[0]?.id, "obsidian-disconnected");
  assert.equal(permission?.items[0]?.id, "obsidian-permission");
  assert.equal(conflict?.items[0]?.id, "obsidian-conflict");
  assert.equal(proposals?.items[0]?.id, "obsidian-proposals");
});

test("配置健康能识别自动化无任务、未启用、缺文本连接和未读结果", () => {
  const text = profile("text", ["text"]);
  const withText = aiSnapshot({ defaults: { id: "default", textConnectionId: text.id, updatedAt: now }, profiles: [text] });
  const noTask = buildConfigurationHealth(input()).sections.find((section) => section.id === "automation");
  const disabled = buildConfigurationHealth(
    input({ automationSnapshot: automationSnapshot({ definitions: [automationDefinition({ enabled: false })] }) }),
  ).sections.find((section) => section.id === "automation");
  const noText = buildConfigurationHealth(
    input({ automationSnapshot: automationSnapshot({ definitions: [automationDefinition()] }) }),
  ).sections.find((section) => section.id === "automation");
  const unread = buildConfigurationHealth(
    input({ aiSnapshot: withText, automationSnapshot: automationSnapshot({ definitions: [automationDefinition()], unreadCount: 1 }) }),
  ).sections.find((section) => section.id === "automation");

  assert.equal(noTask?.items[0]?.id, "automation-empty");
  assert.equal(disabled?.items[0]?.id, "automation-disabled");
  assert.equal(noText?.items[0]?.id, "automation-no-text");
  assert.equal(unread?.items[0]?.id, "automation-unread");
});

test("配置健康在学习数据为空时提供导入和手动录入入口", () => {
  const learning = buildConfigurationHealth(input()).sections.find((section) => section.id === "learning");

  assert.equal(learning?.status, "missing");
  assert.deepEqual(
    learning?.items.map((item) => item.action),
    ["import", "entry"],
  );
});

test("配置健康在核心能力齐全时返回 ready", () => {
  const text = profile("text", ["text"]);
  const vision = profile("vision", ["vision"]);
  const speech = profile("speech", ["speech"]);
  const health = buildConfigurationHealth(
    input({
      aiSnapshot: aiSnapshot({
        defaults: { id: "default", speechConnectionId: speech.id, textConnectionId: text.id, visionConnectionId: vision.id, updatedAt: now },
        profiles: [text, vision, speech],
      }),
      automationSnapshot: automationSnapshot({ definitions: [automationDefinition()] }),
      knowledgeEntries: [knowledgeEntry()],
      mistakes: [mistake()],
      obsidianSnapshot: obsidianSnapshot({ connected: true, permission: "granted", vaultName: "Vault" }),
    }),
  );

  assert.equal(health.status, "ready");
  assert.equal(health.summary, "核心能力已就绪");
});
