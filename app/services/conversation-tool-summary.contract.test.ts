import assert from "node:assert/strict";
import test from "node:test";
import type { AiConversationRunStep } from "../types/domains/conversation.ts";
import { summarizeConversationRunSteps } from "./conversation-tool-summary.ts";
import { buildConversationTurnTimeline } from "./conversation-turns.ts";

function step(partial: Partial<AiConversationRunStep> & { id: string; runId: string; label: string }): AiConversationRunStep {
  return {
    conversationId: "conversation-1",
    state: "done",
    visibility: "timeline",
    text: "",
    createdAt: "2026-07-09",
    updatedAt: "2026-07-09",
    ...partial,
  };
}

test("conversation run steps collapse into Codex-style command summaries", () => {
  const summaries = summarizeConversationRunSteps([
    step({ id: "1", runId: "run-1", label: "准备上下文", createdAt: "2026-07-09T08:00:00.000Z", updatedAt: "2026-07-09T08:00:00.000Z" }),
    step({ id: "2", runId: "run-1", label: "调用模型", createdAt: "2026-07-09T08:00:01.000Z", updatedAt: "2026-07-09T08:00:01.000Z" }),
    step({ id: "3", runId: "run-2", label: "选择连接", state: "running", createdAt: "2026-07-09T08:00:02.000Z", updatedAt: "2026-07-09T08:00:02.000Z" }),
  ]);

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].label, "已使用 2 个工具");
  assert.equal(summaries[0].state, "done");
  assert.deepEqual(summaries[0].steps.map((item) => item.label), ["准备上下文", "调用模型"]);
  assert.equal(summaries[1].label, "正在运行...");
  assert.equal(summaries[1].state, "running");
});

test("diagnostic steps stay out of the primary timeline unless they fail", () => {
  const hidden = summarizeConversationRunSteps([
    step({ id: "1", runId: "run-hidden", label: "选择模型", visibility: "diagnostic" }),
    step({ id: "2", runId: "run-hidden", label: "完成", visibility: "diagnostic" }),
  ]);
  assert.equal(hidden.length, 0);

  const failed = summarizeConversationRunSteps([
    step({ id: "3", runId: "run-error", label: "调用模型", visibility: "diagnostic", state: "error" }),
  ]);
  assert.equal(failed[0]?.label, "运行失败");
});

test("conversation run summary marks any failed step as failed", () => {
  const [summary] = summarizeConversationRunSteps([
    step({ id: "1", runId: "run-1", label: "准备上下文" }),
    step({ id: "2", runId: "run-1", label: "调用模型", state: "error" }),
  ]);

  assert.equal(summary.label, "运行失败");
  assert.equal(summary.state, "error");
});

test("turn timeline renders user, visible tools and assistant in one stable turn", () => {
  const timeline = buildConversationTurnTimeline([
    { id: "assistant", conversationId: "conversation-1", turnId: "turn-1", sequence: 2, role: "assistant", content: "回答", attachmentIds: [], createdAt: "2026-07-15T08:00:00.000Z" },
    { id: "user", conversationId: "conversation-1", turnId: "turn-1", sequence: 0, role: "user", content: "问题", attachmentIds: [], createdAt: "2026-07-15T08:00:00.000Z" },
  ], [
    step({ id: "tool", runId: "turn-1", turnId: "turn-1", ordinal: 1, label: "检索知识库", visibility: "timeline" }),
    step({ id: "internal", runId: "turn-1", turnId: "turn-1", ordinal: 0, label: "选择模型", visibility: "diagnostic" }),
  ]);
  assert.equal(timeline.turns.length, 1);
  assert.equal(timeline.turns[0]?.user?.content, "问题");
  assert.equal(timeline.turns[0]?.tools[0]?.steps[0]?.label, "检索知识库");
  assert.equal(timeline.turns[0]?.assistant?.content, "回答");
  assert.equal(timeline.standaloneTools.length, 0);
});

test("legacy same-millisecond replies bind to the latest unfinished user turn", () => {
  const timestamp = "2026-07-15T12:00:00.000Z";
  const timeline = buildConversationTurnTimeline([
    { id: "user-a", conversationId: "conversation-a", role: "user", content: "问题 A", attachmentIds: [], createdAt: timestamp },
    { id: "user-b", conversationId: "conversation-a", role: "user", content: "问题 B", attachmentIds: [], createdAt: timestamp },
    { id: "assistant-a", conversationId: "conversation-a", role: "assistant", content: "回答 B", attachmentIds: [], createdAt: timestamp },
    { id: "assistant-b", conversationId: "conversation-a", role: "assistant", content: "回答 A", attachmentIds: [], createdAt: timestamp },
  ], []);

  assert.equal(timeline.turns.length, 2);
  assert.equal(timeline.turns[0].user?.content, "问题 A");
  assert.equal(timeline.turns[0].assistant?.content, "回答 A");
  assert.equal(timeline.turns[1].user?.content, "问题 B");
  assert.equal(timeline.turns[1].assistant?.content, "回答 B");
});
