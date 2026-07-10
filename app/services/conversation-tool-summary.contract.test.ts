import assert from "node:assert/strict";
import test from "node:test";
import type { AiConversationRunStep } from "../types/review.ts";
import { summarizeConversationRunSteps } from "./conversation-tool-summary.ts";

function step(partial: Partial<AiConversationRunStep> & { id: string; runId: string; label: string }): AiConversationRunStep {
  return {
    conversationId: "conversation-1",
    state: "done",
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
  assert.equal(summaries[0].label, "已运行 2 条命令");
  assert.equal(summaries[0].state, "done");
  assert.deepEqual(summaries[0].steps.map((item) => item.label), ["准备上下文", "调用模型"]);
  assert.equal(summaries[1].label, "正在运行...");
  assert.equal(summaries[1].state, "running");
});

test("conversation run summary marks any failed step as failed", () => {
  const [summary] = summarizeConversationRunSteps([
    step({ id: "1", runId: "run-1", label: "准备上下文" }),
    step({ id: "2", runId: "run-1", label: "调用模型", state: "error" }),
  ]);

  assert.equal(summary.label, "运行失败");
  assert.equal(summary.state, "error");
});
