import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [confidenceSource, reviewSource, knowledgeSource, loaderSource, modelSource, insightSource, panelSource] = await Promise.all([
  readFile(new URL("./learning-confidence-control.tsx", import.meta.url), "utf8"),
  readFile(new URL("./review-session-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../knowledge/knowledge-training-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("./use-review-workspace-data.ts", import.meta.url), "utf8"),
  readFile(new URL("./learning-insight-model.ts", import.meta.url), "utf8"),
  readFile(new URL("./learning-insight-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("./learning-evidence-panel.tsx", import.meta.url), "utf8"),
]);

test("L6 控件使用 semantic radio，反馈首次揭示后冻结且允许跳过", () => {
  assert.match(confidenceSource, /<fieldset/);
  assert.match(confidenceSource, /type="radio"/);
  assert.match(confidenceSource, /disabled=\{feedbackRevealed\}/);
  assert.match(confidenceSource, /清除自评/);
  assert.match(confidenceSource, /跳过即可不记录/);
  assert.match(reviewSource, /confidence\.revealFeedback\(\)|onToggleAnswer/);
  assert.match(reviewSource, /confidence\.feedbackRevealed/);
  assert.match(knowledgeSource, /confidence\.feedbackRevealed/);
});

test("L6 在反馈前隐藏解释性资料与关联入口，并保留自评边界文案", () => {
  assert.match(reviewSource, /confidence\.feedbackRevealed \? currentReview\.reasons/);
  assert.match(reviewSource, /confidence\.feedbackRevealed && associatedKnowledge/);
  assert.match(reviewSource, /disabled=\{!confidence\.feedbackRevealed\}/);
  assert.match(reviewSource, /自评答对 \/ 自评不确定 \/ 自评答错/);
  assert.match(knowledgeSource, /confidence\.feedbackRevealed \? currentEntry\.summary/);
  assert.match(knowledgeSource, /disabled=\{!confidence\.feedbackRevealed\}/);
  assert.match(knowledgeSource, /自评答对 \/ 自评不确定 \/ 自评答错/);
});

test("L6 洞察读取 scoped subjects 的一批 LearningEvent，并不进入 learner-state 推荐链", () => {
  assert.match(loaderSource, /const scopedMistakes = filterWorkspaceRecords/);
  assert.match(loaderSource, /const scopedKnowledgeEntries = filterWorkspaceRecords/);
  assert.match(loaderSource, /learningEventRepository\.listForSubjects\(\[/);
  assert.match(loaderSource, /scopedMistakes\.map/);
  assert.match(loaderSource, /scopedKnowledgeEntries\.map/);
  assert.match(loaderSource, /setLearningEvents\(scopedLearningEvents\)/);
  assert.match(modelSource, /learningEvents\?: LearningEvent\[\]/);
  assert.match(modelSource, /learningEvidence/);
  assert.match(modelSource, /calibrationEvidence/);
  assert.match(modelSource, /delayedRecallEvidence/);
  assert.match(insightSource, /<LearningEvidencePanel evidence=\{snapshot\.learningEvidence\}/);
  assert.match(panelSource, /<section className=\{styles\.panel\} aria-label="学习证据">/);
  assert.match(panelSource, /尚无跨日再测证据/);
  assert.match(panelSource, /不代表记忆保持概率或校准能力/);
  assert.doesNotMatch(insightSource, /label="跨日复习通过率"/);
  assert.doesNotMatch(panelSource, /平均自信度|校准分数|遗忘概率|retention probability/i);
});
