import { createHash } from "node:crypto";
import type { DiagnosticCapturedAttemptV1 } from "../../../types/domains/first-party-diagnostic-capture.ts";
import type { DiagnosticHistoryFailure, DiagnosticHistorySnapshotV1, DiagnosticHistoryRead } from "../../../types/domains/diagnostic-history.ts";
import { isLegacyRecordId, isLearningEventInstant } from "../../../services/learning-kernel/learning-event.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../../../services/first-party-diagnostic/spec-authority.ts";

export const DIAGNOSTIC_HISTORY_MAX_BYTES = 4 * 1024 * 1024;
export const DIAGNOSTIC_HISTORY_MAX_CAPTURES = 4096;
const corrupt = (reason: string): DiagnosticHistoryFailure => ({ kind: "corrupt", reason });
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key) && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}

/** 只重建已验证的源事实；canonical spec 仍独立拥有正文、key、target 与 correctness。 */
export function validateDiagnosticCapture(value: unknown):
  { kind: "valid"; attempt: DiagnosticCapturedAttemptV1 } | DiagnosticHistoryFailure {
  if (!fields(value, ["schemaVersion", "id", "sourceOwnerId", "specId", "specRevision", "contentRevision", "optionIds",
    "responseFormat", "selectedOptionId", "assistance", "occurredAt", "provenance"])
    || value.schemaVersion !== 1 || value.sourceOwnerId !== "recall-diagnostic"
    || ![value.id, value.specId, value.specRevision, value.contentRevision, value.selectedOptionId].every(isLegacyRecordId)
    || !isLearningEventInstant(value.occurredAt) || !Array.isArray(value.optionIds)
    || !Array.from(value.optionIds).every(isLegacyRecordId)
    || !fields(value.responseFormat, ["kind", "schemaVersion"])
    || value.responseFormat.kind !== "single_option_id" || value.responseFormat.schemaVersion !== 1
    || !fields(value.provenance, ["mechanism", "presentation", "assistanceBasis", "ordering"])
    || value.provenance.mechanism !== "first-party-diagnostic-capture/v1"
    || value.provenance.ordering !== "submitted_before_reveal") return corrupt("invalid_capture_facts");
  const controlled = value.assistance === "none" && value.provenance.presentation === "controlled_surface_delivered"
    && value.provenance.assistanceBasis === "controlled_surface_no_builtin_assistance";
  const uncontrolled = value.assistance === "unknown" && value.provenance.presentation === "canonical_snapshot_issued"
    && value.provenance.assistanceBasis === "uncontrolled_surface";
  if (!controlled && !uncontrolled) return corrupt("invalid_capture_provenance");
  const resolution = FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(value.specId, value.specRevision);
  if (resolution.kind !== "resolved") return corrupt("unresolved_canonical_spec");
  const spec = resolution.spec;
  if (value.contentRevision !== spec.contentRevision || value.optionIds.length !== spec.optionIds.length
    || value.optionIds.some((id, index) => id !== spec.optionIds[index]) || !spec.optionIds.includes(value.selectedOptionId as string))
    return corrupt("capture_spec_binding_mismatch");
  const attempt: DiagnosticCapturedAttemptV1 = Object.freeze({
    schemaVersion: 1, id: value.id as string, sourceOwnerId: "recall-diagnostic", specId: spec.id,
    specRevision: spec.revision, contentRevision: spec.contentRevision, optionIds: Object.freeze([...spec.optionIds]),
    responseFormat: Object.freeze({ kind: "single_option_id", schemaVersion: 1 }), selectedOptionId: value.selectedOptionId as string,
    assistance: controlled ? "none" : "unknown", occurredAt: value.occurredAt,
    provenance: Object.freeze({ mechanism: "first-party-diagnostic-capture/v1",
      presentation: controlled ? "controlled_surface_delivered" : "canonical_snapshot_issued",
      assistanceBasis: controlled ? "controlled_surface_no_builtin_assistance" : "uncontrolled_surface", ordering: "submitted_before_reveal" }),
  });
  return { kind: "valid", attempt };
}

function duplicateKeys(text: string): boolean {
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") stack.push(new Set());
    else if (text[i] === "[") stack.push(null);
    else if (text[i] === "}" || text[i] === "]") stack.pop();
    else if (text[i] === '"') {
      const start = i;
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      const keys = stack.at(-1);
      if (keys && text[next] === ":") {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return false;
}

/** 普通 digest 只检测意外损坏，不是签名或真实性证明。 */
export function encodeDiagnosticSnapshot(snapshot: DiagnosticHistorySnapshotV1): string {
  const integrity = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return JSON.stringify({ ...snapshot, integrity });
}

export function parseDiagnosticSnapshot(text: string, identity: Readonly<{ profileId: string; epochId: string }>): DiagnosticHistoryRead {
  if (Buffer.byteLength(text, "utf8") > DIAGNOSTIC_HISTORY_MAX_BYTES) return corrupt("snapshot_capacity_exceeded");
  let value: unknown;
  try { value = JSON.parse(text); if (duplicateKeys(text)) return corrupt("duplicate_fields"); }
  catch { return corrupt("malformed_snapshot"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return corrupt("invalid_snapshot");
  const version = Object.getOwnPropertyDescriptor(value, "formatVersion")?.value;
  if (!Number.isSafeInteger(version) || version < 1) return corrupt("invalid_format_version");
  if (version !== 1) return { kind: "unsupported_version", version };
  if (!fields(value, ["formatVersion", "profileId", "epochId", "generation", "captures", "integrity"])) return corrupt("invalid_snapshot_fields");
  if (value.profileId !== identity.profileId) return corrupt("profile_mismatch");
  if (value.epochId !== identity.epochId) return corrupt("epoch_mismatch");
  if (!Number.isSafeInteger(value.generation) || Object.is(value.generation, -0) || !Array.isArray(value.captures)
    || value.generation !== value.captures.length || value.captures.length > DIAGNOSTIC_HISTORY_MAX_CAPTURES
    || typeof value.integrity !== "string" || !/^[a-f0-9]{64}$/.test(value.integrity)) return corrupt("invalid_snapshot_generation");
  const captures: DiagnosticCapturedAttemptV1[] = [];
  const ids = new Set<string>();
  for (const raw of value.captures) {
    const result = validateDiagnosticCapture(raw);
    if (result.kind !== "valid") return result;
    if (ids.has(result.attempt.id)) return corrupt("duplicate_attempt_identity");
    ids.add(result.attempt.id);
    captures.push(result.attempt);
  }
  const snapshot: DiagnosticHistorySnapshotV1 = Object.freeze({ formatVersion: 1,
    profileId: identity.profileId, epochId: identity.epochId, generation: value.generation as number, captures: Object.freeze(captures) });
  const canonical = encodeDiagnosticSnapshot(snapshot);
  if (canonical !== JSON.stringify({ ...snapshot, integrity: value.integrity })) return corrupt("integrity_mismatch");
  return { kind: "complete", snapshot };
}
