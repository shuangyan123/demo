import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewDb } from "../../db/review-db.ts";
import { sampleScenarioRepository } from "../../services/sample-scenario-repository.ts";
import { filterWorkspaceRecords } from "../../services/workspace-data-scope.ts";
import "../../services/interview-repository.contract.test.ts";

const registry = readFileSync(new URL("./sample-scenario-registry.ts", import.meta.url), "utf8");
const root = readFileSync(new URL("../review/review-workspace.tsx", import.meta.url), "utf8");
const scopeHook = readFileSync(new URL("../review/use-review-workspace-sample-scope.ts", import.meta.url), "utf8");
const controls = readFileSync(new URL("./sample-scenario-controls.tsx", import.meta.url), "utf8");
const database = readFileSync(new URL("../../db/review-db.ts", import.meta.url), "utf8");

test("真实示例注册表覆盖内容型工作台及适用状态", () => {
  for (const id of [
    "dashboard-normal", "conversation-normal", "library-normal", "review-normal",
    "knowledge-normal", "knowledge-training-normal", "stats-normal", "import-normal",
    "import-needs-review", "automation-normal", "automation-failed",
    "interview-active", "interview-completed", "interview-cancelled", "tutoring-active",
  ]) assert.match(registry, new RegExp(`"${id}"`));
  assert.match(registry, /SampleScenarioDefinition/);
  assert.match(registry, /view: ViewKey/);
});

test("示例模式不跨重启持久化并提供退出与一键清理", () => {
  assert.match(root, /useReviewWorkspaceSampleScope/);
  assert.match(scopeHook, /useState<WorkspaceDataScope>\(PERSONAL_WORKSPACE_DATA_SCOPE\)/);
  assert.doesNotMatch(`${root}\n${scopeHook}`, /localStorage|sessionStorage|searchParams/);
  assert.match(controls, />\s*载入示例\s*</);
  assert.match(controls, />退出示例</);
  assert.match(controls, />一键清理</);
  assert.match(controls, /不会调用外部服务/);
  assert.match(database, /this\.version\(16\)/);
  assert.doesNotMatch(database, /this\.version\(17\)/);
});

test("示例载入幂等、个人读取排除示例且清理不删除个人记录", async () => {
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
    nextReviewAt: "2026-07-30T00:00:00.000Z",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });

  await sampleScenarioRepository.seed("dashboard-normal");
  const firstCount = await reviewDb.mistakes.count();
  await sampleScenarioRepository.seed("dashboard-normal");
  assert.equal(await reviewDb.mistakes.count(), firstCount);

  const allMistakes = await reviewDb.mistakes.toArray();
  assert.deepEqual(filterWorkspaceRecords(allMistakes).map((item) => item.id), ["personal-mistake"]);
  assert.equal(filterWorkspaceRecords(allMistakes, { kind: "sample", scenarioId: "dashboard-normal" }).length, 2);

  await sampleScenarioRepository.clearAll();
  assert.deepEqual((await reviewDb.mistakes.toArray()).map((item) => item.id), ["personal-mistake"]);
  assert.equal(await reviewDb.automationDefinitions.filter((item) => item.id.startsWith("sample:")).count(), 0);
  assert.equal(await reviewDb.interviewSessions.filter((item) => item.id.startsWith("sample:")).count(), 0);
  await reviewDb.delete();
});
