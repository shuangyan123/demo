import assert from "node:assert/strict";
import test from "node:test";
import { reduceAiActivityRuns } from "./ai-activity-events.ts";

test("AI 活动 reducer 把同一 run 的步骤、delta 和 usage 聚合到一起", () => {
  let runs = reduceAiActivityRuns([], {
    runId: "run-1",
    conversationId: "conversation-1",
    projectId: "civil-service",
    studyDomainId: "civil-service",
    phase: "started",
    label: "OpenAI · model",
    module: "Obsidian 插件",
    stepId: "context",
    text: "准备上下文",
    attachments: [{ id: "graph", label: "知识图谱摘要", kind: "context" }],
  }, "2026-07-05T00:00:00.000Z");
  runs = reduceAiActivityRuns(runs, { runId: "run-1", phase: "delta", label: "OpenAI · model", stepId: "stream", text: "你好" }, "2026-07-05T00:00:01.000Z");
  runs = reduceAiActivityRuns(runs, { runId: "run-1", phase: "usage", label: "OpenAI · model", stepId: "usage", usage: { totalTokens: 42 } }, "2026-07-05T00:00:02.000Z");
  runs = reduceAiActivityRuns(runs, { runId: "run-1", phase: "done", label: "OpenAI · model", stepId: "done", text: "完成" }, "2026-07-05T00:00:03.000Z");

  assert.equal(runs.length, 1);
  assert.equal(runs[0].state, "done");
  assert.equal(runs[0].module, "Obsidian 插件");
  assert.equal(runs[0].conversationId, "conversation-1");
  assert.equal(runs[0].projectId, "civil-service");
  assert.equal(runs[0].attachments[0]?.label, "知识图谱摘要");
  assert.equal(runs[0].streamText, "你好");
  assert.equal(runs[0].usage?.totalTokens, 42);
  assert.equal(runs[0].steps.some((step) => step.id === "context"), true);
  assert.equal(runs[0].steps.find((step) => step.id === "context")?.label, "准备上下文");
  assert.equal(runs[0].steps.find((step) => step.id === "stream")?.label, "流式输出");
});
