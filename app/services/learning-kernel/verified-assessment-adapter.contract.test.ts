import assert from "node:assert/strict";
import test from "node:test";
import type { LearningEventV1, VerifiedAssessmentSpecV1, VerifiedAssessmentAttemptV1 } from "../../types/domains/learning-kernel.ts";
import { adaptVerifiedAssessment } from "./verified-assessment-adapter.ts";
import { validateEvidenceEvent } from "./evidence-policy.ts";
import { deriveEvidence } from "./derive-evidence.ts";

const instant = "2026-10-05T08:00:00+08:00";
const secret = "PRIVATE-VERIFIED-SOURCE-MUST-NOT-LEAK";
const spec: VerifiedAssessmentSpecV1 = { schemaVersion: 1, id: "item/a:%中文", optionCount: 4, verifiedCorrectOptionIndex: 2 };
const attempt: VerifiedAssessmentAttemptV1 = { schemaVersion: 1, id: "attempt/a:%中文", specId: spec.id,
  selectedOptionIndex: 2, occurredAt: instant, assistance: "none" };
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
}

test("separate verified spec and attempt emit one stable scoped event with both immutable revisions", () => {
  const result = adaptVerifiedAssessment(spec, attempt);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.kind, "verification.assessed");
  assert.equal(event.id, ["recall-verified-assessment/v1", "verification.assessed", attempt.id,
    JSON.stringify([spec.id, 2, "none", instant]), spec.id, "[4,2]"].map(encodeURIComponent).join("/"));
  assert.deepEqual(event.target, { category: "question", namespace: "verified_assessment_question", id: spec.id });
  assert.deepEqual(event.source.records, [
    { recordType: "verification_attempt", recordId: attempt.id, revision: JSON.stringify([spec.id, 2, "none", instant]) },
    { recordType: "verification_spec", recordId: spec.id, revision: "[4,2]" },
  ]);
  assert.deepEqual(event.payload, { selectedOptionIndex: 2, verifiedCorrectOptionIndex: 2, matchesVerifiedKey: true, assistance: "none" });
  assert.deepEqual(event.provenance, { normalizationVersion: "verified-assessment/v1", modality: "selection", modelAuthored: false,
    keySource: "verified_assessment", scoringMethod: "verified_key_comparison", timePrecision: "instant", history: "complete_record" });
  assert.equal(event.recordedAt, null);
  assert.equal(event.attemptId, attempt.id);
  assert.equal(validateEvidenceEvent(event), null);
  assert.deepEqual(adaptVerifiedAssessment(Object.fromEntries(Object.entries(spec).reverse()),
    Object.fromEntries(Object.entries(attempt).reverse())), result);
  assert.equal(JSON.stringify(adaptVerifiedAssessment(spec, attempt)), JSON.stringify(result));
});

test("observable spec or attempt changes change identity; separator escaping prevents collision", () => {
  const original = adaptVerifiedAssessment(spec, attempt).events[0].id;
  for (const [s, a] of [[{ ...spec, optionCount: 5 }, attempt], [{ ...spec, verifiedCorrectOptionIndex: 1 }, attempt],
    [spec, { ...attempt, assistance: "hint" }], [spec, { ...attempt, selectedOptionIndex: 0 }],
    [spec, { ...attempt, occurredAt: "2026-10-05T00:00:01Z" }], [spec, { ...attempt, id: "attempt/a" }]] as const) {
    assert.notEqual(adaptVerifiedAssessment(s, a).events[0].id, original);
  }
});

for (const [label, patch] of [
  ["empty ID", { id: "" }], ["oversized ID", { id: "x".repeat(257) }], ["invalid Unicode", { id: "\ud800" }],
  ["schema", { schemaVersion: 2 }], ["zero options", { optionCount: 0 }], ["fractional options", { optionCount: 2.5 }],
  ["unsafe options", { optionCount: Number.MAX_SAFE_INTEGER + 1 }], ["negative key", { verifiedCorrectOptionIndex: -1 }],
  ["out of bounds key", { verifiedCorrectOptionIndex: 4 }], ["fractional key", { verifiedCorrectOptionIndex: 0.5 }],
  ["signed zero key", { verifiedCorrectOptionIndex: -0 }], ["nonfinite key", { verifiedCorrectOptionIndex: Number.NaN }],
] as const) {
  test(`invalid spec ${label} fails closed`, () => {
    const result = adaptVerifiedAssessment({ ...spec, ...patch }, attempt);
    assert.deepEqual(result.events, []);
    assert.equal(result.diagnostics[0].code, "invalid_spec");
  });
}

for (const [label, patch] of [
  ["empty ID", { id: "" }], ["schema", { schemaVersion: 2 }], ["negative selection", { selectedOptionIndex: -1 }],
  ["out of bounds selection", { selectedOptionIndex: 4 }], ["fractional selection", { selectedOptionIndex: 0.5 }],
  ["signed zero selection", { selectedOptionIndex: -0 }], ["unknown assistance", { assistance: "unknown" }],
  ["missing assistance", { assistance: undefined }], ["timezone-less instant", { occurredAt: "2026-10-05T08:00:00" }],
  ["date only", { occurredAt: "2026-10-05" }], ["invalid date", { occurredAt: "2026-02-30T08:00:00Z" }],
  ["private invalid time", { occurredAt: secret }],
] as const) {
  test(`invalid attempt ${label} fails closed without content diagnostics`, () => {
    const result = adaptVerifiedAssessment(spec, { ...attempt, ...patch });
    assert.deepEqual(result.events, []);
    assert.equal(result.diagnostics[0].code, "invalid_attempt");
    assert.equal(JSON.stringify(result).includes(secret), false);
  });
}

test("spec association is exact, including missing or unsupported input", () => {
  assert.equal(adaptVerifiedAssessment(spec, { ...attempt, specId: "other" }).diagnostics[0].code, "spec_attempt_mismatch");
  for (const value of [null, {}, [], { verified: true, correct: true }]) {
    assert.deepEqual(adaptVerifiedAssessment(value, value).events, []);
  }
});

test("malformed lineage, revisions, provenance, target, assistance and comparison cannot forge authority", () => {
  const event = adaptVerifiedAssessment(spec, attempt).events[0];
  const forged = [
    { ...event, source: { ...event.source, adapterId: "recall-legacy/v1" } },
    ...Object.keys(event.provenance).map((key) => ({ ...event, provenance: { ...event.provenance, [key]: "forged" } })),
    { ...event, target: { ...event.target, category: "concept" } },
    { ...event, target: { ...event.target, namespace: "skill" } }, { ...event, target: { ...event.target, id: "other" } },
    { ...event, attemptId: "other" }, { ...event, sessionId: "invented" }, { ...event, recordedAt: instant },
    { ...event, occurredAt: "2026-10-05" }, { ...event, source: { ...event.source, records: [] } },
    { ...event, source: { ...event.source, records: [...event.source.records].reverse() } },
    ...["not-json", "[4]", "[4,4]", "[4,2] ", "[4,2,0]", secret].map((revision) => ({ ...event,
      source: { ...event.source, records: [event.source.records[0], { ...event.source.records[1], revision }] } })),
    ...["[]", JSON.stringify(["other", 2, "none", instant]), JSON.stringify([spec.id, 4, "none", instant])].map((revision) => ({
      ...event, source: { ...event.source, records: [{ ...event.source.records[0], revision }, event.source.records[1]] },
    })),
    { ...event, payload: { ...event.payload, assistance: "hint" } },
    { ...event, payload: { ...event.payload, selectedOptionIndex: 0 } },
    { ...event, payload: { ...event.payload, verifiedCorrectOptionIndex: 0 } },
    { ...event, payload: { ...event.payload, matchesVerifiedKey: false } },
  ];
  for (const candidate of forged) {
    const result = deriveEvidence([candidate as LearningEventV1]);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("same Event identity with conflicting facts rejects the entire group in either order", () => {
  const event = adaptVerifiedAssessment(spec, attempt).events[0];
  const conflict = { ...event, payload: { ...event.payload, matchesVerifiedKey: false } };
  assert.deepEqual(deriveEvidence([event, conflict]), deriveEvidence([conflict, event]));
  assert.deepEqual(deriveEvidence([event, conflict]), { evidence: [], diagnostics: [
    { code: "conflicting_event_identity", sourceEventId: event.id },
  ] });
});

test("adapter strips private fields and caller authority overrides; all known assistance conditions are explicit", () => {
  const privateFields = Object.fromEntries(["question", "options", "answer", "explanation", "reasoning", "sourceBody",
    "providerResponse", "credentials", "transcript", "rawMedia", "target"].map((key) => [key, secret]));
  for (const assistance of ["none", "hint", "guided", "solution"] as const) {
    const clean = adaptVerifiedAssessment(spec, { ...attempt, assistance });
    assert.deepEqual(adaptVerifiedAssessment({ ...spec, ...privateFields, modelAuthored: true, verified: false,
      keySource: "model_authored" }, { ...attempt, ...privateFields, assistance, adapterId: "untrusted",
      scoringMethod: "model_rubric", matchesVerifiedKey: false }), clean);
    assert.equal(JSON.stringify(clean).includes(secret), false);
  }
});

test("frozen inputs are unchanged; outputs detached and no clock/random/locale dependency exists", (context) => {
  const s = structuredClone(spec), a = structuredClone(attempt);
  const before = structuredClone({ s, a });
  freeze(s); freeze(a);
  const fail = () => { throw new Error("clock/random/locale forbidden"); };
  context.mock.method(Date, "now", fail); context.mock.method(Math, "random", fail);
  context.mock.method(globalThis.crypto, "randomUUID", fail); context.mock.method(String.prototype, "localeCompare", fail);
  context.mock.method(globalThis, "Date", new Proxy(Date, {
    construct(target, args) { if (!args.length) fail(); return Reflect.construct(target, args); }, apply() { return fail(); },
  }));
  const result = adaptVerifiedAssessment(s, a);
  assert.deepEqual({ s, a }, before);
  result.events[0].provenance.modelAuthored = true;
  result.events[0].target.id = "output mutation";
  assert.equal(adaptVerifiedAssessment(s, a).events[0].provenance.modelAuthored, false);
  assert.deepEqual({ s, a }, before);
});
