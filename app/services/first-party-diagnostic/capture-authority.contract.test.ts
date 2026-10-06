import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiagnosticCaptureCapabilityV1, DiagnosticCaptureSessionV1, DiagnosticCapturedAttemptV1,
} from "../../types/domains/first-party-diagnostic-capture.ts";
import { createDiagnosticCaptureMechanism } from "./capture-authority-core.ts";
import { FIRST_PARTY_DIAGNOSTIC_CAPTURE } from "./capture-authority.ts";

const locators = { specId: "int-add-2-3", specRevision: "r1" };
const instant = Date.parse("2026-10-06T10:00:00+08:00");
function mechanism(now: () => number = () => instant, generateAttemptId?: () => string) {
  let sequence = 0;
  return createDiagnosticCaptureMechanism({ now, generateAttemptId: generateAttemptId ?? (() => `test-${++sequence}`) });
}
function start(capability = mechanism()): DiagnosticCaptureSessionV1 {
  const result = capability.begin(locators);
  assert.equal(result.kind, "started");
  if (result.kind !== "started") throw new Error("start rejected");
  return result.session;
}
function submit(session: DiagnosticCaptureSessionV1, selectedOptionId = "five"): DiagnosticCapturedAttemptV1 {
  const result = session.submit({ selectedOptionId });
  assert.equal(result.kind, "captured");
  if (result.kind !== "captured") throw new Error("submit rejected");
  return result.attempt;
}
function lookup(capability: DiagnosticCaptureCapabilityV1, attempt: DiagnosticCapturedAttemptV1) {
  return capability.lookup({ ...locators, sourceOwnerId: "recall-diagnostic", attemptId: attempt.id });
}

test("capture issues exact r1 content, canonical option order and response schema without a key", () => {
  const { presentation } = start();
  assert.deepEqual(presentation, { sourceOwnerId: "recall-diagnostic", ...locators, contentRevision: "r1",
    content: { prompt: "2 + 3 = ?", options: [{ id: "four", text: "4" }, { id: "five", text: "5" }, { id: "six", text: "6" }] },
    responseFormat: { kind: "single_option_id", schemaVersion: 1 } });
  assert.doesNotMatch(JSON.stringify(presentation), /correctOption|verified|rationale|explanation|learningTarget|operands/);
});

test("unknown specs, wrong revisions and mutated caller snapshots fail closed", () => {
  const capture = mechanism();
  assert.deepEqual(capture.begin({ ...locators, specId: "unknown" }), { kind: "rejected", reason: "unknown_spec" });
  assert.deepEqual(capture.begin({ ...locators, specRevision: "r2" }), { kind: "rejected", reason: "spec_revision_mismatch" });
  for (const extra of [{ spec: start().presentation }, { content: { prompt: "1 + 4 = ?" } },
    { optionIds: ["five", "four", "six"] }, { responseFormat: { kind: "numeric_text" } }, { canonicalSpecRevision: "r1" }])
    assert.deepEqual(capture.begin({ ...locators, ...extra }), { kind: "rejected", reason: "invalid_request" });
});

test("attempt identity belongs to submission, is internally generated, and is unique for repeats", () => {
  let calls = 0;
  const capture = mechanism(() => instant, () => `opaque-${++calls}`);
  const first = start(capture);
  assert.equal(calls, 0, "begin/render is not a submission");
  const a = submit(first);
  const b = submit(start(capture));
  assert.equal(calls, 2);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, a.specId);
  assert.deepEqual(lookup(capture, a), { kind: "resolved", attempt: a });
  assert.deepEqual(lookup(capture, b), { kind: "resolved", attempt: b });
});

test("caller identity, timestamps, assistance, key and reveal-order assertions cannot be submitted", () => {
  for (const extra of [{ attemptId: "caller" }, { id: "caller" }, { occurredAt: "2020-01-01T00:00:00Z" },
    { assistance: "none" }, { verified: true }, { canonicalAnswer: "five" }, { target: "caller" },
    { submittedBeforeReveal: true }, { specRevision: "r2" }, { now: () => instant }]) {
    const session = start();
    assert.deepEqual(session.submit({ selectedOptionId: "four", ...extra }), { kind: "rejected", reason: "invalid_response" });
    assert.equal(submit(session, "four").assistance, "unknown");
    assert.deepEqual(mechanism().begin({ ...locators, ...extra }),
      { kind: "rejected", reason: "specRevision" in extra ? "spec_revision_mismatch" : "invalid_request" });
  }
});

test("valid selected identity is preserved even for an incorrect response; no key correction", () => {
  for (const selectedOptionId of ["four", "five", "six"]) {
    const response = { selectedOptionId };
    const result = start().submit(response);
    assert.equal(result.kind, "captured");
    if (result.kind !== "captured") throw new Error("capture rejected");
    assert.equal(result.attempt.selectedOptionId, selectedOptionId);
    assert.deepEqual(response, { selectedOptionId });
    assert.deepEqual(result.attempt.optionIds, ["four", "five", "six"]);
    assert.equal(result.attempt.specRevision, "r1");
    assert.equal(result.attempt.contentRevision, "r1");
    assert.deepEqual(result.attempt.responseFormat, { kind: "single_option_id", schemaVersion: 1 });
  }
});

test("missing response, impossible ID, display text and malformed inputs do not form wrong answers", () => {
  let calls = 0;
  const session = start(mechanism(() => { calls++; return instant; }));
  for (const response of [undefined, null, [], {}, "five", { selectedOptionId: "absent" }, { selectedOptionId: "5" },
    { selectedOptionId: " five" }, { selectedOptionId: 1 }, { selectedOptionId: undefined },
    Object.assign(Object.create({ hidden: true }), { selectedOptionId: "five" })])
    assert.deepEqual(session.submit(response), { kind: "rejected", reason: "invalid_response" });
  assert.equal(calls, 0);
  assert.equal(submit(session).selectedOptionId, "five");
});

test("getters, symbols, throwing proxies and hidden fields cannot carry capture assertions", () => {
  const capture = mechanism();
  const getter = Object.defineProperty({}, "selectedOptionId", { get() { throw new Error("SECRET"); } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error("SECRET"); } });
  for (const response of [getter, proxy, { selectedOptionId: "five", [Symbol("authority")]: "none" },
    Object.defineProperty({ selectedOptionId: "five" }, "assistance", { value: "none" })]) {
    const result = start(capture).submit(response);
    assert.equal(result.kind, "rejected");
    assert.doesNotMatch(JSON.stringify(result), /SECRET|authority/);
  }
  assert.deepEqual(capture.begin(proxy), { kind: "rejected", reason: "invalid_request" });
  assert.deepEqual(capture.lookup(proxy), { kind: "rejected", reason: "invalid_request" });
});

test("clock is read at submission commit and serializes the actual instant as canonical UTC", () => {
  let time = instant;
  let calls = 0;
  const session = start(mechanism(() => { calls++; return time; }));
  assert.equal(calls, 0);
  time += 4321;
  const attempt = submit(session);
  assert.equal(calls, 1);
  assert.equal(attempt.occurredAt, "2026-10-06T02:00:04.321Z");
  time += 10000;
  session.reveal();
  assert.equal(attempt.occurredAt, "2026-10-06T02:00:04.321Z");
  assert.equal(calls, 1);
});

test("Proxy get cannot swap a validated response and response inspection cannot reopen an invalidated lifecycle", () => {
  const response = new Proxy({ selectedOptionId: "four" }, { get() { return "impossible"; } });
  const result = start().submit(response);
  assert.equal(result.kind, "captured");
  if (result.kind !== "captured") throw new Error("capture rejected");
  assert.equal(result.attempt.selectedOptionId, "four");
  const session = start();
  const reentrant = new Proxy({ selectedOptionId: "five" }, { ownKeys(target) {
    session.reveal();
    return Reflect.ownKeys(target);
  } });
  assert.deepEqual(session.submit(reentrant), { kind: "rejected", reason: "lifecycle_invalidated" });
});

test("invalid clock, ID or dependency failure cannot seal a capture or leak errors", () => {
  for (const now of [() => NaN, () => Infinity, () => 1.5, () => Number.MAX_SAFE_INTEGER, () => Date.parse("+010000-01-01T00:00:00Z"),
    () => "2026-10-06T10:00:00" as unknown as number, () => { throw new Error("SECRET"); }]) {
    const session = start(mechanism(now));
    assert.deepEqual(session.submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "invalid_capture_facts" });
    assert.deepEqual(session.reveal(), { kind: "rejected", reason: "lifecycle_invalidated" });
  }
  for (const id of ["", "x".repeat(257), "\ud800"]) {
    const capture = mechanism(() => instant, () => id);
    assert.deepEqual(start(capture).submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "invalid_capture_facts" });
  }
  const failed = start(mechanism(() => instant, () => { throw new Error("SECRET"); }));
  assert.deepEqual(failed.submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "invalid_capture_facts" });
});

test("dependency object aliasing cannot change a mechanism's internal clock or identity", () => {
  const dependencies = { now: () => instant, generateAttemptId: () => "original-id" };
  const capture = createDiagnosticCaptureMechanism(dependencies);
  dependencies.now = () => instant + 10000;
  dependencies.generateAttemptId = () => "replacement-id";
  const attempt = submit(start(capture));
  assert.equal(attempt.id, "original-id");
  assert.equal(attempt.occurredAt, new Date(instant).toISOString());
});

test("ID collision rejects instead of replacing an already immutable attempt", () => {
  const capture = mechanism(() => instant, () => "collision");
  const first = submit(start(capture), "four");
  assert.deepEqual(start(capture).submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "invalid_capture_facts" });
  assert.deepEqual(lookup(capture, first), { kind: "resolved", attempt: first });
  assert.equal(first.selectedOptionId, "four");
});

test("service without hint or solution API still cannot assert none without a controlled runtime", () => {
  const session = start();
  assert.deepEqual(Object.keys(session).toSorted(), ["presentation", "reveal", "submit"]);
  const attempt = submit(session);
  assert.equal(attempt.assistance, "unknown");
  assert.deepEqual(attempt.provenance, { mechanism: "first-party-diagnostic-capture/v1",
    presentation: "canonical_snapshot_issued", assistanceBasis: "uncontrolled_surface", ordering: "submitted_before_reveal" });
});

test("reveal before submit denies the key and invalidates the lifecycle", () => {
  const session = start();
  assert.deepEqual(session.reveal(), { kind: "rejected", reason: "reveal_before_submit" });
  assert.deepEqual(session.submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "lifecycle_invalidated" });
  assert.deepEqual(session.reveal(), { kind: "rejected", reason: "lifecycle_invalidated" });
});

test("submit then reveal keeps the sealed capture and allows an idempotent explanation read", () => {
  const capture = mechanism();
  const session = start(capture);
  const attempt = submit(session, "four");
  const before = JSON.stringify(attempt);
  const reveal = session.reveal();
  assert.equal(reveal.kind, "revealed");
  if (reveal.kind !== "revealed") throw new Error("reveal rejected");
  assert.equal(reveal.correctOptionId, "five");
  assert.deepEqual(session.reveal(), reveal);
  assert.equal(JSON.stringify(attempt), before);
  assert.deepEqual(lookup(capture, attempt), { kind: "resolved", attempt });
});

test("duplicate submit and retry after reveal cannot mutate or reuse the first capture", () => {
  const capture = mechanism();
  const session = start(capture);
  const first = submit(session, "four");
  assert.deepEqual(session.submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "already_submitted" });
  session.reveal();
  assert.deepEqual(session.submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "already_submitted" });
  const second = submit(start(capture));
  assert.notEqual(first.id, second.id);
  assert.equal(first.selectedOptionId, "four");
  assert.equal(second.assistance, "unknown", "new lifecycle cannot erase prior answer exposure or prove none");
});

test("reentrant reveal during commit fails closed without a captured record", () => {
  const capture = mechanism(() => { session.reveal(); return instant; }, () => "reentrant");
  const session = start(capture);
  assert.deepEqual(session.submit({ selectedOptionId: "five" }), { kind: "rejected", reason: "invalid_capture_facts" });
  assert.deepEqual(capture.lookup({ ...locators, sourceOwnerId: "recall-diagnostic", attemptId: "reentrant" }),
    { kind: "rejected", reason: "unknown_attempt" });
});

test("captured response, revision, schema, ordering, time, assistance and provenance are deeply immutable", () => {
  const capture = mechanism();
  const session = start(capture);
  const response = { selectedOptionId: "four" };
  const result = session.submit(response);
  assert.equal(result.kind, "captured");
  if (result.kind !== "captured") throw new Error("capture rejected");
  const attempt = result.attempt;
  response.selectedOptionId = "five";
  for (const value of [capture, session, session.presentation, session.presentation.content,
    session.presentation.content.options, ...session.presentation.content.options, session.presentation.responseFormat,
    attempt, attempt.optionIds, attempt.responseFormat, attempt.provenance]) assert.equal(Object.isFrozen(value), true);
  for (const [key, value] of Object.entries({ selectedOptionId: "five", occurredAt: "2020-01-01T00:00:00Z",
    assistance: "none", specRevision: "r2", sourceOwnerId: "caller" })) assert.equal(Reflect.set(attempt, key, value), false);
  assert.equal(Reflect.set(attempt.optionIds, "0", "five"), false);
  assert.equal(Reflect.set(attempt.responseFormat, "schemaVersion", 2), false);
  assert.equal(Reflect.set(attempt.provenance, "assistanceBasis", "controlled_surface"), false);
  assert.equal(Reflect.set(session.presentation.content.options[0], "text", "5"), false);
  assert.equal(Reflect.set(session, "submit", () => ({})), false);
  assert.equal(attempt.selectedOptionId, "four");
  assert.deepEqual(lookup(capture, attempt), { kind: "resolved", attempt });
});

test("lookup rejects unknown attempt, wrong owner and incorrect exact tuple", () => {
  const capture = mechanism();
  const attempt = submit(start(capture));
  const request = { ...locators, sourceOwnerId: "recall-diagnostic", attemptId: attempt.id };
  for (const [change, reason] of [[{ attemptId: "unknown" }, "unknown_attempt"], [{ sourceOwnerId: "caller" }, "wrong_owner"],
    [{ specId: "other" }, "spec_binding_mismatch"], [{ specRevision: "r2" }, "spec_revision_mismatch"],
    [{ verified: true }, "invalid_request"], [{ occurredAt: attempt.occurredAt }, "invalid_request"]] as const)
    assert.deepEqual(capture.lookup({ ...request, ...change }), { kind: "rejected", reason });
  assert.deepEqual(mechanism().lookup(request), { kind: "rejected", reason: "unknown_attempt" });
});

test("production mechanism starts with no synthetic attempts and supplies its own UUID and clock", () => {
  const capture = FIRST_PARTY_DIAGNOSTIC_CAPTURE;
  assert.deepEqual(capture.lookup({ ...locators, sourceOwnerId: "recall-diagnostic", attemptId: "attempt-001" }),
    { kind: "rejected", reason: "unknown_attempt" });
  const before = Date.now();
  const first = submit(start(capture));
  const second = submit(start(capture));
  const after = Date.now();
  for (const attempt of [first, second]) {
    assert.match(attempt.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    assert.ok(Date.parse(attempt.occurredAt) >= before && Date.parse(attempt.occurredAt) <= after);
    assert.equal(attempt.assistance, "unknown");
    assert.deepEqual(lookup(capture, attempt), { kind: "resolved", attempt });
  }
  assert.notEqual(first.id, second.id);
});
