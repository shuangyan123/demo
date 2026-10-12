import type { FirstPartyDiagnosticSpecV1 } from "../../types/domains/first-party-diagnostic.ts";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// 已发布 r1 的完整快照由契约锁定；语义变更必须追加新 revision，不能覆盖旧快照。
export const PUBLISHED_ADDITION_SPEC: FirstPartyDiagnosticSpecV1 = freeze({
  schemaVersion: 1,
  id: "int-add-2-3",
  revision: "r1",
  contentRevision: "r1",
  optionIds: ["four", "five", "six"],
  verifiedCorrectOptionId: "five",
  content: {
    prompt: "2 + 3 = ?",
    options: [{ id: "four", text: "4" }, { id: "five", text: "5" }, { id: "six", text: "6" }],
  },
  responseFormat: { kind: "single_option_id", schemaVersion: 1 },
  // 显式 question binding 对齐 source-admission/v1，绝不从标签、scope 或 caller 推断 target。
  learningTarget: {
    category: "question",
    namespace: "verified_assessment_question",
    id: '["source-admission/v1","recall-diagnostic","int-add-2-3","r1","r1",["four","five","six"],"five"]',
  },
  authority: {
    sourceOwnerId: "recall-diagnostic",
    scope: "spec_only",
    keyRule: "bounded-integer-addition/v1",
    operands: [2, 3],
    rationale: "Exact addition of integers in [0, 100]; one canonical decimal option equals the independently recomputed sum.",
  },
});
