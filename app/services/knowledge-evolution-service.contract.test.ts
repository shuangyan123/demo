import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";
import { normalizeKnowledgeEvolutionPayload } from "./knowledge-evolution-service.ts";
import type { KnowledgeEvolutionSource } from "./obsidian-knowledge-repository.ts";

const timestamp = "2026-07-05T00:00:00.000Z";

const source: KnowledgeEvolutionSource = {
  id: "mistake:1",
  type: "mistake",
  title: "行政许可错题",
  content: "行政许可需要依法审查。",
  tags: ["行政法"],
};

const entry: KnowledgeEntry = {
  id: "knowledge-1",
  category: "常识判断",
  title: "行政许可",
  summary: "行政许可基本规则",
  content: "# 行政许可",
  tags: ["行政法"],
  source: "测试",
  favorite: false,
  mastery: 2,
  nextReviewAt: timestamp,
  reviewCount: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};

test("知识演进提案解析出可显示 pending 提案并保留诊断计数", () => {
  const result = normalizeKnowledgeEvolutionPayload({
    content: JSON.stringify([
      { mode: "merge", sourceIds: ["mistake:1"], targetKnowledgeId: "knowledge-1", category: "常识判断", title: "行政许可边界", summary: "补充边界", content: "AI 演进内容", tags: ["行政法"], proposedLinks: ["行政处罚"], reason: "错题暴露边界混淆", confidence: 0.9 },
    ]),
    sources: [source],
    entries: [entry],
    timestamp,
  });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].status, "pending");
  assert.equal(result.proposals[0].mode, "merge");
  assert.equal(result.filteredCount, 0);
});

test("知识演进提案对解析失败、空内容和自引用给出可见诊断", () => {
  const parseError = normalizeKnowledgeEvolutionPayload({ content: "not json", sources: [source], entries: [entry], timestamp });
  assert.equal(parseError.proposals.length, 0);
  assert.match(parseError.emptyReason ?? "", /未能解析/);
  assert.equal(parseError.diagnostics[0].tone, "error");

  const filtered = normalizeKnowledgeEvolutionPayload({
    content: JSON.stringify([
      { title: "空提案", sourceIds: ["mistake:1"], content: "", proposedLinks: [] },
      { mode: "link", title: "自引用", sourceIds: ["knowledge:knowledge-1"], targetKnowledgeId: "knowledge-1", proposedLinks: ["行政处罚"] },
    ]),
    sources: [{ ...source, id: "knowledge:knowledge-1", type: "knowledge" }],
    entries: [entry],
    timestamp,
  });
  assert.equal(filtered.proposals.length, 0);
  assert.equal(filtered.filteredCount, 2);
  assert.match(filtered.emptyReason ?? "", /过滤/);
});
