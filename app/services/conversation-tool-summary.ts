import type { AiConversationRunStep } from "../types/review.ts";

export type ConversationToolRunSummary = {
  runId: string;
  label: string;
  state: "running" | "done" | "error";
  steps: AiConversationRunStep[];
  updatedAt: string;
};

export function summarizeConversationRunSteps(steps: AiConversationRunStep[]): ConversationToolRunSummary[] {
  const groups = new Map<string, AiConversationRunStep[]>();
  for (const step of steps) {
    const items = groups.get(step.runId) ?? [];
    items.push(step);
    groups.set(step.runId, items);
  }

  return Array.from(groups.entries())
    .map(([runId, items]) => {
      const sorted = items.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
      const state: ConversationToolRunSummary["state"] = sorted.some((step) => step.state === "error")
        ? "error"
        : sorted.some((step) => step.state === "running" || step.state === "pending")
          ? "running"
          : "done";
      return {
        runId,
        label: state === "error" ? "运行失败" : state === "running" ? "正在运行..." : `已运行 ${sorted.length} 条命令`,
        state,
        steps: sorted,
        updatedAt: sorted.reduce((latest, step) => step.updatedAt > latest ? step.updatedAt : latest, sorted[0]?.updatedAt ?? ""),
      };
    })
    .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
