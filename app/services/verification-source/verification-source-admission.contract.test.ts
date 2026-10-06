import assert from "node:assert/strict";
import test from "node:test";
import type { VerificationSourceAttemptV1, VerificationSourceSpecV1 } from "../../types/domains/verification-source.ts";
import { admitVerifiedAssessment } from "./verification-source-admission.ts";
import { admitFromAuthorizedSource, type AuthorizedVerificationSourceOwner } from "./verification-source-admission-core.ts";
import { adaptVerifiedAssessment } from "../learning-kernel/verified-assessment-adapter.ts";
import { deriveEvidence } from "../learning-kernel/derive-evidence.ts";
import { deriveLearnerTargetStates } from "../learning-kernel/derive-learner-state.ts";
import { decideNextVerification } from "../learning-kernel/verification-policy.ts";

// 仅条件性 contract fixture；没有真实内容核验或 capture，不是获准生产来源。
const sourceOwnerId = "contract-test";
const request = { sourceOwnerId, specId: "item", specRevision: "r1", attemptId: "attempt" };
const instant = "2026-10-05T08:00:00+08:00";
const sentinel = "PRIVATE-SOURCE-FACTS-MUST-NOT-LEAK";
const spec: VerificationSourceSpecV1 = { schemaVersion: 1, id: "item", revision: "r1", contentRevision: "content-v1",
  optionIds: ["a", "b"], verifiedCorrectOptionId: "b" };
const attempt: VerificationSourceAttemptV1 = { schemaVersion: 1, id: "attempt", specId: "item", specRevision: "r1",
  contentRevision: "content-v1", optionIds: ["a", "b"], selectedOptionId: "b", assistance: "none", occurredAt: instant };
function fixture(canonical: unknown = spec, captured: unknown = attempt): AuthorizedVerificationSourceOwner {
  return { id: sourceOwnerId, resolveSpec: () => canonical, resolveAttempt: () => captured };
}
function admit(input: unknown = request, owner = fixture()) {
  return admitFromAuthorizedSource(input, (id) => id === owner.id ? owner : undefined);
}
function reject(reason: string, result = admitVerifiedAssessment(request)): void {
  assert.deepEqual(result, { kind: "rejected", reason, policyVersion: "source-admission/v1" });
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
}

test("production authorized set remains empty for every existing product source and the test fixture", () => {
  for (const id of [sourceOwnerId, "recall-diagnostic", "tutoring", "review", "knowledge", "interview", "fenbi", "manual-import", "arbitrary"])
    reject("unknown_source_owner", admitVerifiedAssessment({ ...request, sourceOwnerId: id }));
  reject("unknown_source_owner", admitVerifiedAssessment({ ...request, owner: fixture(), resolver: () => fixture(),
    verified: true, canonicalSpec: spec, capturedAttempt: attempt }));
});

test("request must identify exact source/spec/revision/attempt; malformed identities are rejected", () => {
  for (const input of [null, [], {}, { ...request, specId: "" }, { ...request, attemptId: "x".repeat(257) },
    { ...request, specRevision: "\ud800" }, { ...request, sourceOwnerId: 1 }]) reject("invalid_request", admit(input));
  reject("unknown_source_owner", admit({ ...request, sourceOwnerId: "unknown" }));
});

test("only trusted lookup owns spec and captured facts; caller authority and key overrides are ignored", () => {
  const result = admit({ ...request, verified: true, modelAuthored: false, keySource: "verified_assessment",
    correctAnswer: 0, verifiedCorrectOptionIndex: 0, canonicalSpec: { ...spec, verifiedCorrectOptionId: "a" },
    assistance: "solution", occurredAt: "2030-01-01T00:00:00Z", selectedOptionIndex: 0,
    target: { category: "concept", id: "invented" }, sourceBody: sentinel });
  assert.equal(result.kind, "admitted");
  if (result.kind !== "admitted") return;
  assert.equal(result.spec.verifiedCorrectOptionIndex, 1);
  assert.equal(result.attempt.selectedOptionIndex, 1);
  assert.equal(result.attempt.assistance, "none");
  assert.equal(result.attempt.occurredAt, instant);
  assert.deepEqual(result, admit());
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test("lookup receives only canonical locators in spec-before-attempt order", () => {
  const calls: unknown[] = [];
  const owner: AuthorizedVerificationSourceOwner = { id: sourceOwnerId,
    resolveSpec: (...args) => { calls.push(["spec", ...args]); return spec; },
    resolveAttempt: (...args) => { calls.push(["attempt", ...args]); return attempt; } };
  assert.equal(admit(request, owner).kind, "admitted");
  assert.deepEqual(calls, [["spec", "item", "r1"], ["attempt", "attempt"]]);
});

test("unknown spec and malformed canonical facts cannot fall back to a caller supplied spec", () => {
  reject("unknown_spec", admit({ ...request, canonicalSpec: spec }, fixture(null)));
  for (const input of [{}, { ...spec, optionIds: [] }, { ...spec, optionIds: ["a", "a"] },
    { ...spec, optionIds: Array<string>(2) }, { ...spec, verifiedCorrectOptionId: "other" },
    { ...spec, contentRevision: "" }, { ...spec, schemaVersion: 2 }]) reject("invalid_spec", admit(request, fixture(input)));
});

test("exact spec identity and revision are required in both canonical and captured facts", () => {
  reject("spec_binding_mismatch", admit(request, fixture({ ...spec, id: "other" })));
  reject("spec_revision_mismatch", admit(request, fixture({ ...spec, revision: "r2" })));
  reject("invalid_attempt", admit(request, fixture(spec, { ...attempt, id: "other" })));
  reject("spec_binding_mismatch", admit(request, fixture(spec, { ...attempt, specId: "other" })));
  reject("spec_revision_mismatch", admit(request, fixture(spec, { ...attempt, specRevision: "r2" })));
  reject("spec_binding_mismatch", admit(request, fixture(spec, { ...attempt, contentRevision: "content-v2" })));
  reject("spec_binding_mismatch", admit(request, fixture(spec, { ...attempt, optionIds: ["b", "a"] })));
  reject("spec_binding_mismatch", admit(request, fixture(spec, { ...attempt, optionIds: ["a", "b", "c"] })));
});

test("source, revision, content, ordering and verified key all bind the projected Kernel spec identity", () => {
  const initial = admit();
  assert.equal(initial.kind, "admitted");
  if (initial.kind !== "admitted") return;
  const variants = [
    admit({ ...request, specRevision: "r2" }, fixture({ ...spec, revision: "r2" }, { ...attempt, specRevision: "r2" })),
    admit(request, fixture({ ...spec, contentRevision: "content-v2" }, { ...attempt, contentRevision: "content-v2" })),
    admit(request, fixture({ ...spec, optionIds: ["b", "a"] }, { ...attempt, optionIds: ["b", "a"] })),
    admit(request, fixture({ ...spec, verifiedCorrectOptionId: "a" })),
    admit({ ...request, sourceOwnerId: "other-source" }, { ...fixture(), id: "other-source" }),
  ];
  for (const result of variants) {
    assert.equal(result.kind, "admitted");
    if (result.kind === "admitted") assert.notEqual(result.spec.id, initial.spec.id);
  }
  assert.equal(new Set(variants.flatMap((result) => result.kind === "admitted" ? [result.spec.id] : [])).size, variants.length);
});

test("missing assistance cannot be replaced by caller none or absence of hint logs", () => {
  for (const assistance of [undefined, null]) reject("missing_assistance",
    admit({ ...request, assistance: "none", hints: [] }, fixture(spec, { ...attempt, assistance })));
  for (const assistance of ["unknown", false, ""]) reject("invalid_attempt", admit(request, fixture(spec, { ...attempt, assistance })));
  for (const assistance of ["none", "hint", "guided", "solution"] as const) {
    const result = admit(request, fixture(spec, { ...attempt, assistance }));
    assert.equal(result.kind, "admitted");
    if (result.kind === "admitted") assert.equal(result.attempt.assistance, assistance);
  }
});

test("occurrence must be a captured offset-aware instant; caller time does not repair it", () => {
  for (const occurredAt of [undefined, null, "2026-10-05", "2026-10-05T08:00:00", "2026-02-30T08:00:00Z",
    "2026-10-05T24:00:00Z", "2026-10-05T08:00:00+24:00", sentinel]) reject("invalid_occurrence_time",
    admit({ ...request, occurredAt: instant }, fixture(spec, { ...attempt, occurredAt })));
});

test("invalid attempts, oversized projections and owner failures produce closed content-free rejections", () => {
  for (const captured of [null, [], {}, { ...attempt, schemaVersion: 2 }, { ...attempt, selectedOptionId: "other" },
    { ...attempt, optionIds: ["a", "a"] }]) reject("invalid_attempt", admit(request, fixture(spec, captured)));
  reject("invalid_spec", admit(request, fixture({ ...spec, contentRevision: "x".repeat(256) },
    { ...attempt, contentRevision: "x".repeat(256) })));
  reject("invalid_attempt", admit({ ...request, attemptId: "x".repeat(256) }, fixture(spec, { ...attempt, id: "x".repeat(256) })));
  const result = admit(request, { ...fixture(), resolveAttempt: () => { throw new Error(sentinel); } });
  reject("invalid_source_facts", result);
  reject("invalid_source_facts", admitFromAuthorizedSource(request, () => { throw new Error(sentinel); }));
  reject("invalid_source_facts", admitFromAuthorizedSource(request, () => ({ ...fixture(), id: "other" })));
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test("minimal admitted facts preserve existing Event/Evidence/state/WHAT semantics under the test-only trust premise", () => {
  for (const assistance of ["none", "hint", "guided", "solution"] as const) {
    const result = admit(request, fixture(spec, { ...attempt, assistance, providerResponse: sentinel, rawMedia: sentinel }));
    assert.equal(result.kind, "admitted");
    if (result.kind !== "admitted") continue;
    assert.deepEqual(Object.keys(result).toSorted(), ["attempt", "kind", "policyVersion", "spec"]);
    const { events, diagnostics } = adaptVerifiedAssessment(result.spec, result.attempt);
    assert.deepEqual(diagnostics, []);
    const evidence = deriveEvidence(events).evidence;
    assert.equal(evidence[0].policyVersion, "evidence-policy/v2");
    const state = deriveLearnerTargetStates(events, evidence, { asOf: instant });
    assert.equal(state.states[0].policyVersion, "learner-state-policy/v3");
    assert.equal(state.states[0].understanding, assistance === "none" ? "emerging" : "unknown");
    assert.equal(state.states[0].independence, assistance === "none" ? "independent" : "unknown");
    assert.equal(state.states[0].retention, "untested");
    assert.equal(state.states[0].transfer, "untested");
    assert.equal(state.states[0].nextVerificationAt, null);
    assert.deepEqual(decideNextVerification(state, events[0].target), assistance === "none"
      ? { kind: "none", reason: "no_authorized_verification_target" }
      : { kind: "verify", target: "independence", reason: "assistance_present" });
    assert.equal(JSON.stringify([result, evidence, state]).includes(sentinel), false);
  }
});

test("frozen facts and caller remain unchanged; outputs are detached and bytes deterministic without clock/random/locale", (context) => {
  const facts = structuredClone({ spec, attempt, request });
  freeze(facts);
  const expected = admit(facts.request, fixture(facts.spec, facts.attempt));
  const fail = () => { throw new Error("clock/random/locale forbidden"); };
  context.mock.method(Date, "now", fail); context.mock.method(Math, "random", fail);
  context.mock.method(globalThis.crypto, "randomUUID", fail); context.mock.method(String.prototype, "localeCompare", fail);
  context.mock.method(globalThis, "Date", new Proxy(Date, {
    construct(target, args) { if (!args.length) fail(); return Reflect.construct(target, args); }, apply() { return fail(); },
  }));
  assert.equal(JSON.stringify(admit(facts.request, fixture(facts.spec, facts.attempt))), JSON.stringify(expected));
  assert.deepEqual(admit(Object.fromEntries(Object.entries(request).reverse()),
    fixture(Object.fromEntries(Object.entries(spec).reverse()), Object.fromEntries(Object.entries(attempt).reverse()))), expected);
  assert.deepEqual(facts, { spec, attempt, request });
  if (expected.kind === "admitted") { expected.spec.id = "output mutation"; expected.attempt.assistance = "solution"; }
  assert.deepEqual(admit(facts.request, fixture(facts.spec, facts.attempt)), admit());
});
