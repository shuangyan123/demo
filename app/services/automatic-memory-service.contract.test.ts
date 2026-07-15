import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitMemory } from "./automatic-memory-service.ts";

test("明确记住表达本地生效且秘密被丢弃", () => {
  const memory = extractExplicitMemory({ user: "以后请先给结论，再解释依据", assistant: "好的", conversationId: "c", sourceMessageIds: ["u", "a"] });
  assert.equal(memory?.kind, "preference");
  assert.equal(memory?.confidence, 1);
  assert.deepEqual(memory?.sourceMessageIds, ["u", "a"]);
  assert.equal(extractExplicitMemory({ user: "请记住 API Key: sk-secret-value-123456", assistant: "", conversationId: "c", sourceMessageIds: [] }), undefined);
});
