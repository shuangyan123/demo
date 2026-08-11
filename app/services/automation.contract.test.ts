import "fake-indexeddb/auto";
import "./acquisition.contract.test.ts";
import "./interview-repository.contract.test.ts";
import "../features/automation/automation-ui.contract.test.ts";
import assert from "node:assert/strict";
import test from "node:test";
import Dexie from "dexie";
import { executeAutomationRun } from "../application/automation/execute-automation-run.ts";
import { reviewDb } from "../db/review-db.ts";
import type { AutomationDefinition } from "../types/domains/automation.ts";
import type { Mistake } from "../types/domains/review.ts";
import { createDefaultPersonalizationSettings } from "./personalization-settings-repository.ts";
import { buildAutomationContext, buildAutomationContextResult } from "./automation-context-service.ts";
import { automationRepository, renewAutomationLease } from "./automation-repository.ts";
import { classifyAutomationError } from "./automation-failure.ts";
import { AiProviderFailureError, aiProviderFailureMessage } from "./ai-provider-failure.ts";
import { trialAutomationDefinition } from "./automation-executor.ts";
import { calculateDueAutomation, nextAutomationRun, validateAutomationSchedule } from "./automation-schedule.ts";
import { obsidianKnowledgeRepository } from "./obsidian-knowledge-repository.ts";

const baseTime = new Date("2026-06-21T00:00:00.000Z");

function dueDefinition(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "automation-1", name: "测试自动化", templateId: "daily_review", prompt: "生成简报",
    sourceScopes: ["mistakes"], enabled: true, timeZone: "Asia/Shanghai",
    schedule: { kind: "interval", intervalMinutes: 60 }, nextRunAt: "2026-06-21T01:00:00.000Z",
    createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString(), ...overrides,
  };
}

test("v15 数据库升级到 v16 后只清理旧空白新对话", async () => {
  await reviewDb.delete();
  const legacy = new Dexie("review_workspace");
  legacy.version(15).stores({ mistakes: "&id, updatedAt", automationDefinitions: "&id, enabled, nextRunAt, updatedAt", automationRuns: "&id, automationId, status, unread, scheduledAt, createdAt, [automationId+scheduledAt]", aiConversations: "&id, projectId, folderId, selectedConnectionId, kind, status, updatedAt, createdAt", aiConversationAttachments: "&id, conversationId", aiConversationMessages: "&id, conversationId", aiConversationRunSteps: "&id, conversationId" });
  await legacy.open();
  await legacy.table("mistakes").put({ id: "legacy-mistake", updatedAt: baseTime.toISOString() });
  await legacy.table("aiConversations").bulkPut([
    { id: "empty-new-chat", projectId: "civil-service", title: "新对话", messageCount: 0, kind: "general", status: "active", createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString() },
    { id: "used-new-chat", projectId: "civil-service", title: "新对话", messageCount: 1, kind: "general", status: "active", createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString() },
  ]);
  await legacy.table("aiConversationAttachments").put({ id: "orphan-summary", conversationId: "empty-new-chat" });
  legacy.close();

  await reviewDb.open();
  assert.equal(reviewDb.verno, 16);
  assert.equal((await reviewDb.mistakes.get("legacy-mistake"))?.id, "legacy-mistake");
  assert.equal(reviewDb.tables.some((table) => table.name === "automationDefinitions"), true);
  assert.equal(reviewDb.tables.some((table) => table.name === "automationRuns"), true);
  assert.equal(reviewDb.tables.some((table) => table.name === "aiConversations"), true);
  assert.equal(reviewDb.tables.some((table) => table.name === "aiConversationFolders"), true);
  assert.equal(reviewDb.tables.some((table) => table.name === "aiConversationAttachments"), true);
  assert.equal(reviewDb.tables.some((table) => table.name === "aiConversationMessages"), true);
  assert.equal(await reviewDb.aiConversations.get("empty-new-chat"), undefined);
  assert.equal((await reviewDb.aiConversations.get("used-new-chat"))?.messageCount, 1);
  assert.equal(await reviewDb.aiConversationAttachments.get("orphan-summary"), undefined);
  await reviewDb.delete();
});

test("常用周期、五段式 Cron、时区和夏令时可计算且拒绝过高频率", async () => {
  assert.equal((await nextAutomationRun({ kind: "interval", intervalMinutes: 5 }, "Asia/Shanghai", baseTime)).toISOString(), "2026-06-21T00:05:00.000Z");
  assert.equal((await nextAutomationRun({ kind: "cron", expression: "0 9 * * *" }, "America/New_York", new Date("2026-03-08T05:00:00.000Z"))).toISOString(), "2026-03-08T13:00:00.000Z");
  await assert.rejects(() => validateAutomationSchedule({ kind: "cron", expression: "* * * * *" }, "Asia/Shanghai", baseTime), /不能少于 5 分钟/);
  await assert.rejects(() => validateAutomationSchedule({ kind: "cron", expression: "0 0 8 * * *" }, "Asia/Shanghai", baseTime), /五个字段/);
  await assert.rejects(() => nextAutomationRun({ kind: "daily", time: "25:00" }, "Asia/Shanghai", baseTime), /HH:mm/);
});

test("漏跑多个周期时只生成一个最新补跑并推进下一计划", async () => {
  const state = await calculateDueAutomation(dueDefinition(), new Date("2026-06-21T04:30:00.000Z"));
  assert.equal(state.due, true);
  assert.equal(state.scheduledAt, "2026-06-21T04:00:00.000Z");
  assert.equal(state.nextRunAt, "2026-06-21T05:00:00.000Z");
  assert.equal(state.missedCount, 3);
});

test("上下文只读取授权范围，租约阻止重复运行，失败结果进入未读收件箱", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const mistake: Mistake = {
    id: "mistake-1", board: "政治理论", source: "测试", stem: "题干", answer: "A", explanation: "解析",
    reasons: ["概念混淆"], tags: ["理论"], mastery: 2, nextReviewAt: baseTime.toISOString(), createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString(),
  };
  await reviewDb.mistakes.put(mistake);
  await reviewDb.knowledgeEntries.put({ id: "knowledge-1", category: "政治理论", title: "知识", summary: "摘要", content: "正文", tags: [], source: "测试", favorite: false, mastery: 2, nextReviewAt: baseTime.toISOString(), reviewCount: 0, createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString() });
  const context = await buildAutomationContext(["mistakes"]);
  assert.equal("mistakes" in context, true);
  assert.equal("knowledge" in context, false);
  const contextResult = await buildAutomationContextResult(["mistakes"]);
  assert.equal(contextResult.summary.length, 1);
  assert.equal(contextResult.summary[0].scope, "mistakes");
  assert.equal(contextResult.summary[0].count, 1);
  assert.equal("context" in (contextResult.summary[0] as Record<string, unknown>), false);
  const evolutionSources = await obsidianKnowledgeRepository.loadEvolutionSources(12, ["mistake"]);
  assert.deepEqual(Array.from(new Set(evolutionSources.map((item) => item.type))), ["mistake"]);

  const definition = await automationRepository.create({
    name: "缺连接测试", templateId: "daily_review", prompt: "总结", sourceScopes: ["mistakes"], enabled: true,
    timeZone: "Asia/Shanghai", schedule: { kind: "interval", intervalMinutes: 60 },
  }, baseTime);
  await reviewDb.automationDefinitions.update(definition.id, { leaseOwner: "other-tab", leaseExpiresAt: "2026-06-21T00:10:00.000Z" });
  assert.equal(await executeAutomationRun({ definition, personalization: createDefaultPersonalizationSettings(baseTime), trigger: "manual", now: baseTime }), undefined);
  await reviewDb.automationDefinitions.update(definition.id, { leaseOwner: undefined, leaseExpiresAt: undefined });
  const failed = await executeAutomationRun({ definition, personalization: createDefaultPersonalizationSettings(baseTime), trigger: "scheduled", scheduledAt: baseTime.toISOString(), nextRunAt: "2026-06-21T01:00:00.000Z", now: baseTime });
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /默认文本连接/);
  assert.equal(failed?.failureCategory, "missing_connection");
  assert.equal(failed?.failureRecoveryAction, "configure_ai_connection");
  assert.equal(failed?.contextSummary?.[0].scope, "mistakes");
  assert.equal("context" in (failed as unknown as Record<string, unknown>), false);
  assert.equal((await automationRepository.loadSnapshot()).unreadCount, 1);
  assert.equal((await reviewDb.automationDefinitions.get(definition.id))?.nextRunAt, "2026-06-21T01:00:00.000Z");
  await automationRepository.markAllRead();
  assert.equal((await automationRepository.loadSnapshot()).unreadCount, 0);
  assert.equal((await reviewDb.knowledgeEntries.get("knowledge-1"))?.content, "正文");
  await reviewDb.delete();
});

test("试运行缺默认文本连接时不创建运行记录、提案或任务变更", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const definition = dueDefinition({ id: "trial-missing-connection" });
  await assert.rejects(() => trialAutomationDefinition({
    definition,
    personalization: createDefaultPersonalizationSettings(baseTime),
  }), /默认文本连接/);
  assert.equal(await reviewDb.automationRuns.count(), 0);
  assert.equal(await reviewDb.automationDefinitions.count(), 0);
  assert.equal(await reviewDb.knowledgeEvolutionProposals.count(), 0);
  await reviewDb.delete();
});

test("自动化失败分类给出稳定恢复动作", () => {
  assert.deepEqual(classifyAutomationError(new Error("请先配置默认文本连接")).category, "missing_connection");
  assert.deepEqual(classifyAutomationError(new Error("Failed to fetch"), { online: false }).recoveryAction, "check_network");
  assert.deepEqual(classifyAutomationError(new Error("Vault permission denied")).recoveryAction, "open_knowledge");
  assert.deepEqual(classifyAutomationError(new Error("HTTP 401 model error")).category, "model");
  assert.deepEqual(classifyAutomationError(new Error("没有可读取数据")).recoveryAction, "open_import");
});

test("Automation 对 typed provider failure 按 code 分类且使用共享安全文案", () => {
  const failure = new AiProviderFailureError({ code: "rate_limit", provider: "deepseek", retry: "after-delay" }, "vendor 503 overload");
  const diagnosis = classifyAutomationError(failure);
  assert.equal(diagnosis.category, "model");
  assert.equal(diagnosis.recoveryAction, "configure_ai_connection");
  assert.equal(diagnosis.message, aiProviderFailureMessage("rate_limit"));
  assert.doesNotMatch(diagnosis.message, /vendor|503|overload/);

  const interrupted = classifyAutomationError(new AiProviderFailureError({ code: "stream_interrupted", provider: "deepseek", retry: "manual-only" }, "vendor stream detail"));
  assert.equal(interrupted.category, "network");
  assert.equal(interrupted.recoveryAction, "check_network");
  assert.equal(interrupted.message, aiProviderFailureMessage("stream_interrupted"));
});

test("租约可续期且旧所有者不能覆盖新租约", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const definition = dueDefinition({ id: "lease-renewal" });
  await reviewDb.automationDefinitions.put({ ...definition, leaseOwner: "owner-a", leaseExpiresAt: "2026-06-21T00:05:00.000Z" });
  assert.equal(await renewAutomationLease(definition.id, "owner-a", new Date("2026-06-21T00:04:00.000Z")), true);
  assert.equal((await reviewDb.automationDefinitions.get(definition.id))?.leaseExpiresAt, "2026-06-21T00:09:00.000Z");
  await reviewDb.automationDefinitions.update(definition.id, { leaseOwner: "owner-b" });
  assert.equal(await renewAutomationLease(definition.id, "owner-a", new Date("2026-06-21T00:05:00.000Z")), false);
  await reviewDb.delete();
});

test("计划任务使用旧版本快照时不会运行已停用定义", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const definition = await automationRepository.create({
    name: "停用竞态", templateId: "daily_review", prompt: "总结", sourceScopes: ["mistakes"], enabled: true,
    timeZone: "Asia/Shanghai", schedule: { kind: "interval", intervalMinutes: 60 },
  }, baseTime);
  await automationRepository.toggle(definition.id, false, new Date("2026-06-21T00:01:00.000Z"));
  const run = await executeAutomationRun({
    definition,
    personalization: createDefaultPersonalizationSettings(baseTime),
    trigger: "scheduled",
    expectedUpdatedAt: definition.updatedAt,
    now: new Date("2026-06-21T00:02:00.000Z"),
  });
  assert.equal(run, undefined);
  assert.equal(await reviewDb.automationRuns.count(), 0);
  await reviewDb.delete();
});
