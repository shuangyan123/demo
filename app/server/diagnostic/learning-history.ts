import type { LearningEventV1, LearningTargetV1 } from "../../types/domains/learning-kernel.ts";
import type { DiagnosticLearningHistory, DiagnosticReconstructionFailure } from "./reconstruction-types.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../../services/first-party-diagnostic/spec-authority.ts";
import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { adaptVerifiedAssessment } from "../../services/learning-kernel/verified-assessment-adapter.ts";
import { deriveEvidence } from "../../services/learning-kernel/derive-evidence.ts";
import { readDiagnosticSourceHistory } from "./runtime.ts";

type Dependencies = {
  read: typeof readDiagnosticSourceHistory;
  resolveSpec: typeof FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec;
  admit: typeof admitVerifiedAssessment;
  adapt: typeof adaptVerifiedAssessment;
  derive: typeof deriveEvidence;
};
const production: Dependencies = { read: readDiagnosticSourceHistory, resolveSpec: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec,
  admit: admitVerifiedAssessment, adapt: adaptVerifiedAssessment, derive: deriveEvidence };
const key = (target: LearningTargetV1) => JSON.stringify([target.category, target.namespace, target.id]);
const authorityFailure = (code: Extract<DiagnosticReconstructionFailure, { kind: "authority_failure" }>["code"]): DiagnosticReconstructionFailure => ({ kind: "authority_failure", code });

function sourceFailure(read: Exclude<ReturnType<typeof readDiagnosticSourceHistory>, { kind: "complete" }>): DiagnosticReconstructionFailure {
  if (read.kind === "uninitialized") return { kind: "incomplete", code: "history_uninitialized" };
  if (read.kind === "incomplete") return { kind: "incomplete", code: "history_incomplete" };
  if (read.kind === "unsupported_version") return { kind: "unsupported", code: "history_unsupported" };
  if (read.kind === "corrupt") {
    if (read.reason === "unresolved_canonical_spec") return authorityFailure("spec_resolution_failure");
    return { kind: "corrupt", code: read.reason === "profile_mismatch" || read.reason === "epoch_mismatch" ? read.reason : "history_corrupt" };
  }
  return { kind: "unavailable", code: read.kind === "unavailable" && read.reason === "storage_config_unavailable"
    ? "storage_config_unavailable" : "storage_unavailable" };
}

/** 无 target/caller records 参数；完整 source 在任何 target grouping 前重验、重新准入。 */
export function loadCompleteDiagnosticLearningHistory(): DiagnosticLearningHistory {
  return loadDiagnosticLearningHistoryWith(production);
}

/** 仅专用 contracts 可注入故障 dependencies；production consumer 只能调用无参数入口。 */
export function loadDiagnosticLearningHistoryWith(deps: Dependencies): DiagnosticLearningHistory {
  const read = deps.read();
  if (read.kind !== "complete") return sourceFailure(read);
  const snapshot = read.snapshot;
  const events: LearningEventV1[] = [];
  const canonicalTargets = new Map<string, LearningTargetV1>();
  for (const capture of snapshot.captures) {
    const resolved = deps.resolveSpec(capture.specId, capture.specRevision);
    if (resolved.kind !== "resolved") return authorityFailure("spec_resolution_failure");
    const admitted = deps.admit({ sourceOwnerId: capture.sourceOwnerId, specId: capture.specId,
      specRevision: capture.specRevision, attemptId: capture.id });
    if (admitted.kind !== "admitted") return authorityFailure("admission_failure");
    const adapted = deps.adapt(admitted.spec, admitted.attempt);
    if (adapted.diagnostics.length || adapted.events.length !== 1
      || key(adapted.events[0].target) !== key(resolved.spec.learningTarget)) return authorityFailure("event_derivation_failure");
    events.push(...adapted.events);
    canonicalTargets.set(key(resolved.spec.learningTarget), resolved.spec.learningTarget);
  }
  // 先对全部 source Events 做 canonical/lineage/conflict 验证，不能先过滤掉其他 target 或未来 occurrence。
  const derived = deps.derive(events);
  const byEvent = new Map(events.map(event => [event.id, event]));
  const covered = new Set(derived.evidence.map(item => item.sourceEventIds[0]));
  if (derived.diagnostics.length || derived.evidence.length !== snapshot.captures.length
    || byEvent.size !== events.length || covered.size !== events.length
    || derived.evidence.some(item => !canonicalTargets.has(key(item.target)) || item.sourceEventIds.length !== 1
      || !byEvent.has(item.sourceEventIds[0]) || key(byEvent.get(item.sourceEventIds[0])!.target) !== key(item.target)))
    return authorityFailure("evidence_derivation_failure");
  const scope = Object.freeze({ completeness: "all_durable_captures_in_source_epoch" as const,
    sourceOwnerId: "recall-diagnostic" as const, profileId: snapshot.profileId, epochId: snapshot.epochId,
    generation: snapshot.generation, captureCount: snapshot.captures.length });
  const targets = [...canonicalTargets].map(([identity, target]) => Object.freeze({ target,
    events: Object.freeze(events.filter(event => key(event.target) === identity)),
    evidence: Object.freeze(derived.evidence.filter(item => key(item.target) === identity)) }));
  return Object.freeze({ kind: "complete", scope, events: Object.freeze(events), evidence: Object.freeze(derived.evidence), targets: Object.freeze(targets) });
}
