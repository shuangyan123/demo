import type { AutomationDefinition, AutomationRun, AutomationSnapshot } from "../../types/domains/automation.ts";

/** 已安排任务列表支持的轻量筛选。 */
export type AutomationStatusFilter = "all" | "enabled" | "disabled" | "failed";

/** 为每个任务建立最近运行索引，避免列表渲染时重复扫描。 */
export function latestRunsByAutomation(runs: AutomationRun[]): Map<string, AutomationRun> {
  const latest = new Map<string, AutomationRun>();
  for (const run of runs) {
    if (!latest.has(run.automationId)) latest.set(run.automationId, run);
  }
  return latest;
}

/** 计算顶部摘要；所有数值均来自当前可序列化快照。 */
export function deriveAutomationOverview(snapshot: AutomationSnapshot) {
  let nextRunAt: string | undefined;
  let enabledCount = 0;
  for (const definition of snapshot.definitions) {
    if (!definition.enabled) continue;
    enabledCount += 1;
    if (definition.nextRunAt && (!nextRunAt || definition.nextRunAt < nextRunAt)) nextRunAt = definition.nextRunAt;
  }
  return { enabledCount, nextRunAt, pendingCount: snapshot.unreadCount };
}

/** 单次筛选任务，失败筛选读取最近一次运行状态。 */
export function filterAutomationDefinitions(
  definitions: AutomationDefinition[],
  search: string,
  status: AutomationStatusFilter,
  latestRuns: Map<string, AutomationRun>,
): AutomationDefinition[] {
  const query = search.trim().toLocaleLowerCase("zh-CN");
  return definitions.filter((definition) => {
    if (status === "enabled" && !definition.enabled) return false;
    if (status === "disabled" && definition.enabled) return false;
    if (status === "failed" && latestRuns.get(definition.id)?.status !== "failed") return false;
    if (!query) return true;
    const schedule = definition.schedule.kind === "interval"
      ? `每 ${definition.schedule.intervalMinutes} 分钟`
      : definition.schedule.kind === "daily"
        ? `每天 ${definition.schedule.time}`
        : definition.schedule.kind === "weekly"
          ? `每周 ${definition.schedule.time}`
          : `Cron ${definition.schedule.expression}`;
    return `${definition.name} ${definition.templateId} ${schedule}`.toLocaleLowerCase("zh-CN").includes(query);
  });
}
