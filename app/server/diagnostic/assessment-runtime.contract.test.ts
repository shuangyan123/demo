import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { spawnSync } from "node:child_process";
import { issueDiagnostic, readDiagnostic, resolveDiagnosticAttempt, submitDiagnostic } from "./assessment-store.ts";
import { commitDiagnosticSubmission } from "./assessment-submission.ts";
import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { POST } from "../../api/diagnostic/submit/route.ts";
import { closeDiagnosticRuntime, initializeDiagnosticRuntime } from "./runtime.ts";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";

let storage: ReturnType<typeof diagnosticStorageFixture>;
let previousPayload: string | undefined;
before(() => {
  storage = diagnosticStorageFixture();
  previousPayload = process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP;
  process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP = storage.payload;
  assert.equal(initializeDiagnosticRuntime().readiness().kind, "ready");
});
after(() => {
  closeDiagnosticRuntime();
  if (previousPayload === undefined) delete process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP;
  else process.env.RECALL_MANAGED_STORAGE_BOOTSTRAP = previousPayload;
  storage.cleanup();
});

function issue() {
  const result = issueDiagnostic();
  assert.equal(result.kind, "issued");
  if (result.kind !== "issued") throw new Error("issue failed");
  return result;
}
async function submitted(selectedOptionId = "five") {
  const issued = issue();
  const result = (await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId }));
  assert.equal(result.kind, "submitted");
  if (result.kind !== "submitted") throw new Error("submit failed");
  return { issued, result };
}
function request(fields: Record<string, string>, origin = "http://localhost:4320") {
  return new Request("http://localhost:4320/api/diagnostic/submit", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(fields) });
}

test("controlled runtime delivers exact r1 presentation with no key or explanation and no reveal before capture", () => {
  const issued = issue();
  assert.deepEqual(issued.presentation.content, { prompt: "2 + 3 = ?",
    options: [{ id: "four", text: "4" }, { id: "five", text: "5" }, { id: "six", text: "6" }] });
  assert.equal(issued.presentation.specRevision, "r1");
  assert.deepEqual(issued.presentation.responseFormat, { kind: "single_option_id", schemaVersion: 1 });
  assert.deepEqual(readDiagnostic(issued.sessionId), issued);
  assert.doesNotMatch(JSON.stringify(issued), /verifiedCorrect|correctOptionId|explanation|rationale|hint|guided|keyRule|learningTarget/);
  assert.equal(resolveDiagnosticAttempt(issued.sessionId), undefined, "session locator is not an attempt identity");
});

test("invalid selected option does not capture or enable reveal", () => {
  const issued = issue();
  assert.deepEqual(submitDiagnostic({ sessionId: issued.sessionId, selectedOptionId: "impossible" }),
    { kind: "rejected", reason: "invalid_response" });
  assert.equal(readDiagnostic(issued.sessionId).kind, "issued");
});

test("controlled runtime rejects caller authority fields instead of promoting their assertions", () => {
  const issued = issue();
  for (const extra of [{ attemptId: "caller" }, { occurredAt: "2026-10-06T02:00:00Z" }, { assistance: "none" },
    { canonicalAnswer: "five" }, { verified: true }, { learningTarget: "caller" }, { specRevision: "r2" }, { spec: issued.presentation }])
    assert.deepEqual(submitDiagnostic({ sessionId: issued.sessionId, selectedOptionId: "five", ...extra }),
      { kind: "rejected", reason: "invalid_request" });
  assert.equal(readDiagnostic(issued.sessionId).kind, "issued");
});

test("real controlled submission uses capture authority, internal occurrence, production admission and existing Evidence", async () => {
  const before = Date.now();
  const { issued, result } = (await submitted());
  const after = Date.now();
  const attempt = result.attempt;
  assert.deepEqual(resolveDiagnosticAttempt(attempt.id), attempt);
  assert.notEqual(attempt.id, issued.sessionId);
  assert.ok(Date.parse(attempt.occurredAt) >= before && Date.parse(attempt.occurredAt) <= after);
  assert.equal(attempt.assistance, "none");
  assert.deepEqual(attempt.provenance, { mechanism: "first-party-diagnostic-capture/v1",
    presentation: "controlled_surface_delivered", assistanceBasis: "controlled_surface_no_builtin_assistance", ordering: "submitted_before_reveal" });
  assert.deepEqual(attempt.optionIds, ["four", "five", "six"]);
  const admitted = admitVerifiedAssessment({ sourceOwnerId: attempt.sourceOwnerId,
    specId: attempt.specId, specRevision: attempt.specRevision, attemptId: attempt.id });
  assert.deepEqual(admitted, result.admitted);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].policyVersion, "evidence-policy/v2");
  assert.equal(result.evidence[0].outcome.direction, "supports");
  assert.equal(result.evidence[0].assistance, "none");
  const revealed = readDiagnostic(issued.sessionId);
  assert.equal(revealed.kind, "revealed");
  if (revealed.kind !== "revealed") throw new Error("reveal failed");
  assert.equal(revealed.correctOptionId, "five");
  assert.equal(revealed.explanation, "2 + 3 = 5。");
});

test("wrong answer remains wrong and produces existing refuting Evidence", async () => {
  const { result } = (await submitted("four"));
  assert.equal(result.attempt.selectedOptionId, "four");
  assert.equal(result.evidence[0].outcome.direction, "refutes");
});

test("duplicate submit, reload/reveal and new lifecycle cannot mutate the original capture", async () => {
  const { issued, result } = (await submitted("four"));
  const before = JSON.stringify(result.attempt);
  assert.deepEqual((await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId: "five" })),
    { kind: "rejected", reason: "already_submitted" });
  const revealed = readDiagnostic(issued.sessionId);
  assert.deepEqual(readDiagnostic(issued.sessionId), revealed, "reload in this process resolves the original session");
  assert.equal(Reflect.set(result.attempt, "assistance", "unknown"), false);
  assert.equal(Reflect.set(result.attempt.optionIds, "0", "five"), false);
  assert.equal(JSON.stringify(result.attempt), before);
  assert.notEqual((await submitted()).result.attempt.id, result.attempt.id);
});

test("production admission ignores caller-added key/target/verified/time and rejects wrong tuple or unknown attempts", async () => {
  const { result } = (await submitted());
  const attempt = result.attempt;
  const locators = { sourceOwnerId: attempt.sourceOwnerId, specId: attempt.specId, specRevision: attempt.specRevision, attemptId: attempt.id };
  assert.deepEqual(admitVerifiedAssessment({ ...locators, verified: true, key: "four", target: "caller", assistance: "solution", occurredAt: "caller" }), result.admitted);
  for (const patch of [{ attemptId: "unknown" }, { sourceOwnerId: "caller" }, { specId: "other" }, { specRevision: "r2" }])
    assert.equal(admitVerifiedAssessment({ ...locators, ...patch }).kind, "rejected");
});

test("real HTTP form submits through trusted runtime and returns only a post-capture redirect", async () => {
  const issued = issue();
  const response = await POST(request({ sessionId: issued.sessionId, selectedOptionId: "five" }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `/diagnostic?session=${issued.sessionId}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  assert.equal(readDiagnostic(issued.sessionId).kind, "revealed");
  assert.equal((await POST(request({ sessionId: issued.sessionId, selectedOptionId: "four" }))).status, 409);
});

test("HTTP rejects forged authority, duplicate fields, oversized content and foreign origins", async () => {
  const issued = issue();
  for (const field of ["attemptId", "occurredAt", "assistance", "canonicalAnswer", "verified", "learningTarget", "specRevision", "specSnapshot"])
    assert.equal((await POST(request({ sessionId: issued.sessionId, selectedOptionId: "five", [field]: "caller" }))).status, 400);
  assert.equal((await POST(request({ sessionId: issued.sessionId, selectedOptionId: "five" }, "https://foreign.example"))).status, 403);
  assert.equal((await POST(request({ sessionId: issued.sessionId, selectedOptionId: "x".repeat(1100) }))).status, 413);
  assert.equal((await POST(new Request("http://localhost:4320/api/diagnostic/submit", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body: `sessionId=${issued.sessionId}&selectedOptionId=five&selectedOptionId=four` }))).status, 400);
  assert.equal((await POST(new Request("http://localhost:4320/api/diagnostic/submit", { method: "POST",
    headers: { "content-type": "application/json" }, body: "{}" }))).status, 400);
  assert.equal(readDiagnostic(issued.sessionId).kind, "issued");
});

test("native no-referrer form requires complete same-origin navigation metadata", async () => {
  const issued = issue();
  const fields = { sessionId: issued.sessionId, selectedOptionId: "five" };
  const metadata = { origin: "null", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  for (const patch of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "" },
    { "sec-fetch-mode": "cors" }, { "sec-fetch-dest": "empty" }, { origin: "https://foreign.example" }]) {
    const rejected = request(fields);
    for (const [key, value] of Object.entries({ ...metadata, ...patch })) rejected.headers.set(key, value);
    assert.equal((await POST(rejected)).status, 403);
  }
  assert.equal((await POST(request(fields, "null"))).status, 403);
  assert.equal(readDiagnostic(issued.sessionId).kind, "issued");
  const valid = request(fields);
  for (const [key, value] of Object.entries(metadata)) valid.headers.set(key, value);
  assert.equal((await POST(valid)).status, 303);
  assert.equal(readDiagnostic(issued.sessionId).kind, "revealed");
});

test("unknown/expired sessions fail closed while durable historical authority survives session TTL", async (context) => {
  assert.deepEqual(readDiagnostic("unknown"), { kind: "unavailable" });
  assert.deepEqual(submitDiagnostic({ sessionId: "unknown", selectedOptionId: "five" }), { kind: "rejected", reason: "unknown_session" });
  const { issued, result } = (await submitted());
  const later = Date.now() + 31 * 60 * 1000;
  context.mock.method(Date, "now", () => later);
  assert.deepEqual(readDiagnostic(issued.sessionId), { kind: "unavailable" });
  assert.deepEqual(resolveDiagnosticAttempt(result.attempt.id), result.attempt);
  assert.equal(admitVerifiedAssessment({ sourceOwnerId: "recall-diagnostic", specId: "int-add-2-3", specRevision: "r1", attemptId: result.attempt.id }).kind, "admitted");
});

test("independent server process reloads validated history and resolves the prior durable attempt", async () => {
  const { result } = (await submitted());
  const script = 'import { initializeDiagnosticRuntime } from "./app/server/diagnostic/runtime.ts"; initializeDiagnosticRuntime(); '
    + 'import { admitVerifiedAssessment } from "./app/services/verification-source/verification-source-admission.ts"; '
    + 'process.stdout.write(JSON.stringify(admitVerifiedAssessment({ sourceOwnerId: "recall-diagnostic", specId: "int-add-2-3", specRevision: "r1", attemptId: process.argv[1] })));';
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, result.attempt.id],
    { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), result.admitted);
  assert.deepEqual(resolveDiagnosticAttempt(result.attempt.id), result.attempt);
});
