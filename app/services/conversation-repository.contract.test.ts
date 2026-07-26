import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import { conversationRepository } from "./conversation-repository.ts";

const today = new Date("2026-07-09T08:00:00.000Z");

async function resetDatabase() {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

test("conversation repository persists projects, conversations, messages and run steps", async () => {
  await resetDatabase();
  const conversation = await conversationRepository.createConversation({ today, title: "新对话" });
  await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content: "行测资料分析怎么复盘", today });
  await conversationRepository.appendRunStep({ conversationId: conversation.id, runId: "run-1", label: "准备上下文", state: "done", text: "公考项目", today });

  const snapshot = await conversationRepository.loadSnapshot(today);
  assert.equal(snapshot.projects[0]?.id, "civil-service");
  assert.equal(snapshot.conversations.length, 1);
  assert.equal(snapshot.conversations[0].title, "行测资料分析怎么复盘");
  assert.equal(snapshot.conversations[0].messageCount, 1);
  assert.equal(snapshot.messages[0]?.content, "行测资料分析怎么复盘");
  assert.equal(snapshot.runSteps[0]?.label, "准备上下文");
});

test("conversation folders support nesting, rename, move and attachment summaries without file bytes", async () => {
  await resetDatabase();
  const root = await conversationRepository.createFolder({ label: "申论", today });
  const child = await conversationRepository.createFolder({ label: "材料分析", parentId: root.id, today });
  await conversationRepository.renameFolder(child.id, "材料精读", today);
  const conversation = await conversationRepository.createConversation({ today, title: "草稿", folderId: root.id, selectedConnectionId: "vision-1" });
  await conversationRepository.moveConversation(conversation.id, child.id, today);
  const attachment = await conversationRepository.createAttachment({
    conversationId: conversation.id,
    kind: "image",
    label: "题图.png",
    summary: "图片，124 KB",
    mimeType: "image/png",
    sizeBytes: 126976,
    today,
  });
  await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content: "分析这张题图", attachmentIds: [attachment.id], today });

  const snapshot = await conversationRepository.loadSnapshot(today);
  assert.equal(snapshot.folders.find((folder) => folder.id === child.id)?.label, "材料精读");
  assert.equal(snapshot.conversations[0]?.folderId, child.id);
  assert.equal(snapshot.conversations[0]?.selectedConnectionId, "vision-1");
  assert.deepEqual(snapshot.attachments[0], {
    id: attachment.id,
    conversationId: conversation.id,
    messageId: snapshot.messages[0]?.id,
    kind: "image",
    label: "题图.png",
    summary: "图片，124 KB",
    mimeType: "image/png",
    sizeBytes: 126976,
    createdAt: "2026-07-09T08:00:00.000Z",
  });
  assert.equal(JSON.stringify(snapshot.attachments).includes("data:image"), false);
});

test("conversation model selection persists provider-supported speed without a schema upgrade", async () => {
  await resetDatabase();
  const conversation = await conversationRepository.createConversation({ today, selectedConnectionId: "openai-1", selectedModelId: "gpt-test", selectedRuntimeValues: { speed: "priority" } });
  await conversationRepository.setConversationModelSelection(conversation.id, "openai-1", "gpt-next", { speed: "standard" }, today);
  const snapshot = await conversationRepository.loadSnapshot(today);
  assert.equal(snapshot.conversations[0]?.selectedModelId, "gpt-next");
  assert.deepEqual(snapshot.conversations[0]?.selectedRuntimeValues, { speed: "standard" });
  assert.equal(snapshot.conversations[0]?.selectedSpeedMode, undefined);
});

test("同一时间戳的消息按轮次序号稳定保持用户在 AI 之前", async () => {
  await resetDatabase();
  const conversation = await conversationRepository.createConversation({ today });
  await conversationRepository.appendMessage({ conversationId: conversation.id, turnId: "turn-1", sequence: 2, role: "assistant", content: "回答", today });
  await conversationRepository.appendMessage({ conversationId: conversation.id, turnId: "turn-1", sequence: 0, role: "user", content: "问题", today });
  const snapshot = await conversationRepository.loadSnapshot(today);
  assert.deepEqual(snapshot.messages.map((message) => message.role), ["user", "assistant"]);
  assert.deepEqual(snapshot.messages.map((message) => message.turnId), ["turn-1", "turn-1"]);
});

test("旧推理与速度字段只在仓储读取时兼容为新运行值", async () => {
  await resetDatabase();
  const conversation = await conversationRepository.createConversation({ today, selectedConnectionId: "legacy", selectedModelId: "legacy-model" });
  await reviewDb.aiConversations.update(conversation.id, { selectedRuntimeValues: undefined, selectedReasoningEffort: "high", selectedSpeedMode: "priority" });
  const snapshot = await conversationRepository.loadSnapshot(today);
  assert.deepEqual(snapshot.conversations[0]?.selectedRuntimeValues, { reasoning: "high", speed: "priority" });
});

test("deleteConversation cascades conversation summaries and tool history", async () => {
  await resetDatabase();
  const conversation = await conversationRepository.createConversation({ today, title: "待删除" });
  const attachment = await conversationRepository.createAttachment({ conversationId: conversation.id, kind: "file", label: "a.txt", summary: "摘要", today });
  await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content: "内容", attachmentIds: [attachment.id], today });
  await conversationRepository.appendRunStep({ conversationId: conversation.id, runId: "delete-run", label: "工具", state: "done", today });

  await conversationRepository.deleteConversation(conversation.id);
  const snapshot = await conversationRepository.loadSnapshot(today);
  assert.equal(snapshot.conversations.some((item) => item.id === conversation.id), false);
  assert.equal(snapshot.attachments.some((item) => item.conversationId === conversation.id), false);
  assert.equal(snapshot.messages.some((item) => item.conversationId === conversation.id), false);
  assert.equal(snapshot.runSteps.some((item) => item.conversationId === conversation.id), false);
});

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
});
