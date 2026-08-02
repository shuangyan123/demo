import type { ViewKey } from "../../types/domains/workspace.ts";
import type { SettingsSectionKey } from "../settings/settings-workspace-navigation.tsx";

export type SampleScenarioDefinition = {
  id: string;
  label: string;
  view: ViewKey;
  variant: "normal" | "needs-review" | "failed" | "active" | "completed" | "cancelled" | "dense" | "mixed" | "credential-recovery";
  fixtureOwner?: "workspace" | "settings";
  settingsSection?: SettingsSectionKey;
};

export const sampleScenarioDefinitions = [
  { id: "dashboard-normal", label: "总览 · 今日队列与薄弱板块", view: "dashboard", variant: "normal" },
  { id: "conversation-normal", label: "对话 · 多轮与工具步骤", view: "conversation", variant: "normal" },
  { id: "library-normal", label: "错题库 · 已关联知识", view: "library", variant: "normal" },
  { id: "review-normal", label: "复盘 · 今日到期队列", view: "review", variant: "normal" },
  { id: "knowledge-normal", label: "知识库 · 非空资料", view: "knowledge", variant: "normal" },
  { id: "knowledge-training-normal", label: "知识训练 · 到期卡片", view: "knowledgeTraining", variant: "normal" },
  { id: "stats-normal", label: "统计 · 近 30 天趋势", view: "stats", variant: "normal" },
  { id: "library-insights-dense", label: "薄弱分析 · 六板块密集数据", view: "library", variant: "dense" },
  { id: "import-normal", label: "导入 · 可确认草稿", view: "import", variant: "normal" },
  { id: "import-needs-review", label: "导入 · 待人工复核", view: "import", variant: "needs-review" },
  { id: "import-console-mixed", label: "粉笔导入 · 混合批次控制台", view: "import", variant: "mixed" },
  { id: "plugins-directory-dense", label: "插件 · 主从目录与扩展", view: "plugins", variant: "dense", fixtureOwner: "settings" },
  { id: "settings-ai-connections-dense", label: "AI 连接 · 三连接与默认能力", view: "settings", variant: "dense", fixtureOwner: "settings", settingsSection: "configuration" },
  { id: "settings-ai-credential-recovery", label: "AI 连接 · 凭据恢复", view: "settings", variant: "credential-recovery", fixtureOwner: "settings", settingsSection: "configuration" },
  { id: "automation-normal", label: "已安排 · 成功收件箱", view: "automation", variant: "normal" },
  { id: "automation-failed", label: "已安排 · 运行失败", view: "automation", variant: "failed" },
  { id: "interview-active", label: "面试 · 进行中", view: "interview", variant: "active" },
  { id: "interview-completed", label: "面试 · 已完成", view: "interview", variant: "completed" },
  { id: "interview-cancelled", label: "面试 · 已中止", view: "interview", variant: "cancelled" },
  { id: "tutoring-active", label: "辅导 · 进行中", view: "tutoring", variant: "active" },
] as const satisfies readonly SampleScenarioDefinition[];

export type SampleScenarioId = typeof sampleScenarioDefinitions[number]["id"];

export function sampleScenariosForView(view: ViewKey, settingsSection?: SettingsSectionKey): readonly SampleScenarioDefinition[] {
  return sampleScenarioDefinitions.filter((scenario) => (
    scenario.view === view
    && (view !== "settings" || ("settingsSection" in scenario && scenario.settingsSection === settingsSection))
  ));
}

export function getSampleScenario(id: string): SampleScenarioDefinition | undefined {
  return sampleScenarioDefinitions.find((scenario) => scenario.id === id);
}
