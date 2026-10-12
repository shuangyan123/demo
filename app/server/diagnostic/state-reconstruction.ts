import type { DiagnosticStateReconstruction } from "./reconstruction-types.ts";
import { loadCompleteDiagnosticLearningHistory } from "./learning-history.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../../services/first-party-diagnostic/spec-authority.ts";
import { isLegacyRecordId } from "../../services/learning-kernel/learning-event.ts";
import { deriveLearnerTargetStates } from "../../services/learning-kernel/derive-learner-state.ts";
import { decideNextVerification } from "../../services/learning-kernel/verification-policy.ts";

type Dependencies = {
  load: typeof loadCompleteDiagnosticLearningHistory;
  resolveSpec: typeof FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec;
  derive: typeof deriveLearnerTargetStates;
  decide: typeof decideNextVerification;
};
const production: Dependencies = { load: loadCompleteDiagnosticLearningHistory, resolveSpec: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec,
  derive: deriveLearnerTargetStates, decide: decideNextVerification };

/** 内部 server read API：请求仅 exact spec locator 与 asOf，不接 target、history、verified 或 state。 */
export function reconstructDiagnosticLearnerState(request: unknown): DiagnosticStateReconstruction {
  return reconstructDiagnosticStateWith(request, production);
}

/** 专用故障 contracts 的内部 seam；不向 renderer/HTTP 暴露 dependency injection。 */
export function reconstructDiagnosticStateWith(request: unknown, deps: Dependencies): DiagnosticStateReconstruction {
  if (!request || typeof request !== "object" || Array.isArray(request)) return { kind: "authority_failure", code: "invalid_request" };
  const fields = Object.getOwnPropertyDescriptors(request);
  if (Reflect.ownKeys(fields).length !== 3 || !["specId", "specRevision", "asOf"].every(field => Object.hasOwn(fields, field)
    && "value" in fields[field] && typeof fields[field].value === "string")
    || !isLegacyRecordId(fields.specId.value) || !isLegacyRecordId(fields.specRevision.value)) return { kind: "authority_failure", code: "invalid_request" };
  const history = deps.load();
  if (history.kind !== "complete") return history;
  const resolved = deps.resolveSpec(fields.specId.value, fields.specRevision.value);
  if (resolved.kind !== "resolved") return { kind: "authority_failure", code: "spec_resolution_failure" };
  const target = resolved.spec.learningTarget;
  const group = history.targets.find(item => item.target.category === target.category && item.target.namespace === target.namespace && item.target.id === target.id);
  const events = group?.events ?? Object.freeze([]);
  const evidence = group?.evidence ?? Object.freeze([]);
  // 不预删未来 records；完整 canonical scope 与 asOf 的先后由既有 Kernel 决定。
  const derivation = deps.derive(events, evidence, { asOf: fields.asOf.value });
  if (derivation.diagnostics.some(item => item.code !== "evidence_after_as_of") || derivation.states.length > 1
    || derivation.states.some(state => state.target.category !== target.category || state.target.namespace !== target.namespace || state.target.id !== target.id))
    return { kind: "authority_failure", code: "state_derivation_failure" };
  const state = derivation.states[0] ?? null;
  return { kind: "complete", scope: history.scope, target, targetCaptureCount: events.length, events, evidence,
    measurement: state ? "measured" : "unmeasured", state, derivation, decision: deps.decide(derivation, target) };
}
