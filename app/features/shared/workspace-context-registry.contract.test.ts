import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceContextPanel, type WorkspaceContextPanelRegistration } from "./workspace-context-registry.ts";

test("ContextPanel registration resolves the first matching workspace owner", () => {
  const registrations: WorkspaceContextPanelRegistration[] = [
    { id: "dashboard", title: "总览工具", content: "dashboard", matches: (context) => context.view === "dashboard" },
    { id: "conversation", title: "对话上下文", content: "conversation", matches: (context) => context.view === "conversation" },
  ];

  assert.equal(resolveWorkspaceContextPanel(registrations, { view: "conversation" })?.id, "conversation");
  assert.equal(resolveWorkspaceContextPanel(registrations, { view: "settings" }), undefined);
});

test("ContextPanel registration can be selected by a narrower active context", () => {
  const registrations: WorkspaceContextPanelRegistration[] = [
    { id: "conversation-specific", title: "会话资料", content: "specific", matches: (context) => context.view === "conversation" && context.conversationId === "chat-1" },
    { id: "conversation-generic", title: "通用对话", content: "generic", matches: (context) => context.view === "conversation" },
  ];

  assert.equal(resolveWorkspaceContextPanel(registrations, { view: "conversation", conversationId: "chat-1" })?.id, "conversation-specific");
  assert.equal(resolveWorkspaceContextPanel(registrations, { view: "conversation", conversationId: "chat-2" })?.id, "conversation-generic");
});
