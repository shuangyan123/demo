import type { LearnerStateSignal, LearnerStateSnapshot } from "../types/review.ts";

export type LearningContextScope = {
  moduleId?: string;
  query?: string;
  maxSignals?: number;
  characterLimit?: number;
};

const kindLabels: Record<LearnerStateSignal["kind"], string> = {
  goal: "当前目标",
  weakness: "薄弱项",
  misconception: "反复误区",
  due_review: "到期复习",
  next_action: "下一步",
  strength: "已掌握",
};

/** 为中文短句补充二元片段，避免仅按空格分词导致查询完全失配。 */
function queryTokens(value: string): string[] {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  const words = value.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const bigrams = Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2));
  return [...new Set([...words, ...bigrams])].slice(0, 48);
}

/** 选择少量相关且有证据的信号；没有证据的状态永远不进入模型上下文。 */
export function selectLearningSignals(snapshot: LearnerStateSnapshot, scope: LearningContextScope = {}): LearnerStateSignal[] {
  const tokens = queryTokens(scope.query ?? "");
  const limit = Math.max(1, Math.min(8, scope.maxSignals ?? 6));
  const scoreSignal = (signal: LearnerStateSignal): number => {
    const haystack = `${signal.title}${signal.summary}${signal.evidence.map((item) => item.label).join("")}`.toLowerCase();
    const keyword = tokens.reduce((score, token) => score + (haystack.includes(token) ? 12 : 0), 0);
    const moduleBoost = scope.moduleId === "tutoring" && ["goal", "misconception", "next_action"].includes(signal.kind) ? 8 : 0;
    return signal.score + keyword + moduleBoost;
  };
  return snapshot.signals
    .filter((signal) => signal.evidence.length > 0)
    .toSorted((left, right) => scoreSignal(right) - scoreSignal(left) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

/** 构造带最小证据引用的学习上下文，禁止复制题干、知识正文或完整历史。 */
export function buildLearningContext(snapshot: LearnerStateSnapshot, scope: LearningContextScope = {}): string {
  const limit = Math.max(300, Math.min(1800, scope.characterLimit ?? 1400));
  const signals = selectLearningSignals(snapshot, scope);
  if (!signals.length) return "";
  let result = "学习者状态（仅依据本地可观察记录；不得把推测当作已掌握事实）：\n";
  for (const signal of signals) {
    const evidence = signal.evidence.slice(0, 3).map((item) => `${item.type}:${item.id}`).join(",");
    const line = `- [${kindLabels[signal.kind]}] ${signal.title}：${signal.summary}（证据 ${evidence}）\n`;
    if (result.length + line.length <= limit) {
      result += line;
      continue;
    }
    const remaining = limit - result.length;
    if (remaining > 16) result += `${line.slice(0, remaining - 1)}…`;
    break;
  }
  return result.trim();
}
