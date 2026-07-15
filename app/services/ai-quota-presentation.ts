import type { AiQuotaMetric, AiQuotaSnapshot } from "../types/domains/ai-quota";

export type AiQuotaRingPresentation = {
  mode: "determinate" | "status" | "empty";
  ratio?: number;
  centerLabel: string;
  accessibleLabel: string;
  details: string[];
  tone: "normal" | "warning" | "danger" | "stale";
};

function metricById(snapshot: AiQuotaSnapshot, id: AiQuotaMetric["id"]): AiQuotaMetric | undefined {
  return snapshot.metrics?.find((metric) => metric.id === id);
}

/** 货币、Token 与百分比使用紧凑但不丢失币种的统一格式。 */
export function formatQuotaMetricValue(metric: AiQuotaMetric, compact = false): string {
  if (metric.unit.toLowerCase() === "tokens") {
    return `${new Intl.NumberFormat("zh-CN", { notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(metric.value)} tokens`;
  }
  const currency = metric.unit.toUpperCase();
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(metric.value);
  } catch {
    return `${metric.value.toLocaleString("zh-CN")} ${metric.unit}`;
  }
}

function sourceLabel(source: AiQuotaMetric["source"]): string {
  if (source === "official") return "官方";
  if (source === "estimated") return "估算";
  return "手动";
}

/** 将额度快照推导为“剩余比例”圆环；无可靠分母时只显示中性状态环。 */
export function deriveQuotaRingPresentation(snapshot?: AiQuotaSnapshot): AiQuotaRingPresentation {
  if (!snapshot) return { mode: "empty", centerLabel: "—", accessibleLabel: "尚无额度数据", details: ["尚未刷新额度"], tone: "normal" };
  const used = metricById(snapshot, "used_cost");
  const remaining = metricById(snapshot, "remaining_balance");
  const limit = metricById(snapshot, "spend_limit");
  const tokens = metricById(snapshot, "token_usage");
  let ratio: number | undefined;
  const centerMetric = remaining ?? used ?? tokens;
  if (limit && limit.value > 0 && remaining) ratio = Math.max(0, Math.min(1, remaining.value / limit.value));
  else if (limit && limit.value > 0 && used) ratio = Math.max(0, Math.min(1, 1 - used.value / limit.value));
  else if (typeof snapshot.usageRatio === "number") ratio = Math.max(0, Math.min(1, 1 - snapshot.usageRatio));
  const details = (snapshot.metrics ?? []).map((metric) => {
    const period = metric.periodStart || metric.periodEnd
      ? ` · ${metric.periodStart ? new Date(metric.periodStart).toLocaleDateString("zh-CN") : ""}${metric.periodEnd ? `–${new Date(metric.periodEnd).toLocaleDateString("zh-CN")}` : ""}`
      : "";
    return `${metric.label}：${formatQuotaMetricValue(metric)} · ${sourceLabel(metric.source)}${period}`;
  });
  details.push(`最后刷新：${new Date(snapshot.refreshedAt).toLocaleString("zh-CN")}${snapshot.stale ? " · 已过期" : ""}`);
  if (snapshot.sourceLabel) details.push(`来源：${snapshot.sourceLabel}`);
  if (ratio !== undefined) details.unshift(`剩余比例：${Math.round(ratio * 100)}%`);
  const centerLabel = ratio !== undefined ? `${Math.round(ratio * 100)}%` : "—";
  const tone = snapshot.stale ? "stale" : ratio !== undefined && ratio < 0.15 ? "danger" : ratio !== undefined && ratio < 0.4 ? "warning" : "normal";
  return {
    mode: ratio === undefined ? (centerMetric ? "status" : "empty") : "determinate",
    ratio,
    centerLabel,
    accessibleLabel: details.join("；"),
    details,
    tone,
  };
}
