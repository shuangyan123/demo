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
    createdAt: "2026-07-09",
  });
  assert.equal(JSON.stringify(snapshot.attachments).includes("data:image"), false);
});

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
});
