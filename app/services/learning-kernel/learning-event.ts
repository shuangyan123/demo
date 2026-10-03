import type {
  LearningEventKindV1,
  LearningEventProvenanceV1,
  LearningEventV1,
  LearningSourceRecordRefV1,
} from "../../types/domains/learning-kernel.ts";

export const LEGACY_EVENT_ADAPTER_ID = "recall-legacy/v1";
export const LEGACY_EVENT_NORMALIZATION_VERSION = "legacy-events/v1";
export const MAX_LEARNING_EVENT_ID_LENGTH = 8192;

/** 身份过长或含无效 Unicode 时显式拒绝，绝不截断制造碰撞。 */
export function isLegacyRecordId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && value.isWellFormed();
}

export function legacyLearningEventId(ref: LearningSourceRecordRefV1, kind: LearningEventKindV1): string | null {
  if (!isLegacyRecordId(ref.recordId) || (ref.revision !== undefined && (ref.revision.length > 4096 || !ref.revision.isWellFormed()))) return null;
  // 各分量独立转义，源 ID 中的分隔符和 revision 不会改变结构。
  const parts = [LEGACY_EVENT_ADAPTER_ID, ref.recordType, ref.recordId, kind];
  if (ref.revision !== undefined) parts.push(ref.revision);
  const id = parts.map((part) => encodeURIComponent(part)).join("/");
  return id.length <= MAX_LEARNING_EVENT_ID_LENGTH ? id : null;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export function isLearningEventInstant(value: unknown): value is string {
  if (typeof value !== "string" || !isDate(value.slice(0, 10))) return false;
  const match = value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3]) < 60
    && (match[4] === "Z" || (Number(match[5]) < 24 && Number(match[6]) < 60)) && Number.isFinite(Date.parse(value)));
}

/** 只验证源时间，不访问时钟，也不把 civil date 补成 UTC instant。 */
export function legacyLearningEventTime(value: unknown): Pick<LearningEventV1, "occurredAt"> & Pick<LearningEventProvenanceV1, "timePrecision"> {
  if (typeof value === "string" && isDate(value)) return { occurredAt: value, timePrecision: "date" };
  if (isLearningEventInstant(value)) return { occurredAt: value, timePrecision: "instant" };
  return { occurredAt: null, timePrecision: "unknown" };
}

/** 使用固定字符串顺序，避免本机 locale 改变归一化投影顺序。 */
export function compareLearningEventText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareLearningEvents(left: LearningEventV1, right: LearningEventV1): number {
  return compareLearningEventText(left.occurredAt ?? "", right.occurredAt ?? "")
    || compareLearningEventText(left.kind, right.kind)
    || compareLearningEventText(left.id, right.id);
}
