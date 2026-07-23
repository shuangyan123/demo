import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationSnapshot } from "../types/domains/automation.ts";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { Mistake } from "../types/domains/review.ts";
import { buildCommandSearchResults } from "./command-search.ts";

const now = "2026-07-09T08:00:00.000Z";

test("command search groups conversations, study modules, plugins and settings", () => {
  const mistake: Mistake = {
    id: "mistake-1",
    board: "政治理论",
    source: "粉笔",
    stem: "马克思主义基本原理题",
    answer: "A",
    explanation: "解析",
    reasons: [],
    tags: [],
    mastery: 2,
    nextReviewAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const entry: KnowledgeEntry = {
    id: "knowledge-1",
    category: "政治理论",
    title: "实践与认识",
    summary: "认识论核心",
    content: "正文",
    tags: [],
    source: "手动",
    favorite: false,
    mastery: 2,
    nextReviewAt: now,
    reviewCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const automationSnapshot: AutomationSnapshot = {
    definitions: [],
    runs: [],
    unreadCount: 0,
  };
  const results = buildCommandSearchResults({
    projects: [{ id: "civil-service", label: "公考", description: "专项", studyDomainId: "civil-service", createdAt: now, updatedAt: now }],
    conversations: [{ id: "conversation-1", projectId: "civil-service", studyDomainId: "civil-service", title: "资料分析", kind: "general", status: "active", sourceType: "manual", lastMessagePreview: "增长率", messageCount: 2, createdAt: now, updatedAt: now }],
    mistakes: [mistake],
    knowledgeEntries: [entry],
    automationSnapshot,
  }, "资料");

  assert.equal(results.some((result) => result.group === "chat" && result.conversationId === "conversation-1"), true);
  assert.equal(results.some((result) => result.group === "mistake"), false);
  const all = buildCommandSearchResults({ projects: [], conversations: [], mistakes: [], knowledgeEntries: [], automationSnapshot }, "MCP");
  assert.equal(all.some((result) => result.id === "settings:mcp"), true);
  const plugins = buildCommandSearchResults({ projects: [], conversations: [], mistakes: [], knowledgeEntries: [], automationSnapshot }, "插件");
  assert.equal(plugins.some((result) => result.group === "plugin" && result.view === "plugins"), true);
  assert.equal(all.some((result) => result.id === "settings:plugins"), false);
  assert.equal(all.some((result) => result.id === "new-chat"), false);
});
