import { AUTOMATION_TEMPLATES } from "../../services/automation-executor";
import type { AutomationDefinitionInput } from "../../services/automation-repository";
import type { AutomationDefinition, AutomationRun, AutomationSchedule, AutomationSourceScope, AutomationTemplateId } from "../../types/domains/automation.ts";
import type { AutomationCollectionConfig } from "../../types/domains/acquisition.ts";

/** 已安排编辑器可选择的只读数据范围。 */
export const AUTOMATION_SOURCE_OPTIONS: Array<{ id: AutomationSourceScope; label: string }> = [
  { id: "mistakes", label: "错题" },
  { id: "knowledge", label: "知识库" },
  { id: "interview", label: "面试" },
  { id: "tutoring", label: "辅导" },
  { id: "obsidian", label: "Obsidian 映射" },
];

/** 读取浏览器 IANA 时区，无法识别时使用项目默认时区。 */
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
}

/** 三个采集模板默认不启用任何外部来源。 */
function createCollectionConfig(domain: AutomationCollectionConfig["domain"]): AutomationCollectionConfig {
  const queries = domain === "xingce"
    ? ["行测 题型方法 答案依据"]
    : domain === "shenlun" ? ["申论 政策原文 主题素材"] : ["结构化面试 热点 事实 作答框架"];
  return { domain, queries, sources: [], allowedOrigins: [], freshnessDays: 30, maxDocuments: 10 };
}

/** 根据内置模板创建一份互不共享引用的表单草稿。 */
export function createAutomationDraft(templateId: AutomationTemplateId = "daily_review"): AutomationDefinitionInput {
  const template = AUTOMATION_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error("已安排模板不存在");
  return {
    name: template.name,
    templateId,
    prompt: template.prompt,
    sourceScopes: [...template.scopes],
    enabled: true,
    timeZone: localTimeZone(),
    schedule: templateId === "weekly_progress"
      ? { kind: "weekly", weekday: 1, time: "09:00" }
      : { kind: "daily", time: "08:00" },
    collectionConfig: template.collectionDomain ? createCollectionConfig(template.collectionDomain) : undefined,
  };
}

/** 将已保存任务复制为编辑草稿，避免表单直接修改快照对象。 */
export function createEditDraft(definition: AutomationDefinition): AutomationDefinitionInput {
  return {
    name: definition.name,
    templateId: definition.templateId,
    prompt: definition.prompt,
    sourceScopes: [...definition.sourceScopes],
    enabled: definition.enabled,
    timeZone: definition.timeZone,
    schedule: { ...definition.schedule },
    collectionConfig: definition.collectionConfig ? structuredClone(definition.collectionConfig) : undefined,
  };
}

/** 为切换后的调度类型提供安全、可立即编辑的默认值。 */
export function createSchedule(kind: AutomationSchedule["kind"]): AutomationSchedule {
  if (kind === "interval") return { kind, intervalMinutes: 60 };
  if (kind === "daily") return { kind, time: "08:00" };
  if (kind === "weekly") return { kind, weekday: 1, time: "09:00" };
  return { kind, expression: "0 8 * * *" };
}

/** 将调度配置格式化为任务卡片可读文本。 */
export function formatSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === "interval") return `每 ${schedule.intervalMinutes} 分钟`;
  if (schedule.kind === "daily") return `每天 ${schedule.time}`;
  if (schedule.kind === "weekly") return `每周${["日", "一", "二", "三", "四", "五", "六"][schedule.weekday]} ${schedule.time}`;
  return `Cron ${schedule.expression}`;
}

/** 使用中文本地化格式展示运行时间。 */
export function formatAutomationDate(value?: string): string {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "尚未运行";
}

/** 单次遍历运行记录，避免每张任务卡都重复筛选完整收件箱。 */
export function countRunsByAutomation(runs: AutomationRun[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.automationId, (counts.get(run.automationId) ?? 0) + 1);
  return counts;
}

/** 将未知异常转换成稳定的中文反馈。 */
export function automationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
