import assert from "node:assert/strict";
import test from "node:test";
import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";
import { canContinueWeakness, resolveLearningNextSteps } from "./learning-next-step.ts";

function recommendation(module: "review" | "knowledgeTraining", id: string): LearningActionRecommendation {
  return { id, semanticKey: id, kind: module === "review" ? "review_mistakes" : "review_knowledge", title: id,
    summary: "真实剩余任务", completionHint: "提交结果", priority: 100, priorityReason: "到期",
    evidence: [{ type: module === "review" ? "mistake" : "knowledge", id, label: id, observedAt: "2026-09-12" }],
    destination: { module, targetIds: [id] }, state: "ready" };
}
const review = recommendation("review", "m1");
const knowledge = recommendation("knowledgeTraining", "k1");
const facts = { mistakeIds: ["m1"], knowledgeIds: ["k1"], hasScheduledWork: false };

test("完成后展示顺序严格遵循现有推荐，底层状态变化即切换下一步", () => {
  assert.equal(resolveLearningNextSteps({ ...facts, recommendations: [review, knowledge] })[0].destination, "review");
  assert.equal(resolveLearningNextSteps({ ...facts, recommendations: [knowledge, review] })[0].destination, "knowledgeTraining");
  assert.equal(resolveLearningNextSteps({ ...facts, recommendations: [knowledge] })[0].targetId, "k1");
  assert.equal(resolveLearningNextSteps({ ...facts, recommendations: [] })[0].destination, "dashboard");
});

test("无证据、非 ready、目标缺失不产生训练 CTA", () => {
  for (const invalid of [
    { ...review, evidence: [] },
    { ...review, state: "blocked" as const },
    { ...review, state: "conflict" as const },
    { ...review, state: "insufficient-data" as const },
    { ...review, destination: { module: "review" as const, targetIds: [] } },
    { ...review, destination: { module: "review" as const, targetIds: ["deleted"] } },
  ]) assert.equal(resolveLearningNextSteps({ ...facts, recommendations: [invalid] })[0].destination, "dashboard");
});

test("去重展示目的地，最多一个主要及两个次要按钮，已安排需要实际任务", () => {
  const actions = resolveLearningNextSteps({ ...facts, hasScheduledWork: true, recommendations: [review, review, knowledge] });
  assert.deepEqual(actions.map((item) => item.destination), ["review", "knowledgeTraining", "automation"]);
  assert.deepEqual(resolveLearningNextSteps({ ...facts, recommendations: [] }).map((item) => item.destination), ["dashboard"]);
});

test("薄弱分析只放行推荐明确提供的目标及模块", () => {
  assert.equal(canContinueWeakness([review], "mistake", "m1"), true);
  assert.equal(canContinueWeakness([review], "mistake", "other"), false);
  assert.equal(canContinueWeakness([review], "knowledge", "m1"), false);
  assert.equal(canContinueWeakness([{ ...knowledge, evidence: [] }], "knowledge", "k1"), false);
  assert.equal(canContinueWeakness([knowledge], "knowledge", "k1"), true);
});
