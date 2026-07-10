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

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
});
