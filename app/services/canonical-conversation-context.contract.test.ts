import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalConversationTurns, canonicalTurnsToChatHistory } from "./canonical-conversation-context.ts";
import { buildConversationContextBudget } from "./conversation-context-budget.ts";
import { buildConversationCompactionCandidate } from "./conversation-context-compaction.ts";

test("跨厂商上下文保留可见顺序并排除诊断步骤", () => {
  const messages = [
    { id: "u", conversationId: "c", turnId: "t", sequence: 0, role: "user" as const, content: "问题", attachmentIds: ["a"], createdAt: "2026-07-15T00:00:00.000Z" },
    { id: "a", conversationId: "c", turnId: "t", sequence: 2, role: "assistant" as const, content: "回答", attachmentIds: [], createdAt: "2026-07-15T00:00:01.000Z" },
  ];
  const turns = buildCanonicalConversationTurns({
    messages,
    attachments: [{ id: "a1", conversationId: "c", messageId: "u", kind: "image", label: "图", summary: "一张图", createdAt: messages[0].createdAt }],
    runSteps: [
      { id: "s1", conversationId: "c", runId: "t", turnId: "t", ordinal: 0, visibility: "timeline", label: "检索", state: "done", text: "找到两条", createdAt: messages[0].createdAt, updatedAt: messages[0].createdAt },
      { id: "s2", conversationId: "c", runId: "t", turnId: "t", ordinal: 1, visibility: "diagnostic", label: "隐藏思维", state: "done", text: "不得迁移", createdAt: messages[0].createdAt, updatedAt: messages[0].createdAt },
    ],
  });
  assert.deepEqual(turns.map((turn) => turn.role), ["user", "assistant"]);
  const history = canonicalTurnsToChatHistory(turns);
  assert.match(history[0].content, /附件摘要：一张图/);
  assert.match(history[1].content, /工具 检索/);
  assert.equal(JSON.stringify(history).includes("隐藏思维"), false);
});

test("上下文超限时使用摘要和最近十二轮", () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({ id: String(index), conversationId: "c", role: index % 2 ? "assistant" as const : "user" as const, content: "x".repeat(500), attachmentIds: [], createdAt: new Date(index * 1000).toISOString() }));
  const turns = buildCanonicalConversationTurns({ conversation: { summary: "旧内容摘要" }, messages, maxCharacters: 4_000 });
  assert.equal(turns.length, 25);
  assert.match(turns[0].content, /旧内容摘要/);
  assert.equal(turns.at(-1)?.content, "x".repeat(500));
});

test("压缩边界进入真实请求且历史消息仍完整保留", () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    id: `m-${index}`,
    conversationId: "c",
    role: index % 2 ? "assistant" as const : "user" as const,
    content: `第 ${index + 1} 条 ${"内容".repeat(100)}`,
    attachmentIds: [],
    createdAt: new Date(index * 1_000).toISOString(),
  }));
  const conversation = { id: "c", title: "测试", projectId: "p", createdAt: "", updatedAt: "" } as never;
  const candidate = buildConversationCompactionCandidate({ conversation, messages });
  assert.equal(candidate?.sourceMessageCount, 4);
  assert.equal(candidate?.boundaryMessageId, "m-3");
  assert.equal(messages.length, 16);

  const compactedTurns = buildCanonicalConversationTurns({
    conversation: { contextCompaction: { summary: "既有目标与约束", throughMessageId: "m-3" } } as never,
    messages,
  });
  assert.match(compactedTurns[0].content, /既有目标与约束/);
  assert.equal(compactedTurns.some((turn) => turn.content.includes("第 1 条")), false);
  assert.equal(compactedTurns.at(-1)?.content, messages.at(-1)?.content);
});

test("上下文预算共享模型窗口、输出预留和用量校准", () => {
  const budget = buildConversationContextBudget({
    messages: [{ role: "user", content: "上下文".repeat(100) }],
    contextWindow: 2_000,
    outputReserveTokens: 200,
    calibratedInputTokens: 600,
  });
  assert.equal(budget.usedTokens, 600);
  assert.equal(budget.remainingTokens, 1_200);
  assert.equal(budget.remainingPercent, 60);
  assert.equal(budget.precision, "usage-calibrated");
});
