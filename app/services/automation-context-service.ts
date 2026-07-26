import { reviewDb } from "../db/review-db.ts";
import type { AutomationContextSummary, AutomationSourceScope } from "../types/domains/automation.ts";

const MAX_ITEMS_PER_SCOPE = 30;
const MAX_TEXT_LENGTH = 1200;
const SAMPLE_LIMIT = 3;

export type AutomationContextBuildResult = {
  context: Record<string, unknown>;
  summary: AutomationContextSummary[];
  contextCharCount: number;
};

export type AutomationContextPreview = Pick<AutomationContextBuildResult, "summary" | "contextCharCount">;

const SCOPE_LABELS: Record<AutomationSourceScope, string> = {
  mistakes: "错题",
  knowledge: "知识库",
  interview: "面试",
  tutoring: "辅导",
  obsidian: "Obsidian 映射",
};

function clip(value: string): string {
  return value.trim().slice(0, MAX_TEXT_LENGTH);
}

function sampleTitles(values: Array<string | undefined>): string[] {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)).slice(0, SAMPLE_LIMIT);
}

function summarize(scope: AutomationSourceScope, count: number, titles: string[]): AutomationContextSummary {
  return {
    scope,
    label: SCOPE_LABELS[scope],
    count,
    sampleTitles: titles,
    warning: count ? undefined : "当前范围暂无可读取数据",
  };
}

/** 只读取任务明确授权的数据范围，并同时生成不含完整正文的摘要。 */
export async function buildAutomationContextResult(scopes: AutomationSourceScope[]): Promise<AutomationContextBuildResult> {
  const allowed = new Set(scopes);
  const context: Record<string, unknown> = {};
  const summary: AutomationContextSummary[] = [];

  await Promise.all([
    allowed.has("mistakes") ? reviewDb.mistakes.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.mistakes = items.map((item) => ({ id: item.id, board: item.board, stem: clip(item.stem), explanation: clip(item.explanation), reasons: item.reasons, tags: item.tags, mastery: item.mastery, nextReviewAt: item.nextReviewAt }));
      summary.push(summarize("mistakes", items.length, sampleTitles(items.map((item) => `${item.board} · ${item.stem}`))));
    }) : undefined,
    allowed.has("knowledge") ? reviewDb.knowledgeEntries.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.knowledge = items.map((item) => ({ id: item.id, category: item.category, title: item.title, summary: clip(item.summary), content: clip(item.content), tags: item.tags, mastery: item.mastery, nextReviewAt: item.nextReviewAt }));
      summary.push(summarize("knowledge", items.length, sampleTitles(items.map((item) => item.title))));
    }) : undefined,
    allowed.has("interview") ? Promise.all([
      reviewDb.interviewSessions.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray(),
      reviewDb.interviewEvaluations.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray(),
    ]).then(([sessions, evaluations]) => {
      context.interview = {
        sessions: sessions.map((item) => ({ id: item.id, title: item.title, status: item.status, completedAt: item.completedAt, transcript: clip(item.transcriptText) })),
        evaluations: evaluations.map((item) => ({ sessionId: item.sessionId, totalScore: item.totalScore, strengths: item.strengths, problems: item.problems, suggestions: item.suggestions })),
      };
      summary.push(summarize("interview", sessions.length + evaluations.length, sampleTitles(sessions.map((item) => item.title))));
    }) : undefined,
    allowed.has("tutoring") ? reviewDb.tutoringSessions.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.tutoring = items.map((item) => ({ id: item.id, topic: item.topic, goal: item.goal, status: item.status, summary: clip(item.summary), nextActions: item.nextActions, completedAt: item.completedAt }));
      summary.push(summarize("tutoring", items.length, sampleTitles(items.map((item) => item.topic))));
    }) : undefined,
    allowed.has("obsidian") ? reviewDb.obsidianNoteMappings.orderBy("updatedAt").reverse().limit(MAX_ITEMS_PER_SCOPE).toArray().then((items) => {
      context.obsidian = items.map((item) => ({ path: item.path, knowledgeId: item.knowledgeId, category: item.category, status: item.status, wikilinks: item.wikilinks, sourceRefs: item.sourceRefs, updatedAt: item.updatedAt }));
      summary.push(summarize("obsidian", items.length, sampleTitles(items.map((item) => item.path))));
    }) : undefined,
  ]);

  const orderedSummary = scopes.map((scope) => summary.find((item) => item.scope === scope)).filter((item): item is AutomationContextSummary => Boolean(item));
  return { context, summary: orderedSummary, contextCharCount: JSON.stringify(context).length };
}

/** 为 UI 预览提供摘要，不暴露完整上下文正文。 */
export async function buildAutomationContextPreview(scopes: AutomationSourceScope[]): Promise<AutomationContextPreview> {
  const result = await buildAutomationContextResult(scopes);
  return { summary: result.summary, contextCharCount: result.contextCharCount };
}

/** 兼容旧执行路径：只返回模型需要的上下文对象。 */
export async function buildAutomationContext(scopes: AutomationSourceScope[]): Promise<Record<string, unknown>> {
  return (await buildAutomationContextResult(scopes)).context;
}
