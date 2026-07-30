import type { DevelopmentExampleOption } from "./development-example-switcher";
import type { ViewKey } from "../../types/domains/workspace.ts";

export type DevelopmentExampleFixtureVariant = "populated" | "failed" | "needs-review";

/** 开发示例只描述要渲染的真实视图与内存 fixture，不携带 repository 或外部服务。 */
export type DevelopmentExampleDefinition = DevelopmentExampleOption & {
  view: ViewKey;
  fixture: DevelopmentExampleFixtureVariant;
};

export const workspaceDevelopmentExampleDefinitions = [
  { id: "dashboard-populated", label: "今日队列和薄弱板块", view: "dashboard", fixture: "populated" },
  { id: "conversation-populated", label: "已有消息和工具结果", view: "conversation", fixture: "populated" },
  { id: "library-populated", label: "已有筛选和选中详情", view: "library", fixture: "populated" },
  { id: "review-populated", label: "非空复盘队列和当前题目", view: "review", fixture: "populated" },
  { id: "knowledge-populated", label: "已有知识资料和关联", view: "knowledge", fixture: "populated" },
  { id: "knowledge-training-populated", label: "到期训练队列和当前卡片", view: "knowledgeTraining", fixture: "populated" },
  { id: "stats-populated", label: "已有学习统计", view: "stats", fixture: "populated" },
  { id: "import-populated", label: "已解析导入草稿", view: "import", fixture: "populated" },
  { id: "import-needs-review", label: "导入内容待复核", view: "import", fixture: "needs-review" },
  { id: "automation-populated", label: "已有任务和运行收件箱", view: "automation", fixture: "populated" },
  { id: "automation-run-failed", label: "运行失败与恢复入口", view: "automation", fixture: "failed" },
  { id: "interview-populated", label: "进行中的面试与文字稿", view: "interview", fixture: "populated" },
  { id: "tutoring-populated", label: "进行中的辅导与学习计划", view: "tutoring", fixture: "populated" },
] as const satisfies readonly DevelopmentExampleDefinition[];

export type WorkspaceDevelopmentExampleId = typeof workspaceDevelopmentExampleDefinitions[number]["id"];

export const workspaceDevelopmentExampleOptions: DevelopmentExampleOption[] = workspaceDevelopmentExampleDefinitions.map(({ id, label }) => ({ id, label }));

export const civilServiceModuleDevelopmentExamples = Object.fromEntries(
  workspaceDevelopmentExampleDefinitions.map((definition) => [definition.view, [] as DevelopmentExampleOption[]]),
) as Partial<Record<ViewKey, DevelopmentExampleOption[]>>;

for (const definition of workspaceDevelopmentExampleDefinitions) {
  civilServiceModuleDevelopmentExamples[definition.view]!.push({ id: definition.id, label: definition.label });
}

export function developmentExamplesForCivilServiceModule(view: ViewKey): DevelopmentExampleOption[] {
  return civilServiceModuleDevelopmentExamples[view] ?? [];
}

export function developmentExamplesForValue(value: string | undefined): DevelopmentExampleOption[] {
  const definition = workspaceDevelopmentExampleDefinitions.find((item) => item.id === value);
  return definition ? developmentExamplesForCivilServiceModule(definition.view) : [];
}

export function developmentExampleDefinition(value: WorkspaceDevelopmentExampleId): DevelopmentExampleDefinition {
  return workspaceDevelopmentExampleDefinitions.find((item) => item.id === value)!;
}

export function isWorkspaceDevelopmentExample(value: string | undefined): value is WorkspaceDevelopmentExampleId {
  return process.env.NODE_ENV === "development"
    && workspaceDevelopmentExampleDefinitions.some((definition) => definition.id === value);
}
