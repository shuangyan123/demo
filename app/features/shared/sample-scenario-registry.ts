import type { ViewKey } from "../../types/domains/workspace.ts";

export type SampleScenarioDefinition = {
  id: string;
  label: string;
  view: ViewKey;
  variant: "normal" | "needs-review" | "failed" | "active" | "completed" | "cancelled";
};

export const sampleScenarioDefinitions = [
  { id: "dashboard-normal", label: "总览 · 今日队列与薄弱板块", view: "dashboard", variant: "normal" },
  { id: "conversation-normal", label: "对话 · 多轮与工具步骤", view: "conversation", variant: "normal" },
  { id: "library-normal", label: "错题库 · 已关联知识", view: "library", variant: "normal" },
  { id: "review-normal", label: "复盘 · 今日到期队列", view: "review", variant: "normal" },
  { id: "knowledge-normal", label: "知识库 · 非空资料", view: "knowledge", variant: "normal" },
  { id: "knowledge-training-normal", label: "知识训练 · 到期卡片", view: "knowledgeTraining", variant: "normal" },
  { id: "stats-normal", label: "统计 · 近 30 天趋势", view: "stats", variant: "normal" },
  { id: "import-normal", label: "导入 · 可确认草稿", view: "import", variant: "normal" },
  { id: "import-needs-review", label: "导入 · 待人工复核", view: "import", variant: "needs-review" },
  { id: "automation-normal", label: "已安排 · 成功收件箱", view: "automation", variant: "normal" },
  { id: "automation-failed", label: "已安排 · 运行失败", view: "automation", variant: "failed" },
  { id: "interview-active", label: "面试 · 进行中", view: "interview", variant: "active" },
  { id: "interview-completed", label: "面试 · 已完成", view: "interview", variant: "completed" },
  { id: "interview-cancelled", label: "面试 · 已中止", view: "interview", variant: "cancelled" },
  { id: "tutoring-active", label: "辅导 · 进行中", view: "tutoring", variant: "active" },
] as const satisfies readonly SampleScenarioDefinition[];

export type SampleScenarioId = typeof sampleScenarioDefinitions[number]["id"];

export function sampleScenariosForView(view: ViewKey): readonly SampleScenarioDefinition[] {
  return sampleScenarioDefinitions.filter((scenario) => scenario.view === view);
}

export function getSampleScenario(id: string): SampleScenarioDefinition | undefined {
  return sampleScenarioDefinitions.find((scenario) => scenario.id === id);
}
