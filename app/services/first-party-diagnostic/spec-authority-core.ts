import type { FirstPartyDiagnosticSpecV1, FirstPartyDiagnosticSpecResolutionV1 } from "../../types/domains/first-party-diagnostic.ts";
import { isLegacyRecordId } from "../learning-kernel/learning-event.ts";
import { PUBLISHED_ADDITION_SPEC } from "./spec-catalog.ts";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => "value" in descriptor);
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** 只复算规格的 key，不接收 learner response；限定整数域避免近似值和解析歧义。 */
export function recomputeAdditionKey(operands: unknown, options: unknown): string | null {
  try {
    if (!Array.isArray(operands) || operands.length !== 2
      || !Array.from(operands).every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 100 && !Object.is(value, -0))
      || !Array.isArray(options) || options.length < 2 || options.length > 10) return null;
    const ids = new Set<string>();
    const values = new Set<string>();
    const matches: string[] = [];
    for (const option of options) {
      if (!object(option) || !keys(option, ["id", "text"]) || !isLegacyRecordId(option.id)
        || typeof option.text !== "string" || !/^(?:0|[1-9]\d{0,2})$/.test(option.text)
        || Number(option.text) > 200 || ids.has(option.id) || values.has(option.text)) return null;
      ids.add(option.id);
      values.add(option.text);
      if (option.text === String(operands[0] + operands[1])) matches.push(option.id);
    }
    return matches.length === 1 ? matches[0] : null;
  } catch { return null; }
}

function semantics(spec: FirstPartyDiagnosticSpecV1): string {
  return JSON.stringify([spec.schemaVersion, spec.id, spec.revision, spec.contentRevision,
    spec.content.prompt, spec.content.options.map((option) => [option.id, option.text]), spec.optionIds,
    [spec.responseFormat.kind, spec.responseFormat.schemaVersion], spec.verifiedCorrectOptionId,
    [spec.learningTarget.category, spec.learningTarget.namespace, spec.learningTarget.id],
    [spec.authority.sourceOwnerId, spec.authority.scope, spec.authority.keyRule, spec.authority.operands, spec.authority.rationale]]);
}

/** 内部校验只接受已发布 exact revision；结构正确或数学正确均不能授权任意新规格。 */
export function isPublishedDiagnosticSpec(value: unknown): value is FirstPartyDiagnosticSpecV1 {
  try {
    if (!object(value) || !keys(value, ["schemaVersion", "id", "revision", "contentRevision", "optionIds",
      "verifiedCorrectOptionId", "content", "responseFormat", "learningTarget", "authority"])
      || value.schemaVersion !== 1 || ![value.id, value.revision, value.contentRevision, value.verifiedCorrectOptionId].every(isLegacyRecordId)
      || !Array.isArray(value.optionIds) || !Array.from(value.optionIds).every(isLegacyRecordId)
      || !object(value.content) || !keys(value.content, ["prompt", "options"]) || typeof value.content.prompt !== "string"
      || !object(value.responseFormat) || !keys(value.responseFormat, ["kind", "schemaVersion"])
      || value.responseFormat.kind !== "single_option_id" || value.responseFormat.schemaVersion !== 1
      || !object(value.learningTarget) || !keys(value.learningTarget, ["category", "namespace", "id"])
      || value.learningTarget.category !== "question" || value.learningTarget.namespace !== "verified_assessment_question"
      || !isLegacyRecordId(value.learningTarget.id)
      || !object(value.authority) || !keys(value.authority, ["sourceOwnerId", "scope", "keyRule", "operands", "rationale"])
      || value.authority.sourceOwnerId !== "recall-diagnostic" || value.authority.scope !== "spec_only"
      || value.authority.keyRule !== "bounded-integer-addition/v1" || typeof value.authority.rationale !== "string") return false;
    const key = recomputeAdditionKey(value.authority.operands, value.content.options);
    const orderedIds = value.optionIds;
    if (key === null || key !== value.verifiedCorrectOptionId || !Array.isArray(value.content.options)
      || orderedIds.length !== value.content.options.length
      || value.content.options.some((option, index) => option.id !== orderedIds[index])) return false;
    const [left, right] = value.authority.operands as [number, number];
    if (value.content.prompt !== `${left} + ${right} = ?`) return false;
    const targetId = JSON.stringify(["source-admission/v1", value.authority.sourceOwnerId, value.id, value.revision,
      value.contentRevision, value.optionIds, value.verifiedCorrectOptionId]);
    if (value.learningTarget.id !== targetId) return false;
    return semantics(value as FirstPartyDiagnosticSpecV1) === semantics(PUBLISHED_ADDITION_SPEC);
  } catch { return false; }
}

/** 仅内部 capability 调用；不接受 catalog/resolver 注入，也不回退 caller 提供的正文或 key。 */
export function resolvePublishedDiagnosticSpec(specId: unknown, revision: unknown): FirstPartyDiagnosticSpecResolutionV1 {
  if (!isLegacyRecordId(specId) || !isLegacyRecordId(revision)) return { kind: "rejected", reason: "invalid_request" };
  if (specId !== PUBLISHED_ADDITION_SPEC.id) return { kind: "rejected", reason: "unknown_spec" };
  if (revision !== PUBLISHED_ADDITION_SPEC.revision) return { kind: "rejected", reason: "spec_revision_mismatch" };
  if (!isPublishedDiagnosticSpec(PUBLISHED_ADDITION_SPEC)) return { kind: "rejected", reason: "invalid_spec" };
  return { kind: "resolved", spec: PUBLISHED_ADDITION_SPEC };
}
