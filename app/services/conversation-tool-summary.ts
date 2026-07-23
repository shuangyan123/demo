import type { AiConversationRunStep } from "../types/domains/conversation.ts";

export type ConversationToolRunSummary = {
  runId: string;
  turnId?: string;
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
    .flatMap(([runId, items]): ConversationToolRunSummary[] => {
      const sorted = items.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.id.localeCompare(b.id));
      const visible = sorted.filter((step) => step.visibility === "timeline" || step.state === "error");
      if (!visible.length) return [];
      const state: ConversationToolRunSummary["state"] = sorted.some((step) => step.state === "error")
        ? "error"
        : sorted.some((step) => step.state === "running" || step.state === "pending")
          ? "running"
          : "done";
      const turnId = sorted[0]?.turnId;
      return [{
        runId,
        ...(turnId ? { turnId } : {}),
        label: state === "error" ? "运行失败" : state === "running" ? "正在运行..." : `已使用 ${visible.length} 个工具`,
        state,
        steps: visible,
        updatedAt: sorted.reduce((latest, step) => step.updatedAt > latest ? step.updatedAt : latest, sorted[0]?.updatedAt ?? ""),
      }];
    })
    .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
