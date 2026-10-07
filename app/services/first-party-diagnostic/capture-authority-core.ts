import type {
  DiagnosticCaptureCapabilityV1, DiagnosticCaptureRejectionV1, DiagnosticCaptureSessionV1,
  DiagnosticCapturedAttemptV1, DiagnosticPresentationV1, IssuedDiagnosticCapturedAttemptV1,
} from "../../types/domains/first-party-diagnostic-capture.ts";
import { isLearningEventInstant, isLegacyRecordId } from "../learning-kernel/learning-event.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "./spec-authority.ts";
import { isPublishedDiagnosticSpec } from "./spec-authority-core.ts";

const issuedCaptures = new WeakSet<object>();
/** 只确认本 authority 实际签发的对象；JSON clone、类型断言与 caller flags 都不能取得写入 capability。 */
export function isIssuedDiagnosticCapture(value: unknown): value is IssuedDiagnosticCapturedAttemptV1 {
  return value !== null && typeof value === "object" && issuedCaptures.has(value);
}

function fields(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Reflect.ownKeys(value).length !== expected.length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== expected.length
    || !expected.every((key) => Object.hasOwn(descriptors, key) && "value" in descriptors[key])) return null;
  // 只读取 data descriptor 的快照，避免 Proxy get 在校验后换值或触发重入。
  return Object.fromEntries(expected.map((key) => [key, descriptors[key].value]));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function rejected(reason: DiagnosticCaptureRejectionV1["reason"]): DiagnosticCaptureRejectionV1 {
  return { kind: "rejected", reason };
}

/** 仅内部 facade 与专用测试调用；clock/identity 依赖绝不出现在 learner action 参数中。 */
export function createDiagnosticCaptureMechanism(dependencies: {
  readonly generateAttemptId: () => string;
  readonly now: () => number;
}): DiagnosticCaptureCapabilityV1 {
  return createMechanism(dependencies, false);
}

/** 仅固定 server surface runtime 可构造；不是 caller 可传入的 assistance flag。 */
export function createControlledDiagnosticCaptureMechanism(dependencies: {
  readonly generateAttemptId: () => string;
  readonly now: () => number;
}): DiagnosticCaptureCapabilityV1 {
  return createMechanism(dependencies, true);
}

function createMechanism(dependencies: { readonly generateAttemptId: () => string; readonly now: () => number }, controlled: boolean)
  : DiagnosticCaptureCapabilityV1 {
  const generateAttemptId = dependencies.generateAttemptId;
  const now = dependencies.now;
  // 仅保存本 mechanism instance 实际封存的记录，没有导入、注册或 fixture fallback。
  const attempts = new Map<string, DiagnosticCapturedAttemptV1>();
  return Object.freeze({
    begin(request: unknown) {
      try {
        const input = fields(request, ["specId", "specRevision"]);
        if (!input) return rejected("invalid_request");
        const resolution = FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(input.specId, input.specRevision);
        if (resolution.kind === "rejected") return resolution;
        const spec = resolution.spec;
        if (!isPublishedDiagnosticSpec(spec)) return rejected("invalid_spec");
        const presentation: DiagnosticPresentationV1 = freeze({
          sourceOwnerId: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.id, specId: spec.id,
          specRevision: spec.revision, contentRevision: spec.contentRevision,
          content: { prompt: spec.content.prompt, options: spec.content.options.map((option) => ({ ...option })) },
          responseFormat: { ...spec.responseFormat },
        });
        let state: "before_submit" | "committing" | "captured" | "reveal_allowed" | "invalidated" = "before_submit";
        const session: DiagnosticCaptureSessionV1 = Object.freeze({
          presentation,
          submit(response: unknown) {
            if (state === "captured" || state === "reveal_allowed") return rejected("already_submitted");
            if (state !== "before_submit") return rejected("lifecycle_invalidated");
            try {
              const input = fields(response, ["selectedOptionId"]);
              if (state !== "before_submit") return rejected("lifecycle_invalidated");
              if (!input || typeof input.selectedOptionId !== "string"
                || !spec.optionIds.includes(input.selectedOptionId)) return rejected("invalid_response");
              const selectedOptionId = input.selectedOptionId;
              // 同步封存前关闭重入；失败使 lifecycle 失效，绝不重放已知或未知的提交。
              state = "committing";
              const id = generateAttemptId();
              const occurrence = now();
              if (state !== "committing" || !isLegacyRecordId(id) || attempts.has(id)
                || !Number.isSafeInteger(occurrence)) {
                state = "invalidated";
                return rejected("invalid_capture_facts");
              }
              const occurredAt = new Date(occurrence).toISOString();
              if (!isLearningEventInstant(occurredAt)) {
                state = "invalidated";
                return rejected("invalid_capture_facts");
              }
              const attempt = freeze<DiagnosticCapturedAttemptV1>({
                schemaVersion: 1, id, sourceOwnerId: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.id,
                specId: spec.id, specRevision: spec.revision, contentRevision: spec.contentRevision,
                optionIds: [...spec.optionIds], responseFormat: { ...spec.responseFormat }, selectedOptionId,
                // none 仅表示固定 server surface 未提供内建辅助；普通 service 调用仍为 unknown。
                assistance: controlled ? "none" : "unknown", occurredAt,
                provenance: { mechanism: "first-party-diagnostic-capture/v1",
                  presentation: controlled ? "controlled_surface_delivered" : "canonical_snapshot_issued",
                  assistanceBasis: controlled ? "controlled_surface_no_builtin_assistance" : "uncontrolled_surface",
                  ordering: "submitted_before_reveal" },
              }) as IssuedDiagnosticCapturedAttemptV1;
              issuedCaptures.add(attempt);
              attempts.set(id, attempt);
              state = "captured";
              return { kind: "captured", attempt };
            } catch {
              state = "invalidated";
              return rejected("invalid_capture_facts");
            }
          },
          reveal() {
            if (state === "before_submit") {
              state = "invalidated";
              return rejected("reveal_before_submit");
            }
            if (state !== "captured" && state !== "reveal_allowed") {
              state = "invalidated";
              return rejected("lifecycle_invalidated");
            }
            state = "reveal_allowed";
            const correct = spec.content.options.find((option) => option.id === spec.verifiedCorrectOptionId)!;
            return { kind: "revealed", correctOptionId: spec.verifiedCorrectOptionId,
              explanation: `${spec.authority.operands[0]} + ${spec.authority.operands[1]} = ${correct.text}。` };
          },
        });
        return { kind: "started", session };
      } catch { return rejected("invalid_request"); }
    },
    lookup(request: unknown) {
      try {
        const input = fields(request, ["sourceOwnerId", "specId", "specRevision", "attemptId"]);
        if (!input || ![input.sourceOwnerId, input.specId, input.specRevision, input.attemptId].every(isLegacyRecordId))
          return rejected("invalid_request");
        if (input.sourceOwnerId !== FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.id) return rejected("wrong_owner");
        const attempt = attempts.get(input.attemptId as string);
        if (!attempt) return rejected("unknown_attempt");
        if (input.specId !== attempt.specId) return rejected("spec_binding_mismatch");
        if (input.specRevision !== attempt.specRevision) return rejected("spec_revision_mismatch");
        return { kind: "resolved", attempt };
      } catch { return rejected("invalid_request"); }
    },
  });
}
