import { expect, type Page } from "@playwright/test";
import { learningEventId } from "../../app/types/domains/learning-event";
import { replaceLearningFacts } from "./learning-loop-fixtures";

export const l6Now = new Date("2026-09-14T08:00:00.000Z");

export function l6Mistake(id: string, nextReviewAt = "2026-09-01") {
  return { id, board: "判断推理", source: "L6 E2E", stem: `L6 错题 ${id}`, answer: "A", explanation: `L6 解析 ${id}`, reasons: [`L6 错因 ${id}`], tags: ["L6"], mastery: 2, nextReviewAt, createdAt: "2026-09-01", updatedAt: "2026-09-14" };
}

export function l6Knowledge(id: string, nextReviewAt = "2026-09-01") {
  return { id, category: "常识判断", title: `L6 知识 ${id}`, summary: `L6 摘要 ${id}`, content: `L6 资料正文 ${id}`, tags: ["L6"], source: "L6 E2E", favorite: false, mastery: 2, nextReviewAt, reviewCount: 0, createdAt: "2026-09-01", updatedAt: "2026-09-14" };
}

export function l6ReviewAttempt(id: string, mistakeId: string, result: "correct" | "uncertain" | "wrong", reviewedAt: string) {
  return { id, mistakeId, result, confidence: 3, reviewedAt };
}

export function l6KnowledgeAttempt(id: string, knowledgeId: string, result: "correct" | "uncertain" | "wrong", reviewedAt: string) {
  return { id, knowledgeId, result, confidence: 3, reviewedAt };
}

export function l6ReviewEvent(attempt: ReturnType<typeof l6ReviewAttempt>, patch: Record<string, unknown> = {}) {
  return { id: learningEventId("review_attempt", attempt.id), sourceType: "review_attempt", sourceId: attempt.id, subjectType: "mistake", subjectId: attempt.mistakeId, outcome: attempt.result, observedAt: attempt.reviewedAt, masteryAfter: attempt.confidence, ...patch };
}

export function l6KnowledgeEvent(attempt: ReturnType<typeof l6KnowledgeAttempt>, patch: Record<string, unknown> = {}) {
  return { id: learningEventId("knowledge_attempt", attempt.id), sourceType: "knowledge_attempt", sourceId: attempt.id, subjectType: "knowledge", subjectId: attempt.knowledgeId, outcome: attempt.result, observedAt: attempt.reviewedAt, masteryAfter: attempt.confidence, ...patch };
}

export async function seedL6(page: Page, records: Record<string, unknown[]>): Promise<void> {
  await page.clock.setFixedTime(l6Now);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await replaceLearningFacts(page, records);
  await page.reload();
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
}

async function ensureDetailsOpen(summary: ReturnType<Page["locator"]>): Promise<void> {
  if (!(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open))) await summary.click();
}

export async function openL6Nav(page: Page, name: string, mobile = false): Promise<void> {
  if (mobile) await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  const sidebar = mobile ? page.getByRole("dialog", { name: "应用导航" }) : page.locator(".chrome-sidebar:visible");
  if (!["总览", "已安排"].includes(name)) {
    for (const label of ["公考", "学习"]) {
      await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: label }).first());
    }
  }
  await sidebar.getByRole("button", { name, exact: true }).click();
  if (mobile) await expect(sidebar).toBeHidden();
}

export async function readL6Event(page: Page, sourceType: "review_attempt" | "knowledge_attempt", subjectId: string) {
  return page.evaluate(({ expectedSourceType, expectedSubjectId }) => new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("learningEvents", "readonly");
      const read = transaction.objectStore("learningEvents").getAll();
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        database.close();
        resolve((read.result as Array<Record<string, unknown>>).find((event) => event.sourceType === expectedSourceType && event.subjectId === expectedSubjectId));
      };
    };
  }), { expectedSourceType: sourceType, expectedSubjectId: subjectId });
}
