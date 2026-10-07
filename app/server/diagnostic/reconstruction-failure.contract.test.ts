import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync } from "node:fs";
import test, { describe, beforeEach, afterEach } from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { composeDiagnosticRuntime, closeDiagnosticRuntime, readDiagnosticSourceHistory } from "./runtime.ts";
import { commitDiagnosticSubmission } from "./assessment-submission.ts";
import { loadCompleteDiagnosticLearningHistory, loadDiagnosticLearningHistoryWith } from "./learning-history.ts";
import { reconstructDiagnosticLearnerState, reconstructDiagnosticStateWith } from "./state-reconstruction.ts";
import { openDiagnosticHistoryRepository } from "./history/repository.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../../services/first-party-diagnostic/spec-authority.ts";
import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { adaptVerifiedAssessment } from "../../services/learning-kernel/verified-assessment-adapter.ts";
import { deriveEvidence } from "../../services/learning-kernel/derive-evidence.ts";
import { deriveLearnerTargetStates } from "../../services/learning-kernel/derive-learner-state.ts";
import { decideNextVerification } from "../../services/learning-kernel/verification-policy.ts";

const request = { specId: "int-add-2-3", specRevision: "r1", asOf: "9999-01-01T00:00:00.000Z" };
const dependencies = { read: readDiagnosticSourceHistory, resolveSpec: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec,
  admit: admitVerifiedAssessment, adapt: adaptVerifiedAssessment, derive: deriveEvidence };

describe("diagnostic reconstruction failure is never empty/unknown state", () => {
  let storage: ReturnType<typeof diagnosticStorageFixture>;
  beforeEach(() => { closeDiagnosticRuntime(); storage = diagnosticStorageFixture(); });
  afterEach(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  function seed() {
    const active = composeDiagnosticRuntime(storage.config);
    for (const selectedOptionId of ["four", "five"]) {
      const issued = active.issue(); if (issued.kind !== "issued") throw new Error("issue failed");
      const submitted = commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId });
      if (submitted.kind !== "submitted") throw new Error("submit failed");
    }
  }
  function mutate(change: (value: Record<string, unknown>) => void) {
    const value = JSON.parse(readFileSync(storage.file, "utf8")); change(value); delete value.integrity;
    value.integrity = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    writeFileSync(storage.file, JSON.stringify(value));
  }
  function noState(code: string, load = loadCompleteDiagnosticLearningHistory) {
    let calls = 0;
    const value = reconstructDiagnosticStateWith(request, { load, resolveSpec: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec,
      derive(...args) { calls++; return deriveLearnerTargetStates(...args); },
      decide(...args) { calls++; return decideNextVerification(...args); } });
    assert.notEqual(value.kind, "complete");
    if (value.kind === "complete") throw new Error("failure became state");
    assert.equal(value.code, code); assert.equal(calls, 0, "no Kernel/policy invocation on failed completeness");
    assert.equal("state" in value, false); assert.equal("events" in value, false); assert.equal("evidence" in value, false);
    return value;
  }
  test("absent runtime/config returns unavailable without initializing a domain", () => {
    noState("storage_config_unavailable"); assert.equal(existsSync(storage.file), false);
    assert.deepEqual(reconstructDiagnosticLearnerState(request), { kind: "unavailable", code: "storage_config_unavailable" });
  });
  test("real uninitialized repository read is typed incomplete and never initialized by loader", () => {
    const opened = openDiagnosticHistoryRepository(storage.config);
    if (opened.kind !== "opened") throw new Error("open failed");
    try {
      noState("history_uninitialized", () => loadDiagnosticLearningHistoryWith({ ...dependencies, read: opened.repository.readCompleteSnapshot }));
      assert.equal(existsSync(storage.file), false);
    } finally { opened.repository.close(); }
  });
  for (const [name, code, change] of [
    ["malformed", "history_corrupt", () => writeFileSync(storage.file, "{broken")],
    ["unsupported version", "history_unsupported", () => mutate(value => { value.formatVersion = 2; })],
    ["profile mismatch", "profile_mismatch", () => mutate(value => { value.profileId = randomUUID(); })],
    ["epoch mismatch", "epoch_mismatch", () => mutate(value => { value.epochId = randomUUID(); })],
    ["missing initialized file", "history_incomplete", () => unlinkSync(storage.file)],
    ["offline managed root", "storage_unavailable", () => renameSync(storage.config.managedRoot, storage.config.managedRoot + "-offline")],
  ] as const) test(`${name}: fail full read, no state, no empty replacement`, () => {
    seed(); const previous = JSON.parse(readFileSync(storage.file, "utf8")).captures[0];
    change(); const before = existsSync(storage.file) ? readFileSync(storage.file, "utf8") : undefined;
    noState(code);
    assert.equal(admitVerifiedAssessment({ sourceOwnerId: previous.sourceOwnerId, specId: previous.specId,
      specRevision: previous.specRevision, attemptId: previous.id }).kind, "rejected", "failed read invalidates old owner index");
    assert.equal(existsSync(storage.file) ? readFileSync(storage.file, "utf8") : undefined, before);
  });
  test("runtime open failure with trusted config remains storage_unavailable, not absent configuration", () => {
    renameSync(storage.config.managedRoot, storage.config.managedRoot + "-offline");
    composeDiagnosticRuntime(storage.config); noState("storage_unavailable"); assert.equal(existsSync(storage.config.managedRoot), false);
  });
  test("unknown exact revision in a later future record invalidates the ENTIRE source before target/asOf grouping", () => {
    seed(); mutate(value => { const captures = value.captures as Record<string, unknown>[];
      captures[1].specRevision = "unresolvable-future-revision"; captures[1].occurredAt = "9998-01-01T00:00:00.000Z"; });
    noState("spec_resolution_failure");
    assert.equal(reconstructDiagnosticLearnerState({ ...request, asOf: "2026-01-01T00:00:00.000Z" }).kind, "authority_failure");
  });
  test("one repository-valid uncontrolled capture is rejected by fixed admission and never dropped", () => {
    seed(); mutate(value => { const captures = value.captures as Record<string, unknown>[]; captures[1].assistance = "unknown";
      const provenance = captures[1].provenance as Record<string, unknown>;
      provenance.presentation = "canonical_snapshot_issued"; provenance.assistanceBasis = "uncontrolled_surface"; });
    assert.equal(readDiagnosticSourceHistory().kind, "complete", "source facts valid but do not authorize verification");
    noState("admission_failure");
  });
  test("fixed owner cannot resolve one required capture: failed read cannot fall back to older Map", () => {
    seed(); let calls = 0;
    noState("admission_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies, admit(locator) {
      calls++; if (calls === 2) closeDiagnosticRuntime(); return admitVerifiedAssessment(locator);
    } }));
    assert.equal(calls, 2);
  });
  test("loader rejects exact spec resolution failure even following validated source read", () => {
    seed(); noState("spec_resolution_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies,
      resolveSpec: () => FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec("unpublished", "r1") }));
  });
  test("adapter dropping one required Event fails closed", () => {
    seed(); noState("event_derivation_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies,
      adapt: () => ({ events: [], diagnostics: [] }) }));
  });
  test("adapter target must equal authority-resolved target", () => {
    seed(); noState("event_derivation_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies, adapt(...args) {
      const value = adaptVerifiedAssessment(...args);
      return { ...value, events: value.events.map(event => ({ ...event, target: { ...event.target, id: "caller-target" } })) };
    } }));
  });
  test("Evidence omission fails whole source before grouping", () => {
    seed(); noState("evidence_derivation_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies, derive(events) {
      return { ...deriveEvidence(events), evidence: deriveEvidence(events).evidence.slice(0, 1) };
    } }));
  });
  test("Evidence duplicate coverage cannot hide another required capture", () => {
    seed(); noState("evidence_derivation_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies, derive(events) {
      const value = deriveEvidence(events); return { ...value, evidence: [value.evidence[0], value.evidence[0]] };
    } }));
  });
  test("canonical Event inconsistency is rejected by existing Evidence engine", () => {
    seed(); noState("evidence_derivation_failure", () => loadDiagnosticLearningHistoryWith({ ...dependencies, adapt(...args) {
      const value = adaptVerifiedAssessment(...args); return { ...value, events: value.events.map(event => ({ ...event, id: "invalid-event-identity" })) };
    } }));
  });
  test("state validation failure does not reach WHAT or become unknown", () => {
    seed(); let decisions = 0;
    const value = reconstructDiagnosticStateWith(request, { load: loadCompleteDiagnosticLearningHistory,
      resolveSpec: FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec,
      derive(events, evidence) { return deriveLearnerTargetStates(events, evidence.slice(0, 1), { asOf: request.asOf }); },
      decide(...args) { decisions++; return decideNextVerification(...args); } });
    assert.deepEqual(value, { kind: "authority_failure", code: "state_derivation_failure" }); assert.equal(decisions, 0);
  });
});
