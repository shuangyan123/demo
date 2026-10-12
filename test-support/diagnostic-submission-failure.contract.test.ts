import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commitDiagnosticSubmission } from "../app/server/diagnostic/assessment-submission.ts";
import { createDiagnosticHistoryRepository } from "../app/server/diagnostic/history/repository-core.ts";
import { diagnosticHistoryIO, diagnosticIOFailure } from "../app/server/diagnostic/history/io.ts";
import { closeDiagnosticRuntime, composeDiagnosticRuntime, diagnosticOwnerAttempt } from "../app/server/diagnostic/runtime.ts";
import { diagnosticStorageFixture } from "./diagnostic-storage.ts";
import { collectSubmissionFailure, diagnosticTestEnvironment, formatSubmissionFixtureFailure,
  submissionFailureStage, SubmissionFixtureFailure } from "./diagnostic-submission-failure.ts";
import { FAILURE_MARKER, PRESERVED_MARKER, PRESERVATION_ENV, FAILURE_RUN_PREFIX,
  preserveFirstDiagnosticFailure } from "./diagnostic-failure-preservation.ts";

const syntheticResult = { kind: "runtime_unavailable", readiness: { kind: "storage_unavailable" } } as const;

test("synthetic formatter preserves required fields in stable readable diagnostic text", () => {
  const report = { result: syntheticResult, runtime: { readiness: { kind: "storage_unavailable" } },
    storage: { tempRoot: "synthetic-root", profileId: "synthetic-profile", epochId: "synthetic-epoch" },
    clock: { now: 1000, expectedFakeTime: 1000, mockedNowIsCurrent: true, restoredToBaseline: false } };
  const message = formatSubmissionFixtureFailure(report);
  assert.equal(message, formatSubmissionFixtureFailure(report));
  assert.equal(message.split("\n")[0], FAILURE_MARKER);
  const decoded = JSON.parse(message.slice(message.indexOf("\n") + 1));
  assert.deepEqual(decoded, report);
  assert.equal(decoded.result.kind, "runtime_unavailable");
  assert.equal(decoded.storage.tempRoot, "synthetic-root");
  assert.equal(decoded.runtime.readiness.kind, "storage_unavailable");
  assert.equal(decoded.clock.mockedNowIsCurrent, true);
});

test("synthetic non-submitted diagnosis only reads normal successful fixture state", async context => {
  const storage = diagnosticStorageFixture();
  const baselineNow = Date.now;
  const envBefore = { ...process.env };
  closeDiagnosticRuntime();
  try {
    const runtime = composeDiagnosticRuntime(storage.config);
    const mockedNow = context.mock.method(Date, "now", () => Date.parse("2026-10-07T08:00:00.000Z"));
    const issued = runtime.issue();
    assert.equal(issued.kind, "issued"); if (issued.kind !== "issued") throw Error("normal self-check issue failed");
    const successful = (await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId: "five" }));
    assert.equal(successful.kind, "submitted"); if (successful.kind !== "submitted") throw Error("normal self-check submit failed");
    const before = readFileSync(storage.file, "utf8");
    const ownerBefore = diagnosticOwnerAttempt(successful.attempt.id);
    // 人为传给 formatter 的 synthetic result，不注入 IO/生产故障，不把它当作复现证据。
    const synthetic = { kind: "durable_without_evidence", attempt: successful.attempt } as const;
    const input = { result: synthetic, runtime, storage, sessionId: issued.sessionId,
      clock: { baselineNow, mockedNow, expectedFakeTime: Date.now() },
      test: { name: context.name, precedingTest: null, submissionIndex: 0, submissionCount: 1 } };
    const report = collectSubmissionFailure(input);
    assert.equal(report.result, synthetic);
    assert.equal(report.runtime.singletonPresent, true);
    assert.equal(report.runtime.singletonMatchesFixtureRuntime, true);
    assert.deepEqual(report.runtime.readiness, { kind: "ready" });
    assert.equal(report.storage.tempRoot, storage.root);
    assert.equal(report.storage.profileId, storage.config.profileId);
    assert.equal(report.storage.epochId, storage.config.epochId);
    assert.equal(report.owner.kind, "resolved"); assert.equal(report.admission.kind, "admitted");
    const observation = report.storage.observation;
    assert.ok("history" in observation);
    if (!("history" in observation)) throw Error("normal self-check snapshot probe failed");
    assert.equal(observation.history.kind, "complete");
    assert.equal(observation.history.generation, 1); assert.equal(observation.history.captureCount, 1);
    assert.equal(observation.history.attemptDurable, true); assert.equal(observation.file.exists, true);
    assert.equal(report.clock.mockedNowIsCurrent, true); assert.equal(report.clock.restoredToBaseline, false);
    assert.equal(report.stage.exact, false);
    assert.equal(report.stage.category, "event_derivation_or_evidence_derivation_or_reveal");
    assert.deepEqual(submissionFailureStage({ kind: "captured_not_durable", attempt: successful.attempt,
      failure: { kind: "rejected", reason: "untrusted_capture" } }), { category: "durable_append", exact: true });
    assert.equal(submissionFailureStage({ kind: "captured_not_durable", attempt: successful.attempt,
      failure: { kind: "unavailable", code: "storage_unavailable", reason: "commit_unconfirmed" } }).exact, false);
    assert.deepEqual(submissionFailureStage(syntheticResult), { category: "pre_capture_runtime_readiness", exact: true });
    const error = new SubmissionFixtureFailure(input, ""); // 明确禁用 preservation，不能占用真实 reproduction 的 claim。
    assert.equal(error.name, "SubmissionFixtureFailure"); assert.equal(error.preservation.reason, "disabled");
    assert.match(error.message, /RECALL_DIAGNOSTIC_SUBMISSION_FAILURE/);
    assert.equal(error.diagnostics.result, synthetic);
    const run = failureRunRoot();
    try {
      const preserved = new SubmissionFixtureFailure(input, run.root);
      assert.equal(preserved.preservation.keep, true); assert.ok(preserved.preservation.receipt);
      assert.ok(preserved.message.includes(PRESERVED_MARKER));
      assert.ok(preserved.stack?.includes(PRESERVED_MARKER));
      const receipt = JSON.parse(readFileSync(preserved.preservation.receipt, "utf8"));
      assert.equal(receipt.tempRoot, storage.root);
      assert.deepEqual(receipt.evidence.result, synthetic);
      assert.equal(receipt.evidence.test.name, context.name);
      assert.ok(receipt.evidence.stack.includes("diagnostic-submission-failure.contract.test.ts"));
      assert.equal(receipt.evidence.clock.mockedNowIsCurrent, true);
    } finally { run.cleanup(); } // synthetic self-check 不保留现场、不消耗真实 run 的 claim。
    assert.equal(readFileSync(storage.file, "utf8"), before);
    assert.equal(diagnosticOwnerAttempt(successful.attempt.id), ownerBefore);
    assert.deepEqual(runtime.readiness(), { kind: "ready" });
    assert.deepEqual({ ...process.env }, envBefore);
    context.mock.restoreAll();
    const restored = collectSubmissionFailure(input);
    assert.equal(Date.now, baselineNow); assert.equal(restored.clock.restoredToBaseline, true);
    assert.equal(restored.clock.mockedNowIsCurrent, false);
    closeDiagnosticRuntime();
    const closed = collectSubmissionFailure(input);
    assert.equal(closed.runtime.singletonPresent, false);
    assert.deepEqual(closed.runtime.readiness, { kind: "storage_unavailable" });
  } finally { context.mock.restoreAll(); closeDiagnosticRuntime(); storage.cleanup(); }
});

test("test env allowlist redacts malformed/unrelated payload and unrelated keys without mutation", () => {
  const storage = diagnosticStorageFixture();
  try {
    const env = { RECALL_MANAGED_STORAGE_BOOTSTRAP: "synthetic-private-payload",
      [PRESERVATION_ENV]: "synthetic-unrelated-path", RECALL_TEST_DIAGNOSTIC_REPRO_ROUND: "42",
      RECALL_UNRELATED_SECRET: "synthetic-private-secret", UNRELATED_TOKEN: "synthetic-private-token" };
    const before = { ...env };
    const report = diagnosticTestEnvironment(storage, env);
    assert.deepEqual(Object.keys(report).sort(), ["RECALL_MANAGED_STORAGE_BOOTSTRAP", PRESERVATION_ENV, "RECALL_TEST_DIAGNOSTIC_REPRO_ROUND"].sort());
    assert.equal(report.RECALL_MANAGED_STORAGE_BOOTSTRAP.present, true);
    assert.equal(report.RECALL_MANAGED_STORAGE_BOOTSTRAP.matchesFixture, false);
    assert.equal(report.RECALL_TEST_DIAGNOSTIC_REPRO_ROUND.value, "42");
    assert.doesNotMatch(JSON.stringify(report), /synthetic-private|synthetic-unrelated-path|UNRELATED_TOKEN/);
    assert.deepEqual(env, before);
    const matching = diagnosticTestEnvironment(storage, { RECALL_MANAGED_STORAGE_BOOTSTRAP: storage.payload });
    assert.equal(matching.RECALL_MANAGED_STORAGE_BOOTSTRAP.matchesFixture, true);
    assert.deepEqual(matching.RECALL_MANAGED_STORAGE_BOOTSTRAP.value,
      { profileId: storage.config.profileId, epochId: storage.config.epochId });
  } finally { storage.cleanup(); }
});

function failureRunRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), FAILURE_RUN_PREFIX));
  return { root, cleanup() {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith(FAILURE_RUN_PREFIX))
      throw Error("unsafe_self_check_cleanup");
    rmSync(root, { recursive: true, force: true });
  } };
}

test("preservation is disabled by default and unsafe run roots never acquire a receipt", () => {
  const storage = diagnosticStorageFixture();
  try {
    assert.deepEqual(preserveFirstDiagnosticFailure(undefined, storage.root, { synthetic: true }), { keep: false, reason: "disabled" });
    assert.equal(preserveFirstDiagnosticFailure(os.tmpdir(), storage.root, { synthetic: true }).reason, "unsafe_preservation_root");
    assert.ok(existsSync(storage.root));
  } finally { storage.cleanup(); }
});

test("one run atomically preserves first synthetic fixture; later failures clean up without overwriting", () => {
  const run = failureRunRoot(); const first = diagnosticStorageFixture(); const second = diagnosticStorageFixture();
  try {
    const one = preserveFirstDiagnosticFailure(run.root, first.root, { synthetic: true, result: syntheticResult });
    assert.equal(one.keep, true); assert.ok(one.receipt);
    const before = readFileSync(one.receipt, "utf8");
    const decoded = JSON.parse(before);
    assert.equal(decoded.marker, PRESERVED_MARKER); assert.equal(decoded.tempRoot, first.root);
    assert.deepEqual(decoded.evidence.result, syntheticResult);
    const two = preserveFirstDiagnosticFailure(run.root, second.root, { synthetic: true, second: true });
    assert.equal(two.keep, false); assert.equal(two.reason, "first_failure_already_claimed");
    if (!two.keep) second.cleanup();
    assert.equal(existsSync(second.root), false); assert.ok(existsSync(first.root));
    assert.equal(readFileSync(one.receipt, "utf8"), before);
  } finally { first.cleanup(); second.cleanup(); run.cleanup(); }
});

test("independent self-check process cannot replace an already claimed first failure receipt", () => {
  const run = failureRunRoot(); const first = diagnosticStorageFixture(); const second = diagnosticStorageFixture();
  try {
    const one = preserveFirstDiagnosticFailure(run.root, first.root, { synthetic: true });
    assert.ok(one.receipt); const before = readFileSync(one.receipt, "utf8");
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
      "import {preserveFirstDiagnosticFailure} from './test-support/diagnostic-failure-preservation.ts';"
        + "const input=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(preserveFirstDiagnosticFailure(input.run,input.fixture,{synthetic:true})));",
      JSON.stringify({ run: run.root, fixture: second.root })], { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    const decision = JSON.parse(child.stdout);
    assert.equal(decision.keep, false); assert.equal(decision.reason, "first_failure_already_claimed");
    assert.equal(readFileSync(one.receipt, "utf8"), before);
  } finally { first.cleanup(); second.cleanup(); run.cleanup(); }
});

test("synthetic session rejection reports uncertain boundary instead of claiming capture stage", () => {
  assert.deepEqual(submissionFailureStage({ kind: "rejected", reason: "unknown_session" }),
    { category: "session_validation_or_capture", exact: false,
      limitation: "capture return does not expose the runtime/session validation boundary" });
});

for (const phase of ["publication", "confirmation"] as const) test(`synthetic ${phase} failure reaches preserved receipt through internal query without widening submission result`, async context => {
  const storage = diagnosticStorageFixture(); const run = failureRunRoot();
  const baselineNow = Date.now; const envBefore = { ...process.env };
  closeDiagnosticRuntime();
  try {
    let published = false;
    const syntheticIOError = Object.assign(new Error("synthetic private filesystem message"), { code: "EPERM", syscall: "rename", errno: -4048,
      path: "C:/private/source", dest: "C:/private/destination" });
    const runtime = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
      ...diagnosticHistoryIO, publishReplacement(from, to) {
        if (phase === "publication") throw syntheticIOError;
        diagnosticHistoryIO.publishReplacement(from, to); published = true;
      },
      read(file, observe) {
        if (!published) return diagnosticHistoryIO.read(file, observe);
        observe?.(diagnosticIOFailure(Object.assign(syntheticIOError, { code: "EACCES", syscall: "open" }), "openSync"));
        return { kind: "unavailable", code: "storage_unavailable", reason: "snapshot_read_failed" };
      },
    }));
    const mockedNow = context.mock.method(Date, "now", () => Date.parse("2026-10-07T08:00:00.000Z"));
    const issued = runtime.issue(); assert.equal(issued.kind, "issued");
    if (issued.kind !== "issued") throw Error("self-check issue failed");
    const before = readFileSync(storage.file, "utf8");
    const result = (await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId: "four" }));
    assert.equal(result.kind, "captured_not_durable");
    if (result.kind !== "captured_not_durable") throw Error("expected synthetic publication failure");
    assert.deepEqual(result.failure, { kind: "unavailable", code: "storage_unavailable", reason: "commit_unconfirmed" });
    assert.deepEqual(Object.keys(result).sort(), ["kind", "attempt", "failure"].sort());
    assert.equal(diagnosticOwnerAttempt(result.attempt.id), undefined);
    const afterFailure = readFileSync(storage.file, "utf8");
    if (phase === "publication") assert.equal(afterFailure, before);
    else assert.equal(JSON.parse(afterFailure).generation, 1);
    const input = { result, runtime, storage, sessionId: issued.sessionId, clock: { baselineNow, mockedNow, expectedFakeTime: Date.now() },
      test: { name: context.name, precedingTest: null, submissionIndex: 0, submissionCount: 1 } };
    const error = new SubmissionFixtureFailure(input, run.root);
    assert.equal(error.preservation.keep, true); assert.ok(error.preservation.receipt);
    const report = error.diagnostics;
    assert.equal(report.stage.category, phase === "publication" ? "replacement_rename" : "confirmation_read"); assert.equal(report.stage.exact, true);
    assert.equal(report.durabilityFailure?.publication, phase === "publication" ? "reported_failure" : "reported_success");
    assert.equal(report.durabilityFailure?.operation, phase === "publication" ? "renameSync" : "openSync");
    assert.equal(report.durabilityFailure?.io?.ioCode, phase === "publication" ? "EPERM" : "EACCES");
    assert.doesNotMatch(JSON.stringify(report.durabilityFailure), /private|filesystem message|C:\//);
    const receipt = JSON.parse(readFileSync(error.preservation.receipt, "utf8"));
    assert.deepEqual(receipt.evidence.durabilityFailure, report.durabilityFailure);
    assert.deepEqual(receipt.evidence.result.failure, result.failure);
    assert.equal(readFileSync(storage.file, "utf8"), afterFailure); assert.equal(diagnosticOwnerAttempt(result.attempt.id), undefined);
    assert.deepEqual(runtime.readiness(), { kind: "storage_unavailable" }); assert.deepEqual({ ...process.env }, envBefore);
  } finally { context.mock.restoreAll(); closeDiagnosticRuntime(); storage.cleanup(); run.cleanup(); }
});
