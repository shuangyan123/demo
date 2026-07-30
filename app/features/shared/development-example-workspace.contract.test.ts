import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ui-review-scenarios.contract.test.ts";
import { reviewDb } from "../../db/review-db.ts";
import { sampleScenarioRepository } from "../../services/sample-scenario-repository.ts";
import { filterWorkspaceRecords } from "../../services/workspace-data-scope.ts";
import "../../services/interview-repository.contract.test.ts";

const registry = readFileSync(new URL("./sample-scenario-registry.ts", import.meta.url), "utf8");
const scenarioRegistry = readFileSync(new URL("./ui-review-scenario-registry.ts", import.meta.url), "utf8");
const scopeHook = readFileSync(new URL("../review/use-review-workspace-sample-scope.ts", import.meta.url), "utf8");
const controls = readFileSync(new URL("./sample-scenario-controls.tsx", import.meta.url), "utf8");
const fixtures = readFileSync(new URL("../../services/sample-scenario-repository.ts", import.meta.url), "utf8");
const automationExecutor = readFileSync(new URL("../../services/automation-executor.ts", import.meta.url), "utf8");
const aiClient = readFileSync(new URL("../../services/ai-connection-client.ts", import.meta.url), "utf8");
const mcpRepository = readFileSync(new URL("../../services/mcp-settings-repository.ts", import.meta.url), "utf8");

test("UI 审查系统覆盖原有数据场景与全应用状态清单", () => {
  for (const id of [
    "dashboard-normal", "conversation-normal", "library-normal", "review-normal",
    "knowledge-normal", "knowledge-training-normal", "stats-normal", "import-normal",
    "import-needs-review", "automation-normal", "automation-failed",
    "interview-active", "interview-completed", "interview-cancelled", "tutoring-active",
  ]) assert.match(registry, new RegExp(`"${id}"`));
  assert.match(scenarioRegistry, /UiReviewScenarioDefinition/);
  assert.match(scenarioRegistry, /first-use-empty/);
  assert.match(scenarioRegistry, /filtered-empty/);
  assert.match(scenarioRegistry, /selection-empty/);
  assert.match(scenarioRegistry, /permission/);
  assert.match(scenarioRegistry, /conflict/);
});

test("UI 审查数据可按模块或完整包安装、刷新持久化并精准清理", () => {
  assert.match(scopeHook, /installPack/);
  assert.match(scopeHook, /installAll/);
  assert.match(scopeHook, /uiReviewSettingsRepository\.seed/);
  assert.match(controls, /UI 审查数据/);
  assert.match(controls, /载入本页/);
  assert.match(controls, /载入完整数据/);
  assert.match(controls, /删除审查数据/);
  assert.doesNotMatch(fixtures, /2026-07-30/);
});

test("审查数据幂等 upsert、参与真实界面筛选，清理不删除个人记录", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  await reviewDb.mistakes.put({
    id: "personal-mistake",
    board: "判断推理",
    source: "个人",
    stem: "个人题目",
    answer: "A",
    explanation: "",
    reasons: [],
    tags: [],
    mastery: 3,
    nextReviewAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await sampleScenarioRepository.seed("dashboard-normal");
  const firstCount = await reviewDb.mistakes.count();
  await sampleScenarioRepository.seed("dashboard-normal");
  assert.equal(await reviewDb.mistakes.count(), firstCount);
  assert.equal(filterWorkspaceRecords(await reviewDb.mistakes.toArray()).length, 3);

  await sampleScenarioRepository.clearAll();
  assert.deepEqual((await reviewDb.mistakes.toArray()).map((item) => item.id), ["personal-mistake"]);
  assert.equal(await reviewDb.automationDefinitions.filter((item) => item.id.startsWith("ui-review:")).count(), 0);
  assert.equal(await reviewDb.interviewSessions.filter((item) => item.id.startsWith("ui-review:")).count(), 0);
  await reviewDb.delete();
});

test("审查任务、AI 与 MCP 在执行边界硬性拒绝外部调用", () => {
  assert.match(automationExecutor, /isUiReviewRecordId/);
  assert.match(automationExecutor, /isUiReviewRuntimeActive/);
  assert.match(aiClient, /isUiReviewRuntimeActive/);
  assert.match(aiClient, /UI 审查 AI 连接只用于检查界面/);
  assert.match(mcpRepository, /isUiReviewRuntimeActive/);
  assert.match(mcpRepository, /UI 审查 MCP/);
});
