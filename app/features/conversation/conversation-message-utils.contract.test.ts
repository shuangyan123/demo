import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AiProviderFailureError, aiProviderFailureMessage } from "../../services/ai-provider-failure.ts";
import { throwClientStreamFailureForProvider } from "../../services/ai-provider-failure-client.ts";
import {
  conversationProviderErrorMessage,
  requireConversationAssistantContent,
} from "./conversation-message-utils.ts";

test("Conversation presents typed provider failures by code and leaves ordinary errors unchanged", () => {
  const failure = { code: "rate_limit", provider: "deepseek", retry: "after-delay" } as const;
  const typed = new AiProviderFailureError(failure, "vendor 503 overload");
  assert.equal(conversationProviderErrorMessage(typed), aiProviderFailureMessage("rate_limit"));
  assert.equal(conversationProviderErrorMessage(new Error("本地文件读取失败 503")), "本地文件读取失败 503");
});

test("normalized stream failure remains typed when a feature receives the error event", async () => {
  await assert.rejects(
    () => throwClientStreamFailureForProvider("deepseek", {
      type: "error",
      message: "vendor 429 overload",
      failure: { code: "rate_limit", provider: "deepseek", retry: "after-delay" },
    }),
    (error: unknown) => error instanceof AiProviderFailureError && error.failure.code === "rate_limit",
  );
});

test("unrecognized stream failure is rebuilt as safe typed unknown", async () => {
  await assert.rejects(
    () => throwClientStreamFailureForProvider("deepseek", {
      type: "error",
      message: "apiKey=fixture-key vendor 503 overload",
      requestId: "route-unknown",
    }),
    (error: unknown) => error instanceof AiProviderFailureError
      && error.failure.code === "unknown"
      && error.message === aiProviderFailureMessage("unknown")
      && !error.message.includes("fixture-key"),
  );
});

test("Conversation requires visible assistant content before persistence", () => {
  assert.equal(requireConversationAssistantContent("  Hello\n"), "Hello");
  assert.throws(() => requireConversationAssistantContent(" \n\t"), /未写入助手消息/);
});

test("Conversation persistence path has no fabricated empty-success fallback", async () => {
  const source = await readFile(path.resolve(process.cwd(), "app/features/conversation/conversation-workspace.tsx"), "utf8");
  const append = source.indexOf("conversationRepository.appendMessage({");
  const contentGuard = source.indexOf("content: requireConversationAssistantContent(finalContent)", append);
  const completed = source.indexOf("recordCompletedTurn({", contentGuard);
  assert.ok(append >= 0);
  assert.ok(contentGuard > append);
  assert.ok(completed > contentGuard);
  assert.doesNotMatch(source, /模型没有返回文本/);
  assert.doesNotMatch(source, /throw new Error\(event\.message\)/);
});
