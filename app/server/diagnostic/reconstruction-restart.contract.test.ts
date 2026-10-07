import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";

// 两个独立 Node process：B 只收到同一 Host bootstrap 与 exact spec/asOf，未收到 A 的 sessions、Events 或 HTTP response。
const script = `
import { initializeDiagnosticRuntime, closeDiagnosticRuntime } from './app/server/diagnostic/runtime.ts';
import { commitDiagnosticSubmission } from './app/server/diagnostic/assessment-submission.ts';
import { adaptVerifiedAssessment } from './app/services/learning-kernel/verified-assessment-adapter.ts';
import { deriveEvidence } from './app/services/learning-kernel/derive-evidence.ts';
import { deriveLearnerTargetStates } from './app/services/learning-kernel/derive-learner-state.ts';
import { decideNextVerification } from './app/services/learning-kernel/verification-policy.ts';
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from './app/services/first-party-diagnostic/spec-authority.ts';
import { reconstructDiagnosticLearnerState } from './app/server/diagnostic/state-reconstruction.ts';
const input = JSON.parse(process.argv[1]);
const runtime = initializeDiagnosticRuntime();
if (runtime.readiness().kind !== 'ready') throw Error('child_not_ready');
let output;
if (input.mode === 'submit') {
  let now = Date.parse('2026-10-07T08:00:00.000Z');
  Date.now = () => now;
  const events = [], singleEvidence = [];
  for (let index = 0; index < input.answers.length; index++) {
    now = input.times[index];
    const issued = runtime.issue();
    if (issued.kind !== 'issued') throw Error('child_issue_failed');
    const submitted = commitDiagnosticSubmission({sessionId: issued.sessionId, selectedOptionId: input.answers[index]});
    if (submitted.kind !== 'submitted') throw Error('child_submit_failed');
    events.push(...adaptVerifiedAssessment(submitted.admitted.spec, submitted.admitted.attempt).events);
    singleEvidence.push(...submitted.evidence);
  }
  const resolved = FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(input.request.specId, input.request.specRevision);
  if (resolved.kind !== 'resolved') throw Error('child_spec_failed');
  const evidence = deriveEvidence(events).evidence;
  const derivation = deriveLearnerTargetStates(events, evidence, {asOf: input.request.asOf});
  output = {events, evidence, singleEvidence, derivation, decision: decideNextVerification(derivation, resolved.spec.learningTarget)};
} else {
  const value = reconstructDiagnosticLearnerState(input.request);
  if (value.kind !== 'complete') throw Error('child_reconstruction_failed:' + value.code);
  output = value;
}
closeDiagnosticRuntime();
process.stdout.write(JSON.stringify({pid: process.pid, output}));
`;
function child(payload: string, input: unknown) {
  const value = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, JSON.stringify(input)],
    { cwd: process.cwd(), encoding: "utf8", timeout: 20000, env: { ...process.env, RECALL_MANAGED_STORAGE_BOOTSTRAP: payload } });
  assert.equal(value.status, 0, value.stderr);
  return JSON.parse(value.stdout);
}
const early = Date.parse("2026-10-07T08:00:00.000Z");
const request = { specId: "int-add-2-3", specRevision: "r1", asOf: "2026-10-07T10:00:00.000Z" };
for (const [name, answers, times] of [
  ["complete-empty", [], []], ["correct", ["five"], [early]], ["incorrect", ["four"], [early]],
  ["wrong then correct", ["four", "five"], [early, early + 60000]],
  ["correct then wrong", ["five", "four"], [early, early + 60000]],
  ["equal occurrence conflict", ["five", "four"], [early, early]],
  ["non-chronological commit order", ["five", "four", "five"], [early + 60000, early, early + 120000]],
] as const) test(`independent A → B restart: ${name}; canonical facts/state/WHAT converge`, () => {
  const storage = diagnosticStorageFixture();
  try {
    const live = child(storage.payload, { mode: "submit", answers, times, request });
    const before = readFileSync(storage.file, "utf8");
    const restarted = child(storage.payload, { mode: "read", request });
    assert.notEqual(live.pid, restarted.pid); assert.notEqual(restarted.pid, process.pid);
    assert.deepEqual(restarted.output.events, live.output.events);
    assert.deepEqual(restarted.output.evidence, live.output.evidence);
    // Live F3 的每条 Evidence 与整批重建的对应 canonical Evidence 全字段相同。
    for (const item of live.output.singleEvidence) assert.deepEqual(restarted.output.evidence.find((value: { id: string }) => value.id === item.id), item);
    assert.deepEqual(restarted.output.derivation, live.output.derivation);
    assert.deepEqual(restarted.output.state, live.output.derivation.states[0] ?? null);
    assert.deepEqual(restarted.output.decision, live.output.decision);
    assert.equal(restarted.output.scope.profileId, storage.config.profileId); assert.equal(restarted.output.scope.epochId, storage.config.epochId);
    assert.equal(restarted.output.scope.captureCount, answers.length); assert.equal(restarted.output.targetCaptureCount, answers.length);
    assert.deepEqual(restarted.output.events.map((event: { occurredAt: string }) => event.occurredAt), times.map(time => new Date(time).toISOString()));
    assert.equal(readFileSync(storage.file, "utf8"), before);
  } finally { storage.cleanup(); }
});
