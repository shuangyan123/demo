import { reviewDb } from "../db/review-db.ts";
import type { AutomationSourceScope } from "../types/review.ts";

const MAX_ITEMS_PER_SCOPE = 30;
const MAX_TEXT_LENGTH = 1200;

function clip(value: string): string {
  return value.trim().slice(0, MAX_TEXT_LENGTH);
}

/** 只读取任务明确授权的数据范围，并压缩为适合文本模型的上下文。 */
export async function buildAutomationContext(scopes: AutomationSourceScope[]): Promise<Record<string, unknown>> {
  const allowed = new Set(scopes);
  const context: Record<string, unknown> = {};

  await Promise.all([
    allowed.has("mistakes") ? reviewDb.mistakes.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.mistakes = items.map((item) => ({ id: item.id, board: item.board, stem: clip(item.stem), explanation: clip(item.explanation), reasons: item.reasons, tags: item.tags, mastery: item.mastery, nextReviewAt: item.nextReviewAt }));
    }) : undefined,
    allowed.has("knowledge") ? reviewDb.knowledgeEntries.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.knowledge = items.map((item) => ({ id: item.id, category: item.category, title: item.title, summary: clip(item.summary), content: clip(item.content), tags: item.tags, mastery: item.mastery, nextReviewAt: item.nextReviewAt }));
    }) : undefined,
    allowed.has("interview") ? Promise.all([
      reviewDb.interviewSessions.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray(),
      reviewDb.interviewEvaluations.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray(),
    ]).then(([sessions, evaluations]) => {
      context.interview = {
        sessions: sessions.map((item) => ({ id: item.id, title: item.title, status: item.status, completedAt: item.completedAt, transcript: clip(item.transcriptText) })),
        evaluations: evaluations.map((item) => ({ sessionId: item.sessionId, totalScore: item.totalScore, strengths: item.strengths, problems: item.problems, suggestions: item.suggestions })),
      };
    }) : undefined,
    allowed.has("tutoring") ? reviewDb.tutoringSessions.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.tutoring = items.map((item) => ({ id: item.id, topic: item.topic, goal: item.goal, status: item.status, summary: clip(item.summary), nextActions: item.nextActions, completedAt: item.completedAt }));
    }) : undefined,
    allowed.has("obsidian") ? reviewDb.obsidianNoteMappings.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.obsidian = items.map((item) => ({ path: item.path, knowledgeId: item.knowledgeId, category: item.category, status: item.status, wikilinks: item.wikilinks, sourceRefs: item.sourceRefs, updatedAt: item.updatedAt }));
    }) : undefined,
  ]);

  return context;
}
