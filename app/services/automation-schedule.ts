import type { AutomationDefinition, AutomationSchedule } from "../types/review.ts";

const MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_MISSED_SCAN = 1000;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 校验 IANA 时区，避免 Cron 库在执行阶段才抛出难懂异常。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function scheduleExpression(schedule: AutomationSchedule): string | undefined {
  if (schedule.kind === "cron") return schedule.expression.trim();
  if (schedule.kind === "interval") return undefined;
  const match = TIME_PATTERN.exec(schedule.time);
  if (!match) throw new Error("执行时间必须使用 HH:mm 格式");
  const [, hour, minute] = match;
  return schedule.kind === "daily" ? `${minute} ${hour} * * *` : `${minute} ${hour} * * ${schedule.weekday}`;
}

/** 计算严格晚于起点的下一次执行时间；Cron 依赖只在使用调度功能时加载。 */
export async function nextAutomationRun(schedule: AutomationSchedule, timeZone: string, after: Date): Promise<Date> {
  if (!isValidTimeZone(timeZone)) throw new Error("自动化时区无效");
  if (schedule.kind === "interval") {
    if (!Number.isInteger(schedule.intervalMinutes) || schedule.intervalMinutes < 5) {
      throw new Error("固定间隔不能少于 5 分钟");
    }
    return new Date(after.getTime() + schedule.intervalMinutes * 60 * 1000);
  }
  if (schedule.kind === "weekly" && (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6)) {
    throw new Error("每周执行日期无效");
  }
  const expression = scheduleExpression(schedule)!;
  if (schedule.kind === "cron" && expression.split(/\s+/).length !== 5) {
    throw new Error("Cron 必须包含分钟、小时、日期、月份、星期五个字段");
  }
  const { CronExpressionParser } = await import("cron-parser");
  const interval = CronExpressionParser.parse(expression, { currentDate: after, tz: timeZone });
  return interval.next().toDate();
}

/** 完整校验调度，并阻止频率高于五分钟的 Cron。 */
export async function validateAutomationSchedule(schedule: AutomationSchedule, timeZone: string, from = new Date()): Promise<void> {
  const first = await nextAutomationRun(schedule, timeZone, from);
  const second = await nextAutomationRun(schedule, timeZone, first);
  if (second.getTime() - first.getTime() < MIN_INTERVAL_MS) throw new Error("自动化执行间隔不能少于 5 分钟");
}

export type DueAutomationState = {
  due: boolean;
  scheduledAt?: string;
  nextRunAt: string;
  missedCount: number;
};

/** 合并计算漏跑状态；即使关闭数月，也只返回一项待执行任务。 */
export async function calculateDueAutomation(definition: AutomationDefinition, now = new Date()): Promise<DueAutomationState> {
  const first = definition.nextRunAt ? new Date(definition.nextRunAt) : await nextAutomationRun(definition.schedule, definition.timeZone, new Date(definition.createdAt));
  if (first.getTime() > now.getTime()) return { due: false, nextRunAt: first.toISOString(), missedCount: 0 };

  let latest = first;
  let count = 1;
  let next = await nextAutomationRun(definition.schedule, definition.timeZone, latest);
  while (next.getTime() <= now.getTime() && count < MAX_MISSED_SCAN) {
    latest = next;
    count += 1;
    next = await nextAutomationRun(definition.schedule, definition.timeZone, latest);
  }
  if (count === MAX_MISSED_SCAN && next.getTime() <= now.getTime()) {
    next = await nextAutomationRun(definition.schedule, definition.timeZone, now);
  }
  return { due: true, scheduledAt: latest.toISOString(), nextRunAt: next.toISOString(), missedCount: count - 1 };
}
